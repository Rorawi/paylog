import { useEffect, useRef, useState } from 'react';
import Icon from './Icons.jsx';
import { formatDate, formatMoney, localDateString, localTimeString, numberValue } from '../domain/money.js';
import { calculateAgreementPlan, splitActualEarning } from '../domain/payoff.js';
import { agreementFunds, agreementStats, heldMoneySummary, paymentScheduleReminder, weeklyCostAmount } from '../domain/calculations.js';
import IncomePlanSummary from './IncomePlanSummary.jsx';
import PaymentReceipt from './PaymentReceipt.jsx';
import { makeId, paymentReceiptFileError, PAYMENT_RECEIPT_ACCEPT, PAYMENT_RECEIPT_MAX_BYTES } from '../data/repository.js';

function Field({ label, hint, children, className = '' }) {
  return <label className={`field ${className}`}><span className="field-label">{label}</span>{children}{hint && <span className="field-hint">{hint}</span>}</label>;
}

function FormHeader({ eyebrow, title, titleId, onClose }) {
  return <header className="form-header"><div><div className="eyebrow">{eyebrow}</div><h2 id={titleId}>{title}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close"><Icon name="close"/></button></header>;
}

function FormFooter({ onCancel, submitLabel, cancelLabel = 'Cancel', disabled = false, busy = false }) {
  return <div className="form-footer"><button className="button button-quiet" type="button" onClick={onCancel} disabled={busy}>{cancelLabel}</button><button className="button button-primary" type="submit" disabled={disabled || busy}>{busy ? 'Saving…' : submitLabel}</button></div>;
}

function ReceiptUploadField({ payment, receiptFile, onSelect, onRemove, removeExisting, onRemoveExisting, onRestoreExisting }) {
  const inputRef = useRef(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const hasExisting = Boolean(payment?.receiptPath);
  const existingVisible = hasExisting && !removeExisting && !receiptFile;

  useEffect(() => {
    if (!receiptFile) {
      setPreviewUrl('');
      return undefined;
    }
    const url = URL.createObjectURL(receiptFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [receiptFile]);

  function takeFile(file) {
    if (!file) return;
    const validationError = paymentReceiptFileError(file);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError('');
    onSelect(file);
  }

  function onDrop(event) {
    event.preventDefault();
    setDragging(false);
    takeFile(event.dataTransfer.files?.[0]);
  }

  function removeFile() {
    setError('');
    onRemove();
    if (inputRef.current) inputRef.current.value = '';
  }

  return <div className="field receipt-upload-field" aria-labelledby="receipt-upload-label">
    <span className="field-label" id="receipt-upload-label">Receipt image <span className="receipt-optional">Optional</span></span>
    <input ref={inputRef} className="visually-hidden" type="file" tabIndex={-1} accept={PAYMENT_RECEIPT_ACCEPT} aria-label="Choose a receipt image" onChange={(event) => { takeFile(event.target.files?.[0]); event.target.value = ''; }}/>
    {receiptFile ? <div className="receipt-selected">
      {previewUrl && <img src={previewUrl} alt="Selected receipt preview"/>}
      <div className="receipt-selected-info"><strong>{receiptFile.name}</strong><span>Ready to save with this payment</span><div><button type="button" className="text-button" onClick={() => inputRef.current?.click()}>Choose another</button><button type="button" className="text-button receipt-remove-action" onClick={removeFile}>Remove image</button></div></div>
    </div> : existingVisible ? <div className="receipt-existing">
      <PaymentReceipt path={payment.receiptPath}/>
      <button type="button" className="text-button" onClick={() => inputRef.current?.click()}>Replace</button>
      <button type="button" className="text-button receipt-remove-action" onClick={onRemoveExisting}>Remove</button>
    </div> : removeExisting ? <div className="receipt-removed-note"><span>This receipt will be removed when you save.</span><button type="button" className="text-button" onClick={onRestoreExisting}>Undo</button><button type="button" className="text-button" onClick={() => inputRef.current?.click()}>Add a new image</button></div> : <button type="button" className={`receipt-dropzone ${dragging ? 'is-dragging' : ''}`} onClick={() => inputRef.current?.click()} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }} onDrop={onDrop}>
      <span className="receipt-dropzone-icon"><Icon name="image" size={20}/></span><span><strong>Choose or drop a receipt image</strong><small>Photo or screenshot · up to {Math.round(PAYMENT_RECEIPT_MAX_BYTES / (1024 * 1024))} MB</small></span>
    </button>}
    {error && <span className="receipt-upload-error" role="alert">{error}</span>}
    {!receiptFile && !hasExisting && <span className="field-hint">Add a photo or screenshot so you can show proof of this payment later.</span>}
  </div>;
}

const WEEKLY_COST_SUGGESTIONS = [
  { name: 'Maintenance', helper: 'Routine servicing and upkeep, usually paid monthly.' },
  { name: 'Fuel', helper: 'Fuel needed to use this vehicle each week.' },
  { name: 'Repairs', helper: 'Money set aside for repairs and unexpected fixes.' },
  { name: 'Data', helper: 'Mobile data or internet needed for this vehicle.' },
  { name: 'Parking', helper: 'Weekly parking or storage fees.' },
  { name: 'Cleaning', helper: 'Cleaning supplies or services for this vehicle.' },
];
const GENERIC_WEEKLY_COST_HELPER = 'Anything you spend to keep this vehicle working.';

function normalizeCostName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function weeklyCostsForAgreement(agreement) {
  if (Array.isArray(agreement?.weeklyCosts)) return agreement.weeklyCosts.map((cost) => ({ ...cost, id: cost.id ?? makeId(), name: String(cost.name || ''), amount: Number(cost.amount) || 0, period: cost.period === 'monthly' ? 'monthly' : 'weekly' }));
  return [
    Number(agreement?.weeklyFuelAmount) > 0 ? { id: makeId(), name: 'Fuel', amount: Number(agreement.weeklyFuelAmount), period: 'weekly' } : null,
    Number(agreement?.weeklyMaintenanceAmount) > 0 ? { id: makeId(), name: 'Maintenance', amount: Number(agreement.weeklyMaintenanceAmount), period: 'weekly' } : null,
  ].filter(Boolean);
}

function weeklyCostTotals(costs = []) {
  return costs.reduce((totals, cost) => {
    const amount = weeklyCostAmount(cost);
    if (normalizeCostName(cost.name) === 'fuel') totals.fuel += amount;
    else totals.other += amount;
    return totals;
  }, { fuel: 0, other: 0 });
}

function weeklyCostHelper(name) {
  return WEEKLY_COST_SUGGESTIONS.find((suggestion) => normalizeCostName(suggestion.name) === normalizeCostName(name))?.helper || GENERIC_WEEKLY_COST_HELPER;
}

function defaultCostPeriod(name) {
  return normalizeCostName(name) === 'maintenance' ? 'monthly' : 'weekly';
}

function WeeklyCostSheet({ cost, initialName, costs, onClose, onSave, onRemove }) {
  const [name, setName] = useState(cost?.name ?? initialName ?? '');
  const [amount, setAmount] = useState(cost ? String(cost.amount) : '');
  const [period, setPeriod] = useState(cost ? (cost.period === 'monthly' ? 'monthly' : 'weekly') : defaultCostPeriod(initialName));
  const [dragOffset, setDragOffset] = useState(0);
  const [viewport, setViewport] = useState(() => ({ height: window.visualViewport?.height || window.innerHeight, top: window.visualViewport?.offsetTop || 0 }));
  const dialogRef = useRef(null);
  const amountRef = useRef(null);
  const dragStartRef = useRef(null);
  const dragOffsetRef = useRef(0);
  const helper = weeklyCostHelper(name);
  const normalizedName = normalizeCostName(name);
  const isDuplicate = Boolean(normalizedName) && costs.some((existing) => existing.id !== cost?.id && normalizeCostName(existing.name) === normalizedName);
  const canSave = normalizedName.length > 0 && Number(amount) > 0 && Number.isFinite(Number(amount)) && !isDuplicate;

  useEffect(() => {
    const visualViewport = window.visualViewport;
    const updateViewport = () => setViewport({ height: visualViewport?.height || window.innerHeight, top: visualViewport?.offsetTop || 0 });
    updateViewport();
    visualViewport?.addEventListener('resize', updateViewport);
    visualViewport?.addEventListener('scroll', updateViewport);
    window.addEventListener('resize', updateViewport);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusFrame = window.requestAnimationFrame(() => {
      amountRef.current?.focus({ preventScroll: true });
      amountRef.current?.scrollIntoView({ block: 'nearest' });
    });
    return () => {
      visualViewport?.removeEventListener('resize', updateViewport);
      visualViewport?.removeEventListener('scroll', updateViewport);
      window.removeEventListener('resize', updateViewport);
      document.body.style.overflow = previousOverflow;
      window.cancelAnimationFrame(focusFrame);
    };
  }, []);

  useEffect(() => {
    const onEscape = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [onClose]);

  function trapFocus(event) {
    if (event.key !== 'Tab') return;
    const focusable = [...(dialogRef.current?.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled])') || [])];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function startDrag(event) {
    dragStartRef.current = event.clientY;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function moveDrag(event) {
    if (dragStartRef.current == null) return;
    const offset = Math.max(0, event.clientY - dragStartRef.current);
    dragOffsetRef.current = offset;
    setDragOffset(offset);
  }

  function endDrag() {
    if (dragOffsetRef.current > 90) onClose();
    dragStartRef.current = null;
    dragOffsetRef.current = 0;
    setDragOffset(0);
  }

  function cancelDrag() {
    dragStartRef.current = null;
    dragOffsetRef.current = 0;
    setDragOffset(0);
  }

  function submit(event) {
    event.preventDefault();
    if (isDuplicate) return;
    if (!canSave) return;
    onSave({ id: cost?.id ?? makeId(), name: name.trim().replace(/\s+/g, ' '), amount: Number(amount), period });
  }

  const helperId = 'weekly-cost-helper';
  return <div className="weekly-cost-overlay" style={{ '--weekly-cost-vp-height': `${viewport.height}px`, '--weekly-cost-vp-top': `${viewport.top}px` }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="weekly-cost-sheet" role="dialog" aria-modal="true" aria-labelledby="weekly-cost-sheet-title" aria-describedby={helperId} onKeyDown={trapFocus} style={{ translate: `0 ${dragOffset}px` }}>
      <div className="weekly-cost-sheet-top">
        <div className="weekly-cost-drag-zone" aria-hidden="true" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={cancelDrag}><span className="weekly-cost-drag-handle"/></div>
        <header className="weekly-cost-sheet-header"><h3 id="weekly-cost-sheet-title">{cost ? 'Edit vehicle cost' : 'Add a vehicle cost'}</h3><button className="icon-button" type="button" onClick={onClose} aria-label="Close vehicle cost sheet"><Icon name="close" size={18}/></button></header>
      </div>
      <form className="weekly-cost-sheet-form" onSubmit={submit}>
        <div className="weekly-cost-sheet-body">
          <Field label="Cost name"><input autoComplete="off" maxLength="48" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Insurance" aria-invalid={isDuplicate} /></Field>
          {isDuplicate && <p className="weekly-cost-error" role="status">That cost already exists. Edit the existing one instead.</p>}
          <Field label={`How much per ${period === 'monthly' ? 'month' : 'week'}?`}><div className="input-currency input-currency-large"><span>GH₵</span><input autoFocus ref={amountRef} required min="0.01" step="0.01" type="number" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /></div></Field>
          <Field label="How often?"><select value={period} onChange={(event) => setPeriod(event.target.value)}><option value="weekly">Every week</option><option value="monthly">Every month</option></select></Field>
          <p className="weekly-cost-helper" id={helperId}>{helper}</p>
        </div>
        <footer className={`weekly-cost-sheet-footer ${cost ? 'weekly-cost-sheet-footer-edit' : ''}`}>
          {cost && <button className="button weekly-cost-remove" type="button" onClick={() => onRemove(cost.id)}>Remove</button>}
          <button className="button button-outline" type="button" onClick={onClose}>Cancel</button>
          <button className="button button-primary" type="submit" disabled={!canSave}>{cost ? 'Save cost' : 'Add cost'}</button>
        </footer>
      </form>
    </section>
  </div>;
}

export function AgreementForm({ agreement, data, onClose, onSave }) {
  const opening = agreement ? data.payments.find((payment) => payment.agreementId === agreement.id && payment.type === 'opening') : null;
  const paidOther = agreement ? data.payments.filter((payment) => payment.agreementId === agreement.id && payment.type !== 'opening').reduce((sum, payment) => sum + Number(payment.amount || 0), 0) : 0;
  const [form, setForm] = useState(() => ({
    payee: agreement?.payee ?? '', item: agreement?.item ?? '', totalPrice: agreement?.totalPrice ?? '',
    vehicleRegistrationNumber: agreement?.vehicleRegistrationNumber ?? '', incomeType: agreement?.incomeType ?? 'earnings',
    paymentAmount: agreement?.paymentAmount ?? '', frequency: agreement?.frequency ?? 'weekly',
    paymentDay: agreement?.paymentDay ?? '',
    startDate: agreement?.startDate ?? localDateString(), openingAmount: opening?.amount ?? 0,
    dailyIncome: agreement?.dailyIncome ?? '', daysWorkedPerWeek: agreement?.daysWorkedPerWeek ?? 7,
    weeklyCosts: weeklyCostsForAgreement(agreement),
  }));
  const [individual, setIndividual] = useState(false);
  const [formStep, setFormStep] = useState('details');
  const [costSheet, setCostSheet] = useState(null);
  const [pastPayments, setPastPayments] = useState([{ id: makeId(), date: agreement?.startDate ?? localDateString(), amount: '' }]);
  const costTriggerRef = useRef(null);
  const addOwnCostRef = useRef(null);
  const focusCostAfterCloseRef = useRef('');
  const costSheetWasOpenRef = useRef(false);
  useEffect(() => {
    if (costSheet) {
      costSheetWasOpenRef.current = true;
      return;
    }
    if (!costSheetWasOpenRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      const savedCost = focusCostAfterCloseRef.current && [...document.querySelectorAll('[data-weekly-cost-id]')].find((element) => element.dataset.weeklyCostId === focusCostAfterCloseRef.current);
      const target = costTriggerRef.current?.isConnected ? costTriggerRef.current : savedCost || addOwnCostRef.current;
      target?.focus();
      focusCostAfterCloseRef.current = '';
      costSheetWasOpenRef.current = false;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [costSheet]);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const total = numberValue(form.totalPrice);
  const installment = numberValue(form.paymentAmount);
  const costTotals = weeklyCostTotals(form.weeklyCosts);
  const existingCostNames = new Set(form.weeklyCosts.map((cost) => normalizeCostName(cost.name)));
  const availableSuggestions = WEEKLY_COST_SUGGESTIONS.filter((suggestion) => !existingCostNames.has(normalizeCostName(suggestion.name)));
  const recordedOpening = individual ? pastPayments.reduce((sum, payment) => sum + numberValue(payment.amount), 0) : numberValue(form.openingAmount);
  const fullPaid = agreement ? paidOther + recordedOpening : recordedOpening;
  const currentIncome = agreement ? agreementStats(agreement, data).plan.income : null;
  const livePlan = calculateAgreementPlan({
    totalPrice: form.totalPrice,
    alreadyPaid: fullPaid,
    paymentAmount: form.paymentAmount,
    frequency: form.frequency,
    startDate: form.startDate,
    dailyIncome: form.dailyIncome,
    daysWorkedPerWeek: form.daysWorkedPerWeek,
    weeklyFuelAmount: costTotals.fuel,
    weeklyMaintenanceAmount: costTotals.other,
    actualWeeklyIncome: currentIncome?.actualWeeklyIncome ?? 0,
    actualEarningCount: currentIncome?.actualEarningCount ?? 0,
  });

  function valuesForSave() {
    const values = { ...form, paymentDay: form.frequency === 'weekly' ? form.paymentDay : '', totalPrice: total, paymentAmount: installment, daysWorkedPerWeek: numberValue(form.daysWorkedPerWeek), dailyIncome: form.dailyIncome === '' ? '' : numberValue(form.dailyIncome), weeklyCosts: form.weeklyCosts.map((cost) => ({ ...cost, name: cost.name.trim(), amount: Number(cost.amount) || 0 })), weeklyFuelAmount: costTotals.fuel, weeklyMaintenanceAmount: costTotals.other, openingAmount: individual ? 0 : numberValue(form.openingAmount) };
    if (individual) values.pastPayments = pastPayments.filter((payment) => numberValue(payment.amount) > 0).map((payment) => ({ date: payment.date, amount: numberValue(payment.amount) }));
    return values;
  }

  function submit(event) {
    event.preventDefault();
    setFormStep('review');
  }

  function confirmPlan(event) {
    event.preventDefault();
    onSave(valuesForSave());
  }

  function openCostSheet(event, cost = null, initialName = '') {
    costTriggerRef.current = event.currentTarget;
    setCostSheet({ cost, initialName });
  }

  function closeCostSheet() {
    setCostSheet(null);
  }

  function saveCost(cost) {
    focusCostAfterCloseRef.current = cost.id;
    setForm((current) => ({ ...current, weeklyCosts: cost.id && current.weeklyCosts.some((entry) => entry.id === cost.id)
      ? current.weeklyCosts.map((entry) => entry.id === cost.id ? cost : entry)
      : [...current.weeklyCosts, cost] }));
    closeCostSheet();
  }

  function removeCost(id) {
    focusCostAfterCloseRef.current = '';
    setForm((current) => ({ ...current, weeklyCosts: current.weeklyCosts.filter((cost) => cost.id !== id) }));
    closeCostSheet();
  }

  function patchPast(id, key, value) {
    setPastPayments((rows) => rows.map((row) => row.id === id ? { ...row, [key]: value } : row));
  }

  if (formStep === 'review') {
    const remaining = Math.max(0, total - fullPaid);
    const frequencyLabel = form.frequency === 'daily' ? 'day' : form.frequency === 'monthly' ? 'month' : 'week';
    const paymentDayLabels = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const payoff = livePlan.payoff;
    return <div className="modal-backdrop"><section className="modal-card modal-card-wide agreement-review-modal" role="dialog" aria-modal="true" aria-labelledby="agreement-review-title">
      <form onSubmit={confirmPlan}>
        <FormHeader eyebrow="Review before saving" title="Confirm your payment plan" titleId="agreement-review-title" onClose={onClose}/>
        <div className="agreement-review-content">
          <section className="agreement-review-payment" aria-labelledby="agreement-review-payment-title">
            <div className="agreement-review-price"><span id="agreement-review-payment-title">Agreed vehicle price</span><strong>{formatMoney(total)}</strong></div>
            <div className="agreement-review-vehicle">For <strong>{form.item || 'your vehicle'}</strong>{form.vehicleRegistrationNumber && <span> · {form.vehicleRegistrationNumber}</span>} · owner <strong>{form.payee || 'not entered'}</strong></div>
            <div className="agreement-review-terms">
              <div><span>Payment amount</span><strong>{formatMoney(installment)} / {frequencyLabel}</strong></div>
              {form.frequency === 'weekly' && <div><span>Usual due day</span><strong>{paymentDayLabels[Number(form.paymentDay)] || 'Not chosen'}</strong></div>}
              <div><span>Already paid</span><strong>{formatMoney(fullPaid)}</strong></div>
              <div><span>Still to pay</span><strong>{formatMoney(remaining)}</strong></div>
              <div><span>Plan starts</span><strong>{formatDate(form.startDate, { day: 'numeric', month: 'short', year: 'numeric' })}</strong></div>
            </div>
            {payoff.status === 'ready' && <div className="agreement-review-payoff"><span>Estimated payoff</span><strong>{payoff.durationText}</strong><small>Finish around {formatDate(payoff.expectedFinish)}</small></div>}
          </section>
          <section className="agreement-review-work" aria-labelledby="agreement-review-work-title">
            <div className="agreement-review-section-heading"><div><h3 id="agreement-review-work-title">Work income plan</h3><p>Review the expected income split and take-home.</p></div></div>
            <IncomePlanSummary plan={livePlan} weeklyCosts={form.weeklyCosts} incomeType={form.incomeType} showPayoff={false} showActual={false}/>
          </section>
        </div>
        <FormFooter onCancel={() => setFormStep('details')} cancelLabel="Back to edit" submitLabel={agreement ? 'Confirm changes' : 'Confirm and save plan'}/>
      </form>
    </section></div>;
  }

  return <><div className="modal-backdrop"><section className="modal-card modal-card-wide agreement-setup-modal" role="dialog" aria-modal="true" aria-labelledby="agreement-form-title">
    <form onSubmit={submit}>
      <FormHeader eyebrow={agreement ? 'Update vehicle plan' : 'New vehicle plan'} title={agreement ? 'Edit your vehicle plan' : 'Set up your vehicle plan'} titleId="agreement-form-title" onClose={onClose}/>
      <div className="form-body">
        <div className="agreement-form-section-title"><h3>Vehicle details</h3><p>Details about the vehicle and its owner.</p></div>
        <div className="form-grid">
          <Field label="Vehicle make and model"><input autoFocus required value={form.item} onChange={(event) => set('item', event.target.value)} placeholder="e.g. Toyota Corolla" /></Field>
          <Field label="Vehicle registration "><input autoComplete="off" maxLength="24" value={form.vehicleRegistrationNumber} onChange={(event) => set('vehicleRegistrationNumber', event.target.value)} placeholder="e.g. GR 1234-26" /></Field>
          <Field label="Vehicle owner"><input required value={form.payee} onChange={(event) => set('payee', event.target.value)} placeholder="Owner’s name" /></Field>
        </div>

        <div className="agreement-form-section-title"><h3>Payment agreement</h3><p>Your agreed payment and due day.</p></div>
        <div className="form-grid">
          <Field label="Agreed vehicle price"><div className="input-currency"><span>GH₵</span><input required min="0.01" step="0.01" type="number" inputMode="decimal" value={form.totalPrice} onChange={(event) => set('totalPrice', event.target.value)} placeholder="0.00" /></div></Field>
          <Field label={`Agreed ${form.frequency} payment`}><div className="input-currency"><span>GH₵</span><input required min="0.01" step="0.01" type="number" inputMode="decimal" value={form.paymentAmount} onChange={(event) => set('paymentAmount', event.target.value)} placeholder="0.00" /></div></Field>
          <Field label="Payment frequency"><select value={form.frequency} onChange={(event) => set('frequency', event.target.value)}><option value="daily">Every day</option><option value="weekly">Every week</option><option value="monthly">Every month</option></select></Field>
          {form.frequency === 'weekly' && <Field label="Usual payment due day" hint="Reminder only. You can pay any day."><select required value={form.paymentDay} onChange={(event) => set('paymentDay', event.target.value)}><option value="">Choose a day</option><option value="1">Monday</option><option value="2">Tuesday</option><option value="3">Wednesday</option><option value="4">Thursday</option><option value="5">Friday</option><option value="6">Saturday</option><option value="0">Sunday</option></select></Field>}
          <Field label="Agreement start date"><input required type="date" value={form.startDate} onChange={(event) => set('startDate', event.target.value)} /></Field>
        </div>

        <div className="agreement-form-section-title"><h3>Work and income</h3><p>Optional estimates for your work with this vehicle.</p></div>
        <div className="form-grid income-plan-fields">
          <Field label="How do you earn?"><select value={form.incomeType} onChange={(event) => set('incomeType', event.target.value)}><option value="earnings">Work and Pay</option><option value="sales">Sales</option></select></Field>
          <Field label={`Expected daily ${form.incomeType === 'sales' ? 'sales' : 'earnings'}`}><div className="input-currency"><span>GH₵</span><input min="0" step="0.01" type="number" inputMode="decimal" value={form.dailyIncome} onChange={(event) => set('dailyIncome', event.target.value)} placeholder="0.00" /></div></Field>
          <Field label="Days worked per week"><input required min="1" max="7" step="1" type="number" inputMode="numeric" value={form.daysWorkedPerWeek} onChange={(event) => set('daysWorkedPerWeek', event.target.value)} /></Field>
        </div>

        <section className="weekly-costs-section" aria-labelledby="weekly-costs-title">
          <div className="weekly-costs-heading"><div><strong id="weekly-costs-title">Vehicle running costs</strong><span>Maintenance defaults to monthly; choose another period if needed.</span></div></div>
          {form.weeklyCosts.length > 0 && <div className="weekly-cost-rows">{form.weeklyCosts.map((cost) => <div className="weekly-cost-row" key={cost.id}>
            <button className="weekly-cost-row-main" data-weekly-cost-id={cost.id} type="button" onClick={(event) => openCostSheet(event, cost)} aria-label={`Edit ${cost.name}, ${formatMoney(cost.amount)} per ${cost.period === 'monthly' ? 'month' : 'week'}`}><span>{cost.name}</span><strong>{formatMoney(cost.amount)}<small>/ {cost.period === 'monthly' ? 'month' : 'week'}</small></strong></button>
            <button className="weekly-cost-row-action" type="button" onClick={(event) => openCostSheet(event, cost)} aria-label={`Edit ${cost.name}`}><Icon name="edit" size={16}/></button>
            <button className="weekly-cost-row-action weekly-cost-row-delete" type="button" onClick={(event) => {
              const row = event.currentTarget.closest('.weekly-cost-row');
              const focusTarget = row?.nextElementSibling?.querySelector('.weekly-cost-row-main') || row?.previousElementSibling?.querySelector('.weekly-cost-row-main') || addOwnCostRef.current;
              setForm((current) => ({ ...current, weeklyCosts: current.weeklyCosts.filter((entry) => entry.id !== cost.id) }));
              window.requestAnimationFrame(() => focusTarget?.focus());
            }} aria-label={`Remove ${cost.name}`}><Icon name="trash" size={16}/></button>
          </div>)}</div>}
          <div className="weekly-cost-suggestions">
            {availableSuggestions.map((suggestion) => <button className="weekly-cost-chip" key={suggestion.name} type="button" onClick={(event) => openCostSheet(event, null, suggestion.name)}>{suggestion.name}</button>)}
            <button ref={addOwnCostRef} className="weekly-cost-chip weekly-cost-chip-custom" type="button" data-weekly-cost-add onClick={(event) => openCostSheet(event)}>+ Add your own</button>
          </div>
        </section>

        {!individual ? <Field label="Deposit or amount already paid" hint="Optional. Counts toward the vehicle price and appears as one “Previous payments” entry on the start date.">
          <div className="input-currency"><span>GH₵</span><input min="0" step="0.01" type="number" inputMode="decimal" value={form.openingAmount} onChange={(event) => set('openingAmount', event.target.value)} placeholder="0.00" /></div>
        </Field> : <div className="past-payment-list">
          <div className="past-list-heading"><div><strong>Past payments</strong><span>Add any earlier payments you remember.</span></div><button className="text-button" type="button" onClick={() => setPastPayments((rows) => [...rows, { id: makeId(), date: form.startDate, amount: '' }])}><Icon name="plus" size={16}/> Add date</button></div>
          {pastPayments.map((payment, index) => <div className="past-payment-row" key={payment.id}><span className="row-index">{String(index + 1).padStart(2, '0')}</span><input aria-label="Past payment date" type="date" value={payment.date} onChange={(event) => patchPast(payment.id, 'date', event.target.value)} /><div className="input-currency"><span>GH₵</span><input aria-label="Past payment amount" min="0" step="0.01" type="number" inputMode="decimal" value={payment.amount} onChange={(event) => patchPast(payment.id, 'amount', event.target.value)} placeholder="0.00" /></div>{pastPayments.length > 1 && <button className="icon-button small-icon" type="button" aria-label="Remove payment" onClick={() => setPastPayments((rows) => rows.filter((row) => row.id !== payment.id))}><Icon name="close" size={17}/></button>}</div>)}
        </div>}
        {!agreement && <button className="text-button switch-history" type="button" onClick={() => { setIndividual((value) => !value); if (!individual) set('openingAmount', 0); }}>
          <Icon name="calendar" size={16}/>{individual ? 'Use one opening balance instead' : 'I want to enter past payments by date'}
        </button>}

      </div>
      <FormFooter onCancel={onClose} submitLabel="Review payment plan" />
    </form>
  </section></div>{costSheet && <WeeklyCostSheet key={costSheet.cost?.id || `new-${costSheet.initialName || 'custom'}`} cost={costSheet.cost} initialName={costSheet.initialName} costs={form.weeklyCosts} onClose={closeCostSheet} onSave={saveCost} onRemove={removeCost}/>}
  </>;
}

export function PaymentForm({ payment, agreements, data, initialAgreementId, initialAmount, onClose, onSave, onCreateAgreement, embedded = false, active = true }) {
  const [form, setForm] = useState(() => ({ agreementId: payment?.agreementId ?? initialAgreementId ?? agreements[0]?.id ?? '', date: payment?.date ?? localDateString(), time: payment?.time ?? (payment ? '' : localTimeString()), amount: payment?.amount ?? initialAmount ?? '', note: payment?.note ?? '', fundingSource: payment?.fundingSource ?? 'cash', holderId: payment?.holderId ?? '' }));
  const [receiptFile, setReceiptFile] = useState(null);
  const [removeReceipt, setRemoveReceipt] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  async function submitPayment(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await onSave({ ...form, amount: numberValue(form.amount), receiptFile, removeReceipt });
    } finally {
      setSaving(false);
    }
  }
  const ownerReserve = form.agreementId ? agreementFunds(data, form.agreementId).ownerSetAside : 0;
  const selectedAgreement = data.agreements.find((agreement) => agreement.id === form.agreementId);
  const selectedStats = selectedAgreement ? agreementStats(selectedAgreement, data) : null;
  const reminder = selectedAgreement ? paymentScheduleReminder(selectedAgreement, data) : null;
  const heldSummary = heldMoneySummary(data, { excludePaymentId: payment?.id ?? '' });
  const selectedHolder = heldSummary.holders.find((holder) => holder.holderId === form.holderId);
  const heldAmountForPayment = selectedHolder?.balance ?? 0;
  const heldPaymentInvalid = form.fundingSource === 'held' && (!form.holderId || Number(form.amount) > heldAmountForPayment + 0.005);
  const reminderLabel = reminder ? `${reminder.isOverdue ? 'Payment day was' : reminder.isDue ? 'Payment day is today' : 'Your next payment day is'} ${formatDate(reminder.date, { weekday: 'long', day: 'numeric', month: 'long' })}` : selectedAgreement?.frequency === 'weekly' ? 'Choose your usual payment day in the agreement.' : '';
  const installmentSuggestion = reminder?.amountDue > 0 ? reminder.amountDue : Number(selectedAgreement?.paymentAmount || 0);
  const suggestedPaymentAmount = Math.min(ownerReserve, selectedStats?.remaining ?? 0, installmentSuggestion);
  const extraHeldAmount = Math.max(0, ownerReserve - suggestedPaymentAmount);
  const entryForm = <form onSubmit={submitPayment}>
      {!embedded && <FormHeader eyebrow={payment ? 'Edit vehicle payment' : 'Vehicle payment history'} title={payment ? 'Update payment to owner' : 'Record payment to owner'} onClose={onClose}/>}
      {agreements.length ? <div className="form-body">
        {!payment && !embedded && <div className="payment-purpose-note" role="note"><Icon name="payment" size={18}/><p><strong>Record this after the vehicle owner receives your money.</strong> Work income set aside for the payment does not reduce your vehicle balance until you record the payment.</p></div>}
        {payment?.type === 'opening' ? <Field label="Vehicle"><div className="readonly-field">{agreements.find((agreement) => agreement.id === payment.agreementId)?.item} · {agreements.find((agreement) => agreement.id === payment.agreementId)?.payee}</div></Field> : <Field label="Vehicle"><select required value={form.agreementId} onChange={(event) => {
          const agreementId = event.target.value;
          if (payment) { set('agreementId', agreementId); return; }
          const target = data.agreements.find((agreement) => agreement.id === agreementId);
          const targetStats = target ? agreementStats(target, data) : null;
          const targetReminder = target ? paymentScheduleReminder(target, data) : null;
          const installmentSuggestion = targetReminder?.amountDue > 0 ? targetReminder.amountDue : Number(target?.paymentAmount || 0);
          const suggestion = targetStats ? Math.min(targetStats.plan.funds.ownerSetAside, targetStats.remaining, installmentSuggestion) : 0;
          setForm((current) => ({ ...current, agreementId, amount: suggestion > 0 ? suggestion : '' }));
        }}>{agreements.map((agreement) => <option key={agreement.id} value={agreement.id}>{agreement.item} · {agreement.payee}</option>)}</select></Field>}
        {payment?.type === 'opening' && <div className="inline-info"><Icon name="calendar" size={16}/> Previous payments stay grouped on the agreement start date.</div>}
        {!payment && form.agreementId && (ownerReserve > 0 || reminder) && <div className="payment-reserve-note"><Icon name="wallet" size={17}/><p><strong>{ownerReserve > 0 ? `${formatMoney(ownerReserve)} is held for ${selectedAgreement?.item}.` : `No work money is set aside for ${selectedAgreement?.item} yet.`}</strong> {ownerReserve > 0 ? `${formatMoney(suggestedPaymentAmount)} is suggested for this payment${extraHeldAmount > 0.005 ? `; ${formatMoney(extraHeldAmount)} stays set aside for the next one` : ''}.` : 'You can still pay from other money.'} Confirm what the vehicle owner received to reduce your balance. {reminderLabel && `${reminderLabel}.`} You can pay any day.</p></div>}
        <div className="form-grid">
          <Field label="Payment date" hint={payment?.type === 'opening' ? 'Change the agreement start date to move this entry.' : undefined}><input required type="date" readOnly={payment?.type === 'opening'} value={form.date} onChange={(event) => set('date', event.target.value)} /></Field>
          <Field label="Time paid"><input type="time" value={form.time} onChange={(event) => set('time', event.target.value)} /></Field>
        </div>
        <Field label="Amount paid to owner" hint={embedded ? 'Enter the full agreed payment or the amount you paid.' : undefined}><div className="input-currency"><span>GH₵</span><input required min="0.01" step="0.01" type="number" inputMode="decimal" value={form.amount} onChange={(event) => set('amount', event.target.value)} placeholder="0.00" /></div></Field>
        {payment?.type !== 'opening' && <>
          <Field label="How was the owner paid?"><select value={form.fundingSource} onChange={(event) => setForm((current) => ({ ...current, fundingSource: event.target.value, holderId: event.target.value === 'held' ? (current.holderId || heldSummary.holders.find((holder) => holder.balance > 0.005)?.holderId || '') : '' }))}><option value="cash">I paid from my own cash</option><option value="held">Someone holding my money paid</option></select></Field>
          {form.fundingSource === 'held' && <>
            <Field label="Who paid the owner?"><select required value={form.holderId} onChange={(event) => set('holderId', event.target.value)}><option value="">Choose a person</option>{heldSummary.holders.filter((holder) => holder.balance > 0.005).map((holder) => <option key={holder.holderId} value={holder.holderId}>{holder.holderName} · {formatMoney(holder.balance)} held</option>)}</select></Field>
            <div className={`inline-info ${heldPaymentInvalid ? 'held-payment-error' : ''}`} role={heldPaymentInvalid ? 'alert' : undefined}><Icon name={heldPaymentInvalid ? 'calendar' : 'wallet'} size={16}/>{heldPaymentInvalid ? `This person has ${formatMoney(heldAmountForPayment)} held. Lower the amount or choose another payment method.` : 'This records one vehicle payment and removes it from that person’s held balance.'}</div>
          </>}
        </>}
        <Field label="Note (optional)"><input value={form.note} onChange={(event) => set('note', event.target.value)} placeholder={payment?.type === 'opening' ? 'Previous payments' : 'Add a note'} /></Field>
        {payment?.type !== 'opening' && <ReceiptUploadField payment={payment} receiptFile={receiptFile} onSelect={(file) => { setReceiptFile(file); setRemoveReceipt(false); }} onRemove={() => setReceiptFile(null)} removeExisting={removeReceipt} onRemoveExisting={() => setRemoveReceipt(true)} onRestoreExisting={() => setRemoveReceipt(false)}/>}
      </div> : <div className="form-body"><div className="empty-state form-empty-state"><div className="empty-icon"><Icon name="agreement" size={24}/></div><strong>Add a vehicle first</strong><p>A payment needs a vehicle plan so Paylog knows which balance to update.</p><button type="button" className="button button-primary" onClick={onCreateAgreement}><Icon name="plus" size={16}/> Set up vehicle</button></div><div className="form-footer form-footer-inner"><button className="button button-quiet" type="button" onClick={onClose}>Cancel</button></div></div>}
      {agreements.length > 0 && <FormFooter onCancel={onClose} submitLabel={payment ? 'Save payment' : 'Record payment'} busy={saving} disabled={heldPaymentInvalid} />}
    </form>;
  if (embedded) return <div className="record-entry-pane" hidden={!active}>{entryForm}</div>;
  return <div className="modal-backdrop"><section className="modal-card" role="dialog" aria-modal="true">{entryForm}</section></div>;
}

function suggestedSplit(total, agreementId, data) {
  const amount = Math.max(0, numberValue(total));
  const agreement = data.agreements.find((item) => item.id === agreementId);
  if (!agreement) return { paymentAmount: 0, fuelAmount: 0, maintenanceAmount: 0, keptAmount: amount };
  const incomePlan = calculateAgreementPlan({
    totalPrice: agreement.totalPrice,
    paymentAmount: agreement.paymentAmount,
    frequency: agreement.frequency,
    startDate: agreement.startDate,
    dailyIncome: agreement.dailyIncome ?? '',
    daysWorkedPerWeek: agreement.daysWorkedPerWeek ?? 7,
    weeklyFuelAmount: agreement.weeklyFuelAmount ?? 0,
    weeklyMaintenanceAmount: agreement.weeklyMaintenanceAmount ?? 0,
  }).income;
  return splitActualEarning(amount, incomePlan);
}

export function EarningForm({ earning, data, initialAgreementId, onClose, onSave, embedded = false, active = true }) {
  const [form, setForm] = useState(() => ({
    agreementId: earning?.agreementId ?? initialAgreementId ?? data.agreements[0]?.id ?? '', date: earning?.date ?? localDateString(), time: earning?.time ?? (earning ? '' : localTimeString()),
    totalAmount: earning?.totalAmount ?? '', paymentAmount: earning?.paymentAmount ?? 0, fuelAmount: earning?.fuelAmount ?? 0, maintenanceAmount: earning?.maintenanceAmount ?? 0, keptAmount: earning?.keptAmount ?? '', note: earning?.note ?? '',
  }));
  const [manualSplit, setManualSplit] = useState(Boolean(earning));
  const setAgreement = (agreementId) => setForm((current) => {
    const next = { ...current, agreementId };
    if (!manualSplit) {
      const split = suggestedSplit(current.totalAmount, agreementId, data);
      Object.assign(next, split);
    }
    return next;
  });
  const setTotal = (value) => setForm((current) => {
    const next = { ...current, totalAmount: value };
    if (!manualSplit) {
      const split = suggestedSplit(value, current.agreementId, data);
      Object.assign(next, split);
    }
    else {
      const amount = numberValue(value);
      next.paymentAmount = Math.min(amount, numberValue(current.paymentAmount));
      next.fuelAmount = Math.min(Math.max(0, amount - next.paymentAmount), numberValue(current.fuelAmount));
      next.maintenanceAmount = Math.min(Math.max(0, amount - next.paymentAmount - next.fuelAmount), numberValue(current.maintenanceAmount));
      next.keptAmount = Math.max(0, amount - next.paymentAmount - next.fuelAmount - next.maintenanceAmount);
    }
    return next;
  });
  const setSplitPart = (key, value) => {
    setManualSplit(true);
    setForm((current) => {
      const total = numberValue(current.totalAmount);
      const otherParts = ['paymentAmount', 'fuelAmount', 'maintenanceAmount'].filter((part) => part !== key).reduce((sum, part) => sum + numberValue(current[part]), 0);
      const amount = Math.round(Math.min(Math.max(0, total - otherParts), Math.max(0, numberValue(value))) * 100) / 100;
      const next = { ...current, [key]: amount };
      next.keptAmount = Math.round(Math.max(0, total - numberValue(next.paymentAmount) - numberValue(next.fuelAmount) - numberValue(next.maintenanceAmount)) * 100) / 100;
      return next;
    });
  };
  const setKept = (value) => {
    setManualSplit(true);
    setForm((current) => {
      const total = numberValue(current.totalAmount);
      const fixed = numberValue(current.paymentAmount) + numberValue(current.fuelAmount);
      const keptAmount = Math.round(Math.min(Math.max(0, total - fixed), Math.max(0, numberValue(value))) * 100) / 100;
      const maintenanceAmount = Math.round(Math.max(0, total - fixed - keptAmount) * 100) / 100;
      return { ...current, keptAmount, maintenanceAmount };
    });
  };
  const autoFill = () => {
    setManualSplit(false);
    setForm((current) => {
      return { ...current, ...suggestedSplit(current.totalAmount, current.agreementId, data) };
    });
  };
  const linkedAgreement = data.agreements.find((agreement) => agreement.id === form.agreementId);
  const linkedLegacyPayment = earning?.paymentId ? data.payments.find((payment) => payment.id === earning.paymentId) : null;
  const entryForm = <form onSubmit={(event) => { event.preventDefault(); onSave({ ...form, totalAmount: numberValue(form.totalAmount), paymentAmount: numberValue(form.paymentAmount), fuelAmount: numberValue(form.fuelAmount), maintenanceAmount: numberValue(form.maintenanceAmount), keptAmount: numberValue(form.keptAmount) }); }}>
      {!embedded && <FormHeader eyebrow={earning ? 'Edit work record' : 'Daily work income'} title={earning ? 'Update work record' : 'Record daily sales or earnings'} onClose={onClose}/>}
      <div className="form-body">
        <Field label={`Daily ${linkedAgreement?.incomeType === 'sales' ? 'sales' : 'earnings'}`} hint="Enter the money from one day of work. Paylog suggests the agreed split."><div className="input-currency input-currency-large"><span>GH₵</span><input autoFocus={!embedded || active} required min="0.01" step="0.01" type="number" inputMode="decimal" value={form.totalAmount} onChange={(event) => setTotal(event.target.value)} placeholder="0.00" /></div></Field>
        <div className="form-grid earning-datetime-grid">
          <Field label="Date earned"><input required type="date" value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} /></Field>
          <Field label="Time earned"><input type="time" value={form.time} onChange={(event) => setForm((current) => ({ ...current, time: event.target.value }))} /></Field>
        </div>
        <Field label="Vehicle"><select value={form.agreementId} onChange={(event) => setAgreement(event.target.value)}><option value="">No vehicle</option>{data.agreements.map((agreement) => <option key={agreement.id} value={agreement.id}>{agreement.item} · {agreement.payee}</option>)}</select></Field>
        <div className="split-header"><div><span className="field-label">Today’s work income split</span><span className="field-hint">Owner first, then vehicle costs. The rest is your take-home.</span></div><button type="button" className="text-button" onClick={autoFill}><Icon name="spark" size={15}/> Use planned split</button></div>
        <div className="split-fields split-fields-four">
          <Field label="Owner payment set aside"><div className="input-currency"><span>GH₵</span><input min="0" max={numberValue(form.totalAmount)} step="0.01" type="number" inputMode="decimal" value={form.paymentAmount} onChange={(event) => setSplitPart('paymentAmount', event.target.value)} /></div></Field>
          <Field label="Fuel set aside"><div className="input-currency"><span>GH₵</span><input min="0" max={numberValue(form.totalAmount)} step="0.01" type="number" inputMode="decimal" value={form.fuelAmount} onChange={(event) => setSplitPart('fuelAmount', event.target.value)} /></div></Field>
          <Field label="Servicing and other costs"><div className="input-currency"><span>GH₵</span><input min="0" max={numberValue(form.totalAmount)} step="0.01" type="number" inputMode="decimal" value={form.maintenanceAmount} onChange={(event) => setSplitPart('maintenanceAmount', event.target.value)} /></div></Field>
          <Field label="Take-home from work"><div className="input-currency"><span>GH₵</span><input min="0" max={numberValue(form.totalAmount)} step="0.01" type="number" inputMode="decimal" value={form.keptAmount} onChange={(event) => setKept(event.target.value)} /></div></Field>
        </div>
        {linkedLegacyPayment && <div className="inline-info"><Icon name="payment" size={16}/> This older earning already has a payment in history. Saving changes here will update that recorded payment.</div>}
        {linkedAgreement && !linkedLegacyPayment && <div className="inline-info"><Icon name="payment" size={16}/> {formatMoney(numberValue(form.paymentAmount))} is set aside for {linkedAgreement.item}. It reduces the vehicle balance only after you record paying the owner.</div>}
        {linkedAgreement && numberValue(form.fuelAmount) > 0 && <div className="inline-info"><Icon name="expense" size={16}/> {formatMoney(numberValue(form.fuelAmount))} is reserved for {linkedAgreement.item} fuel.</div>}
        {linkedAgreement && numberValue(form.maintenanceAmount) > 0 && <div className="inline-info"><Icon name="expense" size={16}/> {formatMoney(numberValue(form.maintenanceAmount))} is reserved for {linkedAgreement.item} other weekly costs.</div>}
        {form.totalAmount && !manualSplit && <span className="field-hint split-hint">Suggested from this agreement’s daily income plan. Change any amount if needed.</span>}
        <Field label="Note (optional)"><input value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} placeholder="e.g. Brush clearing" /></Field>
      </div>
      <FormFooter onCancel={onClose} submitLabel={earning ? 'Save earning' : 'Save earning'} />
    </form>;
  if (embedded) return <div className="record-entry-pane" hidden={!active}>{entryForm}</div>;
  return <div className="modal-backdrop"><section className="modal-card" role="dialog" aria-modal="true">{entryForm}</section></div>;
}

export function HeldMoneyForm({ data, initialType = 'given', onClose, onSave }) {
  const summary = heldMoneySummary(data);
  const [type, setType] = useState(initialType === 'returned' ? 'returned' : 'given');
  const [holderName, setHolderName] = useState('');
  const [holderId, setHolderId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(localDateString());
  const [note, setNote] = useState('');
  const holdersWithMoney = summary.holders.filter((holder) => holder.balance > 0.005);
  const selectedHolder = summary.holders.find((holder) => holder.holderId === holderId);
  const limit = type === 'returned' ? (selectedHolder?.unallocated ?? 0) : Infinity;
  const validAmount = Number(amount) > 0 && Number.isFinite(Number(amount)) && Number(amount) <= limit + 0.005;

  function submit(event) {
    event.preventDefault();
    if (!validAmount) return;
    const selectedName = type === 'returned' ? selectedHolder?.holderName : holderName.trim();
    if (!selectedName) return;
    onSave({ type, holderId: type === 'returned' ? holderId : '', holderName: selectedName, amount: Number(amount), date, note: note.trim() });
  }

  return <div className="modal-backdrop"><section className="modal-card held-money-modal" role="dialog" aria-modal="true" aria-labelledby="held-money-title">
    <FormHeader eyebrow="Money held for me" title="Record held money" titleId="held-money-title" onClose={onClose}/>
    <div className="record-mode-block"><div className="record-mode-switch held-mode-switch" role="group" aria-label="Money movement">
      <button type="button" className={type === 'given' ? 'is-active' : ''} aria-pressed={type === 'given'} onClick={() => setType('given')}>I gave money</button>
      <button type="button" className={type === 'returned' ? 'is-active' : ''} aria-pressed={type === 'returned'} onClick={() => setType('returned')}>I got money back</button>
    </div><p>{type === 'given' ? 'Track money someone is keeping for you. It is not income or an expense.' : 'Returned money is not new income. Reserved money must be released before it can be returned.'}</p></div>
    <form onSubmit={submit}>
      <div className="form-body">
        {type === 'given' ? <Field label="Who is holding your money?"><input autoFocus required list="paylog-holder-suggestions" autoComplete="name" maxLength="60" value={holderName} onChange={(event) => setHolderName(event.target.value)} placeholder="e.g. Ama"/><datalist id="paylog-holder-suggestions">{summary.holders.map((holder) => <option key={holder.holderId} value={holder.holderName}/>)}</datalist></Field> : <Field label="Who returned your money?"><select required value={holderId} onChange={(event) => setHolderId(event.target.value)}><option value="">Choose a person</option>{holdersWithMoney.map((holder) => <option key={holder.holderId} value={holder.holderId}>{holder.holderName} · {formatMoney(holder.balance)} held</option>)}</select></Field>}
        <Field label="Amount"><div className="input-currency input-currency-large"><span>GH₵</span><input autoFocus={type === 'returned'} required min="0.01" max={Number.isFinite(limit) ? limit : undefined} step="0.01" type="number" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /></div></Field>
        {type === 'returned' && selectedHolder && <p className={`held-money-limit ${Number(amount) > limit ? 'is-invalid' : ''}`}>{formatMoney(limit)} is unallocated and available to return. Money set aside for the owner stays with {selectedHolder.holderName}.</p>}
        {type === 'returned' && holdersWithMoney.length === 0 && <p className="held-money-limit">There is no money recorded as held yet.</p>}
        <Field label="Date"><input required type="date" value={date} onChange={(event) => setDate(event.target.value)}/></Field>
        <Field label="Note (optional)"><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add a note"/></Field>
      </div>
      <FormFooter onCancel={onClose} submitLabel={type === 'given' ? 'Save money held' : 'Record money returned'} disabled={!validAmount || (type === 'given' && !holderName.trim()) || (type === 'returned' && !holderId)}/>
    </form>
  </section></div>;
}

export function OwnerAllocationForm({ data, agreements, initialAgreementId, onClose, onSave }) {
  const allHeld = heldMoneySummary(data);
  const [type, setType] = useState('set_aside');
  const [agreementId, setAgreementId] = useState(initialAgreementId ?? agreements[0]?.id ?? '');
  const [holderId, setHolderId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(localDateString());
  const agreementHeld = heldMoneySummary(data, { agreementId });
  const candidates = type === 'set_aside'
    ? allHeld.holders.filter((holder) => holder.unallocated > 0.005)
    : agreementHeld.holders.filter((holder) => holder.reserved > 0.005);
  const selectedHolder = candidates.find((holder) => holder.holderId === holderId);
  const limit = type === 'set_aside' ? (selectedHolder?.unallocated ?? 0) : (selectedHolder?.reserved ?? 0);
  const validAmount = Number(amount) > 0 && Number.isFinite(Number(amount)) && Number(amount) <= limit + 0.005;

  useEffect(() => {
    if (!candidates.some((holder) => holder.holderId === holderId)) setHolderId(candidates[0]?.holderId ?? '');
  }, [type, agreementId, holderId, candidates.map((holder) => holder.holderId).join('|')]);

  function submit(event) {
    event.preventDefault();
    if (!validAmount || !selectedHolder || !agreementId) return;
    onSave({ type, agreementId, holderId, holderName: selectedHolder.holderName, amount: Number(amount), date });
  }

  return <div className="modal-backdrop"><section className="modal-card held-money-modal" role="dialog" aria-modal="true" aria-labelledby="owner-allocation-title">
    <FormHeader eyebrow="Money held for me" title="Set aside for owner" titleId="owner-allocation-title" onClose={onClose}/>
    <div className="record-mode-block"><div className="record-mode-switch held-mode-switch" role="group" aria-label="Owner money allocation">
      <button type="button" className={type === 'set_aside' ? 'is-active' : ''} aria-pressed={type === 'set_aside'} onClick={() => setType('set_aside')}>Set aside</button>
      <button type="button" className={type === 'release' ? 'is-active' : ''} aria-pressed={type === 'release'} onClick={() => setType('release')}>Release set-aside</button>
    </div><p>{type === 'set_aside' ? 'Reserve held money for a vehicle payment. It stays with the person holding it.' : 'Release a reserve if it is no longer intended for the owner.'}</p></div>
    <form onSubmit={submit}>
      <div className="form-body">
        {agreements.length > 1 && <Field label="Vehicle"><select required value={agreementId} onChange={(event) => { setAgreementId(event.target.value); setHolderId(''); }}><option value="">Choose a vehicle</option>{agreements.map((agreement) => <option key={agreement.id} value={agreement.id}>{agreement.item} · {agreement.payee}</option>)}</select></Field>}
        {agreements.length === 1 && <div className="held-money-context">For <strong>{agreements[0].item}</strong></div>}
        <Field label="Who is holding it?"><select required value={holderId} onChange={(event) => setHolderId(event.target.value)}><option value="">Choose a person</option>{candidates.map((holder) => <option key={holder.holderId} value={holder.holderId}>{holder.holderName} · {formatMoney(type === 'set_aside' ? holder.unallocated : holder.reserved)} {type === 'set_aside' ? 'unallocated' : 'set aside'}</option>)}</select></Field>
        <Field label="Amount"><div className="input-currency input-currency-large"><span>GH₵</span><input autoFocus required min="0.01" max={limit > 0 ? limit : undefined} step="0.01" type="number" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /></div></Field>
        {selectedHolder && <p className={`held-money-limit ${Number(amount) > limit ? 'is-invalid' : ''}`}>{type === 'set_aside' ? `${formatMoney(limit)} is not allocated yet. This will not count as a payment.` : `${formatMoney(limit)} is currently set aside for this vehicle.`}</p>}
        {!candidates.length && <p className="held-money-limit">{type === 'set_aside' ? 'No unallocated held money is available.' : 'There is no owner money set aside for this vehicle yet.'}</p>}
        <Field label="Date"><input required type="date" value={date} onChange={(event) => setDate(event.target.value)}/></Field>
      </div>
      <FormFooter onCancel={onClose} submitLabel={type === 'set_aside' ? 'Set aside money' : 'Release money'} disabled={!validAmount || !selectedHolder || !agreementId}/>
    </form>
  </section></div>;
}

export function RecordMoneyForm({ data, initialAgreementId, initialMode = 'earning', initialAmount, onClose, onSavePayment, onSaveEarning, onCreateAgreement }) {
  const [mode, setMode] = useState(initialMode === 'payment' ? 'payment' : 'earning');
  const isEarning = mode === 'earning';
  return <div className="modal-backdrop"><section className="modal-card record-money-modal" role="dialog" aria-modal="true" aria-labelledby="record-money-title">
    <header className="form-header"><div><div className="eyebrow">VEHICLE AND WORK</div><h2 id="record-money-title">Record money</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close"><Icon name="close"/></button></header>
    <div className="record-mode-block"><div className="record-mode-switch" role="group" aria-label="What would you like to record?">
      <button type="button" className={isEarning ? 'is-active' : ''} aria-pressed={isEarning} onClick={() => setMode('earning')}>Daily sales or earnings</button>
      <button type="button" className={!isEarning ? 'is-active' : ''} aria-pressed={!isEarning} onClick={() => setMode('payment')}>Payment to owner</button>
    </div><p>{isEarning ? 'Record a day’s work. The owner’s share is set aside until you pay.' : 'Record money the vehicle owner has received. This is what lowers your vehicle balance.'}</p></div>
    <EarningForm embedded active={isEarning} data={data} initialAgreementId={initialAgreementId} onClose={onClose} onSave={onSaveEarning}/>
    <PaymentForm embedded active={!isEarning} payment={null} agreements={data.agreements} data={data} initialAgreementId={initialAgreementId} initialAmount={initialAmount} onClose={onClose} onCreateAgreement={onCreateAgreement} onSave={onSavePayment}/>
  </section></div>;
}

export function ExpenseForm({ expense, data, initialAgreementId, onClose, onSave }) {
  const agreements = data?.agreements ?? [];
  const [form, setForm] = useState(() => ({ date: expense?.date ?? localDateString(), amount: expense?.amount ?? '', category: expense?.category ?? 'food', agreementId: expense?.agreementId ?? initialAgreementId ?? '', note: expense?.note ?? '' }));
  const vehicleCost = ['fuel', 'maintenance', 'tolls', 'vehicle_other'].includes(form.category);
  const reserveCost = form.category === 'fuel' || form.category === 'maintenance';
  const setCategory = (category) => setForm((current) => ({ ...current, category, agreementId: ['fuel', 'maintenance', 'tolls', 'vehicle_other'].includes(category) ? (current.agreementId || initialAgreementId || agreements[0]?.id || '') : '' }));
  return <div className="modal-backdrop"><section className="modal-card" role="dialog" aria-modal="true">
    <form onSubmit={(event) => { event.preventDefault(); onSave({ ...form, amount: numberValue(form.amount) }); }}>
      <FormHeader eyebrow="Vehicle and personal spending" title={expense ? 'Edit expense' : 'Record an expense'} onClose={onClose}/>
      <div className="form-body">
        <Field label="Amount"><div className="input-currency input-currency-large"><span>GH₵</span><input autoFocus required min="0.01" step="0.01" type="number" inputMode="decimal" value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} placeholder="0.00" /></div></Field>
        <Field label="Date"><input required type="date" value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} /></Field>
        <Field label="What did you spend on?"><select value={form.category} onChange={(event) => setCategory(event.target.value)}><option value="food">Food</option><option value="transport">Personal transport</option><option value="fuel">Vehicle fuel</option><option value="maintenance">Vehicle servicing and repairs</option><option value="tolls">Tolls and parking</option><option value="vehicle_other">Other vehicle running costs</option><option value="family">Family</option><option value="savings">Savings</option><option value="other">Other</option></select></Field>
        {vehicleCost && <>
          <Field label="Vehicle"><select required value={form.agreementId} onChange={(event) => setForm((current) => ({ ...current, agreementId: event.target.value }))}><option value="">Choose a vehicle</option>{agreements.map((agreement) => <option key={agreement.id} value={agreement.id}>{agreement.item} · {agreement.payee}</option>)}</select></Field>
          {form.agreementId && <div className="inline-info"><Icon name="wallet" size={16}/>{reserveCost ? `This comes from the vehicle’s ${form.category} reserve. Any amount above the reserve reduces your available cash.` : 'This operating cost is recorded separately from the vehicle payment and reduces your available cash.'}</div>}
        </>}
        <Field label="Note (optional)"><input value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} placeholder="What was it for?" /></Field>
      </div>
      <FormFooter onCancel={onClose} submitLabel={expense ? 'Save expense' : 'Add expense'} />
    </form>
  </section></div>;
}

export function ActivityRow({ item, data, onEdit, onDelete }) {
  const isPayment = item.kind === 'payment';
  const type = item.type ?? '';
  const linkedEarning = isPayment && type === 'earning' ? data.earnings.find((earning) => earning.id === item.earningId) : null;
  const agreement = isPayment ? data.agreements.find((entry) => entry.id === item.agreementId) : null;
  const expenseLabels = { fuel: 'Vehicle fuel', maintenance: 'Servicing and repairs', tolls: 'Tolls and parking', vehicle_other: 'Other vehicle cost' };
  const title = item.kind === 'earning' ? 'Work income' : item.kind === 'expense' ? `${expenseLabels[item.category] || `${item.category[0].toUpperCase()}${item.category.slice(1)}`} expense` : type === 'opening' ? 'Previous payments' : 'Vehicle payment';
  const earningSplit = item.kind === 'earning' ? `${formatMoney(item.paymentAmount)} ${item.paymentId ? 'paid to owner' : 'set aside for owner'} · ${formatMoney(item.fuelAmount || 0)} fuel · ${formatMoney(item.maintenanceAmount)} vehicle costs · ${formatMoney(item.keptAmount)} take-home` : '';
  const detail = item.kind === 'earning' ? `${item.note || 'Money earned from work'} · ${earningSplit}` : item.kind === 'expense' ? (item.note || 'Money spent') : (agreement ? `${agreement.item} · ${agreement.payee}${item.note && item.type !== 'opening' ? ` · ${item.note}` : ''}` : item.note || 'Vehicle payment');
  return <div className="activity-row">
    <span className={`activity-icon activity-${item.kind}`}><Icon name={item.kind === 'payment' ? 'payment' : item.kind === 'earning' ? 'earning' : 'expense'} size={18}/></span>
    <div className="activity-copy"><strong>{title}</strong><span>{detail}</span><small>{formatDate(item.date)}</small>{isPayment && <PaymentReceipt path={item.receiptPath}/>}</div>
    <div className="activity-end"><strong className={item.kind === 'expense' ? 'negative' : ''}>{item.kind === 'earning' ? '+' : item.kind === 'expense' ? '−' : ''}{formatMoney(item.kind === 'earning' ? item.totalAmount : item.amount)}</strong>
      <div className="row-actions"><button className="mini-action" type="button" onClick={() => onEdit(linkedEarning || item)} aria-label={`Edit ${title}`}><Icon name="edit" size={14}/></button><button className="mini-action" type="button" onClick={() => onDelete(item)} aria-label={`Delete ${title}`}><Icon name="trash" size={14}/></button></div>
    </div>
  </div>;
}
