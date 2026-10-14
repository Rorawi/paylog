import { useEffect, useRef, useState } from 'react';
import Icon from './Icons.jsx';
import { formatDate, formatMoney, localDateString, localTimeString, numberValue } from '../domain/money.js';
import { calculateAgreementPlan, splitActualEarning } from '../domain/payoff.js';
import { agreementFunds, agreementStats, weeklyPaymentReminder } from '../domain/calculations.js';
import IncomePlanSummary from './IncomePlanSummary.jsx';
import { makeId } from '../data/repository.js';

function Field({ label, hint, children, className = '' }) {
  return <label className={`field ${className}`}><span className="field-label">{label}</span>{children}{hint && <span className="field-hint">{hint}</span>}</label>;
}

function FormHeader({ eyebrow, title, onClose }) {
  return <header className="form-header"><div><div className="eyebrow">{eyebrow}</div><h2>{title}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close"><Icon name="close"/></button></header>;
}

function FormFooter({ onCancel, submitLabel, disabled = false }) {
  return <div className="form-footer"><button className="button button-quiet" type="button" onClick={onCancel}>Cancel</button><button className="button button-primary" type="submit" disabled={disabled}>{submitLabel}</button></div>;
}

const WEEKLY_COST_SUGGESTIONS = [
  { name: 'Maintenance', helper: 'Routine servicing and upkeep for this item.' },
  { name: 'Fuel', helper: 'Fuel needed to use this item each week.' },
  { name: 'Repairs', helper: 'Money set aside for repairs and unexpected fixes.' },
  { name: 'Data', helper: 'Mobile data or internet needed for this item.' },
  { name: 'Parking', helper: 'Weekly parking or storage fees.' },
  { name: 'Cleaning', helper: 'Cleaning supplies or services for this item.' },
];
const GENERIC_WEEKLY_COST_HELPER = 'Anything you spend each week to keep this item earning.';

function normalizeCostName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function weeklyCostsForAgreement(agreement) {
  if (Array.isArray(agreement?.weeklyCosts)) return agreement.weeklyCosts.map((cost) => ({ ...cost, id: cost.id ?? makeId(), name: String(cost.name || ''), amount: Number(cost.amount) || 0 }));
  return [
    Number(agreement?.weeklyFuelAmount) > 0 ? { id: makeId(), name: 'Fuel', amount: Number(agreement.weeklyFuelAmount) } : null,
    Number(agreement?.weeklyMaintenanceAmount) > 0 ? { id: makeId(), name: 'Maintenance', amount: Number(agreement.weeklyMaintenanceAmount) } : null,
  ].filter(Boolean);
}

function weeklyCostTotals(costs = []) {
  return costs.reduce((totals, cost) => {
    const amount = Math.max(0, Number(cost.amount) || 0);
    if (normalizeCostName(cost.name) === 'fuel') totals.fuel += amount;
    else totals.other += amount;
    return totals;
  }, { fuel: 0, other: 0 });
}

function weeklyCostHelper(name) {
  return WEEKLY_COST_SUGGESTIONS.find((suggestion) => normalizeCostName(suggestion.name) === normalizeCostName(name))?.helper || GENERIC_WEEKLY_COST_HELPER;
}

function WeeklyCostSheet({ cost, initialName, costs, onClose, onSave, onRemove }) {
  const [name, setName] = useState(cost?.name ?? initialName ?? '');
  const [amount, setAmount] = useState(cost ? String(cost.amount) : '');
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
    const focusable = [...(dialogRef.current?.querySelectorAll('button:not([disabled]), input:not([disabled])') || [])];
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
    onSave({ id: cost?.id ?? makeId(), name: name.trim().replace(/\s+/g, ' '), amount: Number(amount) });
  }

  const helperId = 'weekly-cost-helper';
  return <div className="weekly-cost-overlay" style={{ '--weekly-cost-vp-height': `${viewport.height}px`, '--weekly-cost-vp-top': `${viewport.top}px` }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="weekly-cost-sheet" role="dialog" aria-modal="true" aria-labelledby="weekly-cost-sheet-title" aria-describedby={helperId} onKeyDown={trapFocus} style={{ translate: `0 ${dragOffset}px` }}>
      <div className="weekly-cost-sheet-top">
        <div className="weekly-cost-drag-zone" aria-hidden="true" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={cancelDrag}><span className="weekly-cost-drag-handle"/></div>
        <header className="weekly-cost-sheet-header"><h3 id="weekly-cost-sheet-title">{cost ? 'Edit weekly cost' : 'Add a weekly cost'}</h3><button className="icon-button" type="button" onClick={onClose} aria-label="Close weekly cost sheet"><Icon name="close" size={18}/></button></header>
      </div>
      <form className="weekly-cost-sheet-form" onSubmit={submit}>
        <div className="weekly-cost-sheet-body">
          <Field label="Cost name"><input autoComplete="off" maxLength="48" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Insurance" aria-invalid={isDuplicate} /></Field>
          {isDuplicate && <p className="weekly-cost-error" role="status">That cost already exists. Edit the existing one instead.</p>}
          <Field label="How much per week?"><div className="input-currency input-currency-large"><span>GH₵</span><input autoFocus ref={amountRef} required min="0.01" step="0.01" type="number" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /></div></Field>
          <p className="weekly-cost-helper" id={helperId}>{helper}</p>
        </div>
        <footer className={`weekly-cost-sheet-footer ${cost ? 'weekly-cost-sheet-footer-edit' : ''}`}>
          {cost && <button className="button weekly-cost-remove" type="button" onClick={() => onRemove(cost.id)}>Remove</button>}
          <button className="button button-quiet" type="button" onClick={onClose}>Cancel</button>
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
    paymentAmount: agreement?.paymentAmount ?? '', frequency: agreement?.frequency ?? 'weekly',
    paymentDay: agreement?.paymentDay ?? '',
    startDate: agreement?.startDate ?? localDateString(), openingAmount: opening?.amount ?? 0,
    dailyIncome: agreement?.dailyIncome ?? '', daysWorkedPerWeek: agreement?.daysWorkedPerWeek ?? 7,
    weeklyCosts: weeklyCostsForAgreement(agreement),
  }));
  const [individual, setIndividual] = useState(false);
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

  function submit(event) {
    event.preventDefault();
    const values = { ...form, paymentDay: form.frequency === 'weekly' ? form.paymentDay : '', totalPrice: total, paymentAmount: installment, daysWorkedPerWeek: numberValue(form.daysWorkedPerWeek), dailyIncome: form.dailyIncome === '' ? '' : numberValue(form.dailyIncome), weeklyCosts: form.weeklyCosts.map((cost) => ({ ...cost, name: cost.name.trim(), amount: Number(cost.amount) || 0 })), weeklyFuelAmount: costTotals.fuel, weeklyMaintenanceAmount: costTotals.other, openingAmount: individual ? 0 : numberValue(form.openingAmount) };
    if (individual) values.pastPayments = pastPayments.filter((payment) => numberValue(payment.amount) > 0).map((payment) => ({ date: payment.date, amount: numberValue(payment.amount) }));
    onSave(values);
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

  return <><div className="modal-backdrop"><section className="modal-card modal-card-wide" role="dialog" aria-modal="true" aria-labelledby="agreement-form-title">
    <form onSubmit={submit}>
      <FormHeader eyebrow={agreement ? 'Update agreement' : 'New agreement'} title={agreement ? 'Edit your agreement' : 'Set up an agreement'} onClose={onClose}/>
      <div className="form-body">
        <div className="form-grid">
          <Field label="What are you buying?"><input autoFocus required value={form.item} onChange={(event) => set('item', event.target.value)} placeholder="e.g. Bag" /></Field>
          <Field label="Who are you paying?"><input required value={form.payee} onChange={(event) => set('payee', event.target.value)} placeholder="Seller’s name" /></Field>
          <Field label="Agreed price"><div className="input-currency"><span>GH₵</span><input required min="0.01" step="0.01" type="number" inputMode="decimal" value={form.totalPrice} onChange={(event) => set('totalPrice', event.target.value)} placeholder="0.00" /></div></Field>
          <Field label="Payment amount"><div className="input-currency"><span>GH₵</span><input required min="0.01" step="0.01" type="number" inputMode="decimal" value={form.paymentAmount} onChange={(event) => set('paymentAmount', event.target.value)} placeholder="0.00" /></div></Field>
          <Field label="Pay how often?"><select value={form.frequency} onChange={(event) => set('frequency', event.target.value)}><option value="daily">Every day</option><option value="weekly">Every week</option><option value="monthly">Every month</option></select></Field>
          {form.frequency === 'weekly' && <Field label="Usual payment day" hint="Reminder only. You can pay any day."><select required value={form.paymentDay} onChange={(event) => set('paymentDay', event.target.value)}><option value="">Choose a day</option><option value="1">Monday</option><option value="2">Tuesday</option><option value="3">Wednesday</option><option value="4">Thursday</option><option value="5">Friday</option><option value="6">Saturday</option><option value="0">Sunday</option></select></Field>}
          <Field label="Agreement start date"><input required type="date" value={form.startDate} onChange={(event) => set('startDate', event.target.value)} /></Field>
        </div>

        <div className="form-grid income-plan-fields">
          <Field label="Daily income from this item"><div className="input-currency"><span>GH₵</span><input min="0" step="0.01" type="number" inputMode="decimal" value={form.dailyIncome} onChange={(event) => set('dailyIncome', event.target.value)} placeholder="0.00" /></div></Field>
          <Field label="Days worked per week"><input required min="1" max="7" step="1" type="number" inputMode="numeric" value={form.daysWorkedPerWeek} onChange={(event) => set('daysWorkedPerWeek', event.target.value)} /></Field>
        </div>

        <section className="weekly-costs-section" aria-labelledby="weekly-costs-title">
          <div className="weekly-costs-heading"><div><strong id="weekly-costs-title">Weekly costs</strong><span>Optional. Add only costs that apply to this item.</span></div></div>
          {form.weeklyCosts.length > 0 && <div className="weekly-cost-rows">{form.weeklyCosts.map((cost) => <div className="weekly-cost-row" key={cost.id}>
            <button className="weekly-cost-row-main" data-weekly-cost-id={cost.id} type="button" onClick={(event) => openCostSheet(event, cost)} aria-label={`Edit ${cost.name}, ${formatMoney(cost.amount)} per week`}><span>{cost.name}</span><strong>{formatMoney(cost.amount)}<small>/ week</small></strong></button>
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

        {!individual ? <Field label="Amount already paid" hint="Optional. We'll add this as one “Previous payments” entry on the start date.">
          <div className="input-currency"><span>GH₵</span><input min="0" step="0.01" type="number" inputMode="decimal" value={form.openingAmount} onChange={(event) => set('openingAmount', event.target.value)} placeholder="0.00" /></div>
        </Field> : <div className="past-payment-list">
          <div className="past-list-heading"><div><strong>Past payments</strong><span>Add any earlier payments you remember.</span></div><button className="text-button" type="button" onClick={() => setPastPayments((rows) => [...rows, { id: makeId(), date: form.startDate, amount: '' }])}><Icon name="plus" size={16}/> Add date</button></div>
          {pastPayments.map((payment, index) => <div className="past-payment-row" key={payment.id}><span className="row-index">{String(index + 1).padStart(2, '0')}</span><input aria-label="Past payment date" type="date" value={payment.date} onChange={(event) => patchPast(payment.id, 'date', event.target.value)} /><div className="input-currency"><span>GH₵</span><input aria-label="Past payment amount" min="0" step="0.01" type="number" inputMode="decimal" value={payment.amount} onChange={(event) => patchPast(payment.id, 'amount', event.target.value)} placeholder="0.00" /></div>{pastPayments.length > 1 && <button className="icon-button small-icon" type="button" aria-label="Remove payment" onClick={() => setPastPayments((rows) => rows.filter((row) => row.id !== payment.id))}><Icon name="close" size={17}/></button>}</div>)}
        </div>}
        {!agreement && <button className="text-button switch-history" type="button" onClick={() => { setIndividual((value) => !value); if (!individual) set('openingAmount', 0); }}>
          <Icon name="calendar" size={16}/>{individual ? 'Use one opening balance instead' : 'I want to enter past payments by date'}
        </button>}

        <IncomePlanSummary plan={livePlan}/>
      </div>
      <FormFooter onCancel={onClose} submitLabel={agreement ? 'Save changes' : 'Save agreement'} />
    </form>
  </section></div>{costSheet && <WeeklyCostSheet key={costSheet.cost?.id || `new-${costSheet.initialName || 'custom'}`} cost={costSheet.cost} initialName={costSheet.initialName} costs={form.weeklyCosts} onClose={closeCostSheet} onSave={saveCost} onRemove={removeCost}/>}
  </>;
}

export function PaymentForm({ payment, agreements, data, initialAgreementId, initialAmount, onClose, onSave, onCreateAgreement, embedded = false, active = true }) {
  const [form, setForm] = useState(() => ({ agreementId: payment?.agreementId ?? initialAgreementId ?? agreements[0]?.id ?? '', date: payment?.date ?? localDateString(), time: payment?.time ?? (payment ? '' : localTimeString()), amount: payment?.amount ?? initialAmount ?? '', note: payment?.note ?? '' }));
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const ownerReserve = form.agreementId ? agreementFunds(data, form.agreementId).ownerSetAside : 0;
  const selectedAgreement = data.agreements.find((agreement) => agreement.id === form.agreementId);
  const selectedStats = selectedAgreement ? agreementStats(selectedAgreement, data) : null;
  const reminder = selectedAgreement ? weeklyPaymentReminder(selectedAgreement, data) : null;
  const reminderLabel = reminder ? `${reminder.isOverdue ? 'Payment day was' : reminder.isDue ? 'Payment day is today' : 'Your next payment day is'} ${formatDate(reminder.date, { weekday: 'long', day: 'numeric', month: 'long' })}` : selectedAgreement?.frequency === 'weekly' ? 'Choose your usual payment day in the agreement.' : '';
  const installmentSuggestion = reminder?.amountDue > 0 ? reminder.amountDue : Number(selectedAgreement?.paymentAmount || 0);
  const suggestedPaymentAmount = Math.min(ownerReserve, selectedStats?.remaining ?? 0, installmentSuggestion);
  const extraHeldAmount = Math.max(0, ownerReserve - suggestedPaymentAmount);
  const entryForm = <form onSubmit={(event) => { event.preventDefault(); onSave({ ...form, amount: numberValue(form.amount) }); }}>
      {!embedded && <FormHeader eyebrow={payment ? 'Edit payment' : 'Payment history'} title={payment ? 'Update payment' : 'Record a payment'} onClose={onClose}/>}
      {agreements.length ? <div className="form-body">
        {!payment && !embedded && <div className="payment-purpose-note" role="note"><Icon name="payment" size={18}/><p><strong>Record this after you pay the seller.</strong> Work earnings can be set aside here, but only a payment you confirm reduces the amount still to pay.</p></div>}
        {payment?.type === 'opening' ? <Field label="Agreement"><div className="readonly-field">{agreements.find((agreement) => agreement.id === payment.agreementId)?.item} · {agreements.find((agreement) => agreement.id === payment.agreementId)?.payee}</div></Field> : <Field label="Agreement"><select required value={form.agreementId} onChange={(event) => {
          const agreementId = event.target.value;
          if (payment) { set('agreementId', agreementId); return; }
          const target = data.agreements.find((agreement) => agreement.id === agreementId);
          const targetStats = target ? agreementStats(target, data) : null;
          const targetReminder = target ? weeklyPaymentReminder(target, data) : null;
          const installmentSuggestion = targetReminder?.amountDue > 0 ? targetReminder.amountDue : Number(target?.paymentAmount || 0);
          const suggestion = targetStats ? Math.min(targetStats.plan.funds.ownerSetAside, targetStats.remaining, installmentSuggestion) : 0;
          setForm((current) => ({ ...current, agreementId, amount: suggestion > 0 ? suggestion : '' }));
        }}>{agreements.map((agreement) => <option key={agreement.id} value={agreement.id}>{agreement.item} · {agreement.payee}</option>)}</select></Field>}
        {payment?.type === 'opening' && <div className="inline-info"><Icon name="calendar" size={16}/> Previous payments stay grouped on the agreement start date.</div>}
        {!payment && form.agreementId && (ownerReserve > 0 || reminder) && <div className="payment-reserve-note"><Icon name="wallet" size={17}/><p><strong>{ownerReserve > 0 ? `${formatMoney(ownerReserve)} is held for ${selectedAgreement?.item}.` : `No work money is held for ${selectedAgreement?.item} yet.`}</strong> {ownerReserve > 0 ? `${formatMoney(suggestedPaymentAmount)} is suggested for this payment${extraHeldAmount > 0.005 ? `; ${formatMoney(extraHeldAmount)} stays held for the next one` : ''}.` : 'You can still pay from other money.'} Confirm what you gave the seller to reduce your balance. {reminderLabel && `${reminderLabel}.`} You can record payment any day.</p></div>}
        <div className="form-grid">
          <Field label="Payment date" hint={payment?.type === 'opening' ? 'Change the agreement start date to move this entry.' : undefined}><input required type="date" readOnly={payment?.type === 'opening'} value={form.date} onChange={(event) => set('date', event.target.value)} /></Field>
          <Field label="Time paid"><input type="time" value={form.time} onChange={(event) => set('time', event.target.value)} /></Field>
        </div>
        <Field label="Amount" hint={embedded ? 'Enter a full installment or the part amount you paid.' : undefined}><div className="input-currency"><span>GH₵</span><input required min="0.01" step="0.01" type="number" inputMode="decimal" value={form.amount} onChange={(event) => set('amount', event.target.value)} placeholder="0.00" /></div></Field>
        <Field label="Note (optional)"><input value={form.note} onChange={(event) => set('note', event.target.value)} placeholder={payment?.type === 'opening' ? 'Previous payments' : 'Add a note'} /></Field>
      </div> : <div className="form-body"><div className="empty-state form-empty-state"><div className="empty-icon"><Icon name="agreement" size={24}/></div><strong>Add an agreement first</strong><p>A payment needs an agreement so Paylog knows what balance to update.</p><button type="button" className="button button-primary" onClick={onCreateAgreement}><Icon name="plus" size={16}/> Create agreement</button></div><div className="form-footer form-footer-inner"><button className="button button-quiet" type="button" onClick={onClose}>Cancel</button></div></div>}
      {agreements.length > 0 && <FormFooter onCancel={onClose} submitLabel={payment ? 'Save payment' : 'Record payment'} />}
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
      {!embedded && <FormHeader eyebrow={earning ? 'Edit work entry' : 'Work income'} title={earning ? 'Update your earning' : 'Add work earnings'} onClose={onClose}/>}
      <div className="form-body">
        <Field label="Amount earned on this date" hint="Enter one day’s earnings. Paylog calculates your daily set-asides and profit."><div className="input-currency input-currency-large"><span>GH₵</span><input autoFocus={!embedded || active} required min="0.01" step="0.01" type="number" inputMode="decimal" value={form.totalAmount} onChange={(event) => setTotal(event.target.value)} placeholder="0.00" /></div></Field>
        <div className="form-grid">
          <Field label="Date earned"><input required type="date" value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} /></Field>
          <Field label="Time earned"><input type="time" value={form.time} onChange={(event) => setForm((current) => ({ ...current, time: event.target.value }))} /></Field>
        </div>
        <Field label="Link payment to"><select value={form.agreementId} onChange={(event) => setAgreement(event.target.value)}><option value="">No agreement</option>{data.agreements.map((agreement) => <option key={agreement.id} value={agreement.id}>{agreement.item} · {agreement.payee}</option>)}</select></Field>
        <div className="split-header"><div><span className="field-label">How today’s earnings are split</span><span className="field-hint">Owner first, then costs. Your profit is added when you save.</span></div><button type="button" className="text-button" onClick={autoFill}><Icon name="spark" size={15}/> Use planned split</button></div>
        <div className="split-fields split-fields-four">
          <Field label="Owner set aside"><div className="input-currency"><span>GH₵</span><input min="0" max={numberValue(form.totalAmount)} step="0.01" type="number" inputMode="decimal" value={form.paymentAmount} onChange={(event) => setSplitPart('paymentAmount', event.target.value)} /></div></Field>
          <Field label="Fuel set aside"><div className="input-currency"><span>GH₵</span><input min="0" max={numberValue(form.totalAmount)} step="0.01" type="number" inputMode="decimal" value={form.fuelAmount} onChange={(event) => setSplitPart('fuelAmount', event.target.value)} /></div></Field>
          <Field label="Other costs set aside"><div className="input-currency"><span>GH₵</span><input min="0" max={numberValue(form.totalAmount)} step="0.01" type="number" inputMode="decimal" value={form.maintenanceAmount} onChange={(event) => setSplitPart('maintenanceAmount', event.target.value)} /></div></Field>
          <Field label="Profit you keep"><div className="input-currency"><span>GH₵</span><input min="0" max={numberValue(form.totalAmount)} step="0.01" type="number" inputMode="decimal" value={form.keptAmount} onChange={(event) => setKept(event.target.value)} /></div></Field>
        </div>
        {linkedLegacyPayment && <div className="inline-info"><Icon name="payment" size={16}/> This older earning already has a payment in history. Saving changes here will update that recorded payment.</div>}
        {linkedAgreement && !linkedLegacyPayment && <div className="inline-info"><Icon name="payment" size={16}/> {formatMoney(numberValue(form.paymentAmount))} is reserved for {linkedAgreement.item}. It will count as paid only after you record the payment.</div>}
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

export function RecordMoneyForm({ data, initialAgreementId, initialMode = 'earning', initialAmount, onClose, onSavePayment, onSaveEarning, onCreateAgreement }) {
  const [mode, setMode] = useState(initialMode === 'payment' ? 'payment' : 'earning');
  const isEarning = mode === 'earning';
  return <div className="modal-backdrop"><section className="modal-card record-money-modal" role="dialog" aria-modal="true" aria-labelledby="record-money-title">
    <header className="form-header"><div><div className="eyebrow">MONEY ACTIVITY</div><h2 id="record-money-title">Record payment</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close"><Icon name="close"/></button></header>
    <div className="record-mode-block"><div className="record-mode-switch" role="group" aria-label="What would you like to record?">
      <button type="button" className={isEarning ? 'is-active' : ''} aria-pressed={isEarning} onClick={() => setMode('earning')}>Work earnings</button>
      <button type="button" className={!isEarning ? 'is-active' : ''} aria-pressed={!isEarning} onClick={() => setMode('payment')}>Payment to seller</button>
    </div><p>{isEarning ? 'Log what you earned. The seller’s share is held aside until you record paying it.' : 'Record money already given to the seller. Enter a full installment or a part payment to reduce the balance.'}</p></div>
    <EarningForm embedded active={isEarning} data={data} initialAgreementId={initialAgreementId} onClose={onClose} onSave={onSaveEarning}/>
    <PaymentForm embedded active={!isEarning} payment={null} agreements={data.agreements} data={data} initialAgreementId={initialAgreementId} initialAmount={initialAmount} onClose={onClose} onCreateAgreement={onCreateAgreement} onSave={onSavePayment}/>
  </section></div>;
}

export function ExpenseForm({ expense, data, initialAgreementId, onClose, onSave }) {
  const agreements = data?.agreements ?? [];
  const [form, setForm] = useState(() => ({ date: expense?.date ?? localDateString(), amount: expense?.amount ?? '', category: expense?.category ?? 'food', agreementId: expense?.agreementId ?? initialAgreementId ?? '', note: expense?.note ?? '' }));
  const businessCost = form.category === 'fuel' || form.category === 'maintenance';
  const setCategory = (category) => setForm((current) => ({ ...current, category, agreementId: category === 'fuel' || category === 'maintenance' ? (current.agreementId || initialAgreementId || agreements[0]?.id || '') : '' }));
  return <div className="modal-backdrop"><section className="modal-card" role="dialog" aria-modal="true">
    <form onSubmit={(event) => { event.preventDefault(); onSave({ ...form, amount: numberValue(form.amount) }); }}>
      <FormHeader eyebrow="Your money" title={expense ? 'Edit expense' : 'Add an expense'} onClose={onClose}/>
      <div className="form-body">
        <Field label="Amount"><div className="input-currency input-currency-large"><span>GH₵</span><input autoFocus required min="0.01" step="0.01" type="number" inputMode="decimal" value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} placeholder="0.00" /></div></Field>
        <Field label="Date"><input required type="date" value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} /></Field>
        <Field label="Category"><select value={form.category} onChange={(event) => setCategory(event.target.value)}><option value="food">Food</option><option value="transport">Transport</option><option value="fuel">Fuel for an item</option><option value="maintenance">Item maintenance</option><option value="family">Family</option><option value="savings">Savings</option><option value="other">Other</option></select></Field>
        {businessCost && <>
          <Field label="Agreement"><select required value={form.agreementId} onChange={(event) => setForm((current) => ({ ...current, agreementId: event.target.value }))}><option value="">Choose an agreement</option>{agreements.map((agreement) => <option key={agreement.id} value={agreement.id}>{agreement.item} · {agreement.payee}</option>)}</select></Field>
          {form.agreementId && <div className="inline-info"><Icon name="wallet" size={16}/> This comes from the item’s {form.category} reserve. Any amount above the reserve reduces your profit.</div>}
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
  const title = item.kind === 'earning' ? 'Work earning' : item.kind === 'expense' ? `${item.category[0].toUpperCase()}${item.category.slice(1)} expense` : type === 'opening' ? 'Previous payments' : 'Payment';
  const earningSplit = item.kind === 'earning' ? `${formatMoney(item.paymentAmount)} ${item.paymentId ? 'paid to seller' : 'set aside for owner'} · ${formatMoney(item.fuelAmount || 0)} fuel · ${formatMoney(item.maintenanceAmount)} other costs · ${formatMoney(item.keptAmount)} kept` : '';
  const detail = item.kind === 'earning' ? `${item.note || 'Money earned from work'} · ${earningSplit}` : item.kind === 'expense' ? (item.note || 'Money spent') : (agreement ? `${agreement.item} · ${agreement.payee}${item.note && item.type !== 'opening' ? ` · ${item.note}` : ''}` : item.note || 'Agreement payment');
  return <div className="activity-row">
    <span className={`activity-icon activity-${item.kind}`}><Icon name={item.kind === 'payment' ? 'payment' : item.kind === 'earning' ? 'earning' : 'expense'} size={18}/></span>
    <div className="activity-copy"><strong>{title}</strong><span>{detail}</span><small>{formatDate(item.date)}</small></div>
    <div className="activity-end"><strong className={item.kind === 'expense' ? 'negative' : ''}>{item.kind === 'earning' ? '+' : item.kind === 'expense' ? '−' : ''}{formatMoney(item.kind === 'earning' ? item.totalAmount : item.amount)}</strong>
      <div className="row-actions"><button className="mini-action" type="button" onClick={() => onEdit(linkedEarning || item)} aria-label={`Edit ${title}`}><Icon name="edit" size={14}/></button><button className="mini-action" type="button" onClick={() => onDelete(item)} aria-label={`Delete ${title}`}><Icon name="trash" size={14}/></button></div>
    </div>
  </div>;
}
