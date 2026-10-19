import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../components/Icons.jsx';
import { ActivityRow, AgreementForm, EarningForm, ExpenseForm, HeldMoneyForm, OwnerAllocationForm, PaymentForm, RecordMoneyForm } from '../components/Forms.jsx';
import PaymentReceipt from '../components/PaymentReceipt.jsx';
import PayoffSummary from '../components/PayoffSummary.jsx';
import IncomePlanSummary from '../components/IncomePlanSummary.jsx';
import { repository, makeId } from '../data/repository.js';
import { agreementStats, dashboardTotals, heldMoneySummary, paymentLedgerFields, paymentScheduleReminder, recentActivity, recordHeldTransfer, recordOwnerAllocation, spendingByCategory, weeklyCostAmount } from '../domain/calculations.js';
import { formatDate, formatMoney, formatTime, localDateString } from '../domain/money.js';

const navItems = [
  { id: 'overview', label: 'Overview', icon: 'home' },
  { id: 'breakdown', label: 'Work & earnings', icon: 'spark' },
  { id: 'history', label: 'Vehicle payments', icon: 'history' },
];

const pageHeadings = { overview: 'My Work and Pay vehicle', breakdown: 'Work and earnings', history: 'Vehicle payment history' };
const emptyData = { version: 1, agreements: [], payments: [], earnings: [], maintenanceRecords: [], expenses: [], heldTransfers: [], ownerAllocations: [] };

function initialPage() {
  if (window.location.hash === '#history') return 'history';
  if (window.location.hash === '#breakdown') return 'breakdown';
  return 'overview';
}

function downloadFile(filename, content, mime = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function paymentCsv(payments, agreements) {
  const rows = [['Date', 'Time paid', 'Vehicle', 'Vehicle owner', 'Amount (GHS)', 'Payment route', 'Note']];
  for (const payment of payments) {
    const agreement = agreements.find((item) => item.id === payment.agreementId);
    rows.push([payment.date, payment.time || '', agreement?.item || '', agreement?.payee || '', payment.amount, payment.fundingSource === 'held' ? `Paid directly by ${payment.holderName || 'holder'}` : 'Paid by me', payment.note || (payment.type === 'opening' ? 'Previous payments' : '')]);
  }
  return `\uFEFF${rows.map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n')}`;
}

function NavLink({ item, active, onClick, compact = false }) {
  return <button type="button" className={`nav-link ${active ? 'active' : ''} ${compact ? 'compact' : ''}`} onClick={onClick} aria-current={active ? 'page' : undefined}>
    <span className="nav-icon"><Icon name={item.icon} size={20} /></span><span>{item.label}</span>{active && !compact && <span className="nav-active-dot" />}
  </button>;
}

function PageTitle({ eyebrow, title, description, action }) {
  return <div className="page-title-row"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</div>;
}

function MetricCard({ label, value, detail, icon, tone = 'plain' }) {
  return <article className={`metric-card metric-${tone}`}><div className="metric-top"><span>{label}</span><span className="metric-icon"><Icon name={icon} size={17} /></span></div><strong className="metric-value">{value}</strong>{detail && <span className="metric-detail">{detail}</span>}</article>;
}

function ProgressBar({ value }) {
  return <div className="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(value)}><span style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></div>;
}

function StatusPill({ status, label }) {
  return <span className={`status-pill status-${status}`}><span />{label}</span>;
}

function QuickActions({ onAction }) {
  return <div className="quick-actions">
    <button className="quick-action action-earning" type="button" onClick={() => onAction('earning')}><span><Icon name="plus" size={20} /></span><b>Add earning</b><small>Money from work</small></button>
    <button className="quick-action action-payment" type="button" onClick={() => onAction('payment')}><span><Icon name="payment" size={20} /></span><b>Add payment</b><small>Pay an agreement</small></button>
    <button className="quick-action action-expense" type="button" onClick={() => onAction('expense')}><span><Icon name="expense" size={20} /></span><b>Add expense</b><small>Track spending</small></button>
  </div>;
}

function weeklyProfitFrom(data) {
  const now = new Date();
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const weekStartKey = localDateString(weekStart);
  const todayKey = localDateString(now);
  const weekEarnings = data.earnings.filter((earning) => earning.date >= weekStartKey && earning.date <= todayKey);
  return {
    weeklyProfit: weekEarnings.reduce((sum, earning) => sum + Number(earning.keptAmount || 0), 0),
    hasEarnings: weekEarnings.length > 0,
  };
}

// Keep the stored financial calculation intact while presenting an unmet
// amount as a shortfall instead of implying someone has negative cash.
function cashPosition(totals) {
  const net = Number(totals.kept) || 0;
  return { available: Math.max(0, net), shortfall: Math.max(0, -net) };
}

function paymentDueText(payoff) {
  if (!payoff?.nextPaymentDate) return payoff?.status === 'paid' ? 'Paid off' : 'No payment date';
  const today = localDateString();
  const date = formatDate(payoff.nextPaymentDate, { weekday: 'short', day: 'numeric', month: 'short' });
  const amount = formatMoney(payoff.nextPaymentAmount);
  if (payoff.nextPaymentDate < today) return `Overdue since ${date} · ${amount}`;
  if (payoff.nextPaymentDate === today) return `Due today · ${amount}`;
  return `${date} · ${amount} due`;
}

function agreementReminderText(agreement, data, payoff) {
  const reminder = paymentScheduleReminder(agreement, data);
  if (!reminder) return agreement.frequency === 'weekly' ? 'Set pay day in Edit' : paymentDueText(payoff);
  const date = formatDate(reminder.date, { weekday: 'short', day: 'numeric', month: 'short' });
  if (payoff?.status === 'paid') return 'Paid off';
  const amountDue = reminder.amountDue > 0.005 ? reminder.amountDue : Math.min(Number(agreement.paymentAmount || 0), Number(payoff?.remaining || 0));
  if (reminder.isOverdue) return `Overdue · ${formatMoney(amountDue)} due`;
  if (reminder.isDue) return `Due today · ${formatMoney(amountDue)}`;
  return `${date} · ${formatMoney(amountDue)} due`;
}

function ProfitSummaryCard({ data, totals }) {
  const { weeklyProfit, hasEarnings } = weeklyProfitFrom(data);
  const cash = cashPosition(totals);
  return <article className="profit-summary-card print-exclude" aria-label="Take-home from recorded work">
    <span className="profit-summary-label">Take-home from recorded work</span>
    <strong>{formatMoney(totals.keptEarned)}</strong>
    <span className="profit-summary-week">+{formatMoney(weeklyProfit)} take-home this week</span>
    <span className="profit-summary-divider" aria-hidden="true" />
    <span className="profit-summary-cash"><span>Cash available</span><b>{formatMoney(cash.available)}</b></span>
    <span className={`profit-summary-status ${cash.shortfall > 0 ? 'has-shortfall' : ''}`}>{cash.shortfall > 0 ? `${formatMoney(cash.shortfall)} not covered by recorded profit` : hasEarnings ? 'From earnings you recorded this week' : 'No earnings recorded this week'}</span>
  </article>;
}

function PurchaseBalanceFlipCard({ agreement, stats, data, totals, onEdit, onPayment, onBreakdown }) {
  const [flipped, setFlipped] = useState(false);
  const { weeklyProfit, hasEarnings } = weeklyProfitFrom(data);
  const cash = cashPosition(totals);
  const reminder = paymentScheduleReminder(agreement, data);
  const toggleLabel = flipped ? 'Show vehicle balance' : 'Show take-home from work';
  return <>
    <button className={`purchase-flip-card ${flipped ? 'is-flipped' : ''}`} type="button" onClick={() => setFlipped((value) => !value)} aria-pressed={flipped} aria-label={toggleLabel}>
      <span className="purchase-flip-inner">
        <span className="purchase-flip-face purchase-flip-front" aria-hidden={flipped}>
          <span className="purchase-card-top">
            <span>
              <span className="purchase-card-kicker">VEHICLE BALANCE</span>
              <b>{agreement.item}</b>{agreement.vehicleRegistrationNumber && <small className="vehicle-registration">{agreement.vehicleRegistrationNumber}</small>}</span>
            <span className="purchase-card-payee">
              <span>Paid to  {agreement.payee} <br />  <b>{formatMoney(stats.paid)}</b></span>

            </span></span>
          <span className="purchase-balance-block"><span>Still to pay</span><strong>{formatMoney(stats.remaining)}</strong></span>
          <span className="purchase-progress-wrap"><span className="purchase-progress-bar"><span style={{ width: `${Math.min(100, Math.max(0, stats.progress))}%` }} /></span><b>{Math.round(stats.progress)}% paid</b></span>
        </span>
        <span className="purchase-flip-face purchase-flip-back" aria-hidden={!flipped}>
          <span className="purchase-profit-title">Take-home from recorded work</span>
          <strong className="purchase-profit-total">{formatMoney(totals.keptEarned)}</strong>
          <span className="purchase-profit-week">+{formatMoney(weeklyProfit)} take-home this week</span>
          <span className="purchase-profit-cash">Cash available <b>{formatMoney(cash.available)}</b></span>
          <span className={`purchase-flip-hint ${cash.shortfall > 0 ? 'has-shortfall' : ''}`}>{cash.shortfall > 0 ? `${formatMoney(cash.shortfall)} not covered by recorded profit` : hasEarnings ? 'Earnings logged this week' : 'Not logged this week'} · Tap to return</span>
        </span>
      </span>
    </button>
    <div className="overview-actions overview-card-actions"><div className="overview-entry-actions"><button className="button button-primary" type="button" onClick={() => onPayment(agreement.id, 'earning')}><Icon name="earning" size={18} /> Record daily sales or earnings</button></div><button className="button button-outline" type="button" onClick={onBreakdown}><Icon name="spark" size={17} /> View work breakdown</button><button className="button button-quiet" type="button" onClick={() => onEdit(agreement)}><Icon name="edit" size={17} /> Edit vehicle</button></div>
    <p className="vehicle-balance-note">This balance reflects payments you’ve recorded. Confirm ownership transfer with the vehicle owner.</p>
  </>;
}

function DashboardAgreementCard({ agreement, stats }) {
  return <article className="dashboard-agreement-card">
    <div className="dashboard-agreement-heading"><span className="agreement-initial">{agreement.item.slice(0, 1).toUpperCase()}</span><span className="dashboard-agreement-title"><b>{agreement.item}</b><small>Paying {agreement.payee}</small></span><StatusPill status={stats.status} label={stats.statusLabel} /></div>
    <div className="dashboard-agreement-paid"><span>Total paid</span><b>{formatMoney(stats.paid)} <small>of {formatMoney(agreement.totalPrice)}</small></b></div>
    <ProgressBar value={stats.progress} />
    <div className="dashboard-agreement-facts">
      <span><small>Balance left</small><b>{formatMoney(stats.remaining)}</b></span>
      <span><small>Payments left</small><b>{stats.payoff.status === 'paid' ? '0' : stats.paymentsLeft || '—'}</b></span>
      <span><small>Expected finish</small><b>{stats.payoff.status === 'paid' ? 'Paid off' : stats.payoff.expectedFinish ? formatDate(stats.payoff.expectedFinish) : '—'}</b></span>
    </div>
  </article>;
}

function EmptyState({ icon, title, description, action, onClick }) {
  return <div className="empty-state"><div className="empty-icon"><Icon name={icon} size={24} /></div><strong>{title}</strong><p>{description}</p>{action && <button className="button button-outline" type="button" onClick={onClick}><Icon name="plus" size={17} />{action}</button>}</div>;
}

function Dashboard({ data, totals, onAction, onEdit, onDelete, goAgreements }) {
  const activity = recentActivity(data);
  const plans = data.agreements.map((agreement) => ({ agreement, stats: agreementStats(agreement, data) }));
  const firstName = data.earnings.length || data.agreements.length || data.payments.length || data.expenses.length ? 'Welcome back' : 'A fresh start';
  return <div className="page-stack dashboard-page">
    <PageTitle eyebrow={new Intl.DateTimeFormat('en-GH', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())} title={firstName} description="Keep an eye on what you owe, earn and spend." />
    <QuickActions onAction={onAction} />
    <ProfitFlipCard data={data} totals={totals} plans={plans} />
    <section className="metric-grid dashboard-overview" aria-label="Money overview">
      <MetricCard label="Still owed" value={formatMoney(totals.owed)} detail={`${data.agreements.length} ${data.agreements.length === 1 ? 'agreement' : 'agreements'}`} icon="agreement" tone="green" />
      <MetricCard label="Paid so far" value={formatMoney(totals.paid)} detail={`${formatMoney(totals.paymentsThisMonth)} this month · ${formatMoney(totals.paymentsThisWeek)} this week`} icon="payment" tone="blue" />
      <MetricCard label="Spent this month" value={formatMoney(totals.spentThisMonth)} detail="Across all categories" icon="expense" tone="coral" />
    </section>
    <section className="dashboard-agreements" aria-labelledby="dashboard-agreements-heading">
      <div className="dashboard-section-heading"><div><span className="eyebrow">YOUR PURCHASES</span><h2 id="dashboard-agreements-heading">Agreement progress</h2></div><button className="button button-outline" type="button" onClick={() => onAction('agreement')}><Icon name="plus" size={17} /> Add agreement</button></div>
      {plans.length ? <div className="dashboard-agreement-list">{plans.map(({ agreement, stats }) => <DashboardAgreementCard key={agreement.id} agreement={agreement} stats={stats} />)}</div> : <div className="dashboard-empty-agreements"><span className="empty-icon"><Icon name="agreement" size={22} /></span><div><b>No agreements yet</b><p>Add the item, owner, and payment amount to start tracking your progress.</p></div><button className="button button-primary" type="button" onClick={() => onAction('agreement')}><Icon name="plus" size={16} /> Create agreement</button></div>}
    </section>
    <section className="panel activity-panel dashboard-activity">
      <div className="section-heading"><div><div className="eyebrow">LATEST UPDATES</div><h2>Recent activity</h2></div>{activity.length > 0 && <button className="text-button" type="button" onClick={() => goAgreements()}>See records <Icon name="arrow" size={15} /></button>}</div>
      {activity.length ? <div className="activity-list">{activity.map((item) => <ActivityRow key={`${item.kind}-${item.id}`} item={item} data={data} onEdit={(entry) => onEdit(item.kind === 'payment' ? (item.type === 'earning' ? data.earnings.find((earning) => earning.id === item.earningId) : item) : item)} onDelete={() => onDelete(item)} />)}</div> : <EmptyState icon="spark" title="Your activity will show up here" description="Start by adding an agreement or recording money from work." action="Add an agreement" onClick={() => onAction('agreement')} />}
    </section>
  </div>;
}

function BagPlanCard({ agreement, stats, onEdit, onPayment, onEarning }) {
  return <article className="bag-plan-card">
    <div className="bag-plan-heading">
      <span className="bag-plan-icon"><Icon name="agreement" size={22} /></span>
      <div className="bag-plan-title"><span className="eyebrow">INSTALLMENT PLAN</span><h2>{agreement.item}</h2><p>Buying from {agreement.payee}</p></div>
      <button className="button button-outline bag-edit-button" type="button" onClick={() => onEdit(agreement)}><Icon name="edit" size={16} /> Edit</button>
    </div>
    <div className="bag-balance"><span>Still to pay</span><strong>{formatMoney(stats.remaining)}</strong></div>
    <ProgressBar value={stats.progress} />
    <div className="bag-progress-line"><span>{Math.round(stats.progress)}% paid off</span><span>{formatMoney(stats.paid)} paid of {formatMoney(agreement.totalPrice)}</span></div>
    <div className="bag-plan-details"><span><b>{formatMoney(agreement.paymentAmount)}</b> every {agreement.frequency === 'daily' ? 'day' : agreement.frequency === 'weekly' ? 'week' : 'month'}</span><span className={`status-text status-text-${stats.status}`}>{stats.statusLabel}</span><span className="bag-owner-reserve">{formatMoney(stats.plan.funds.ownerSetAside)} set aside for owner</span></div>
    <IncomePlanSummary plan={stats.plan} weeklyCosts={agreement.weeklyCosts || []} incomeType={agreement.incomeType} />
    <div className="bag-plan-actions">
      <button className="button button-primary" type="button" onClick={() => onPayment(agreement.id)}><Icon name="plus" size={17} /> Record payment</button>
      <button className="button button-outline" type="button" onClick={() => onEarning(agreement.id)}><Icon name="earning" size={17} /> Add work earnings</button>
    </div>
  </article>;
}

function MyBagPage({ data, totals, agreements, agreement, onSelectAgreement, onAction, onEdit, onPayment, onEarning, onEditMoney, onDeleteMoney }) {
  const cashItems = [
    ...data.earnings.map((item) => ({ ...item, kind: 'earning' })),
    ...data.expenses.map((item) => ({ ...item, kind: 'expense' })),
  ].sort((a, b) => `${b.date} ${b.time || ''} ${b.createdAt || b.id}`.localeCompare(`${a.date} ${a.time || ''} ${a.createdAt || a.id}`)).slice(0, 4);
  const stats = agreement ? agreementStats(agreement, data) : null;
  const plans = agreements.map((item) => ({ agreement: item, stats: agreementStats(item, data) }));
  const cash = cashPosition(totals);

  return <div className="page-stack my-bag-page">
    <PageTitle eyebrow="Your purchase, at a glance" title="My purchase" description="Track what you agreed to pay, what you’ve paid and what you keep from work." action={agreement && <button className="button button-outline title-action" type="button" onClick={() => onAction('agreement')}><Icon name="plus" size={17} /> Add another item</button>} />
    {(agreements.length > 0 || data.earnings.length > 0) && <ProfitFlipCard data={data} totals={totals} plans={plans} />}
    {agreements.length > 1 && <label className="bag-item-select"><span>Choose an item</span><select value={agreement?.id || ''} onChange={(event) => onSelectAgreement(event.target.value)}>{agreements.map((item) => <option key={item.id} value={item.id}>{item.item} · {item.payee}</option>)}</select></label>}
    {agreement ? <BagPlanCard agreement={agreement} stats={stats} onEdit={onEdit} onPayment={onPayment} onEarning={onEarning} /> : <section className="panel first-bag-card"><span className="first-bag-icon"><Icon name="agreement" size={28} /></span><div className="eyebrow">START HERE</div><h2>Let’s track your purchase</h2><p>Add the agreed price and payment plan. Paylog will show what’s left and estimate when you’ll finish.</p><button className="button button-primary" type="button" onClick={() => onAction('agreement')}><Icon name="plus" size={17} /> Add an item</button></section>}

    <section className="cash-card">
      <div className="cash-card-main"><span className="eyebrow">MONEY YOU’VE KEPT</span><h2>Cash available</h2><strong>{formatMoney(cash.available)}</strong><p>After recorded spending and money given to someone to hold.</p>{cash.shortfall > 0 && <p className="cash-shortfall-message">Recorded payments and spending are {formatMoney(cash.shortfall)} more than your profit.</p>}</div>
      <div className="cash-breakdown"><div><span>Profit kept from recorded work</span><b>{formatMoney(totals.keptEarned)}</b></div>{totals.personalExpenses > 0 && <div><span>Personal spending</span><b>−{formatMoney(totals.personalExpenses)}</b></div>}{totals.reserveOverruns > 0 && <div><span>Payments or item costs above set-asides</span><b>−{formatMoney(totals.reserveOverruns)}</b></div>}{totals.heldFromProfit > 0 && <div><span>Money given to someone to hold</span><b>−{formatMoney(totals.heldFromProfit)}</b></div>}<div className="cash-available-equation"><span>Cash available</span><b>{formatMoney(cash.available)}</b></div>{agreement && <button className="button cash-earn-button" type="button" onClick={() => onEarning(agreement.id)}><Icon name="plus" size={16} /> Add work earnings</button>}<button className="button cash-expense-button" type="button" onClick={() => onAction('expense', null, agreement ? { agreementId: agreement.id } : {})}><Icon name="plus" size={16} /> Record an expense</button></div>
    </section>

    <section className="panel cash-activity-panel">
      <div className="section-heading"><div><div className="eyebrow">YOUR CASH</div><h2>Recent earnings and spending</h2></div></div>
      {cashItems.length ? <div className="activity-list">{cashItems.map((item) => <ActivityRow key={`${item.kind}-${item.id}`} item={item} data={data} onEdit={onEditMoney} onDelete={onDeleteMoney} />)}</div> : <div className="small-empty"><span className="empty-icon"><Icon name="earning" size={20} /></span><b>No cash activity yet</b><p>When you earn from using your item, add it here. Paylog will split the payment and your profit.</p></div>}
    </section>
  </div>;
}

function currentWeekRange(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return { start: localDateString(start), end: localDateString(date) };
}

function AgreementPicker({ agreements, agreement, onSelect }) {
  if (agreements.length < 2) return null;
  return <label className="agreement-picker"><span>Vehicle</span><select aria-label="Choose a vehicle" value={agreement?.id || ''} onChange={(event) => onSelect(event.target.value)}>{agreements.map((item) => <option key={item.id} value={item.id}>{item.item} · {item.payee}</option>)}</select></label>;
}

const vehicleExpenseCategories = new Set(['fuel', 'maintenance', 'tolls', 'vehicle_other']);

function actualVehicleWeek(data, agreementId) {
  const { start, end } = currentWeekRange();
  const earnings = data.earnings.filter((entry) => entry.agreementId === agreementId && entry.date >= start && entry.date <= end);
  const expenses = data.expenses.filter((entry) => entry.agreementId === agreementId && vehicleExpenseCategories.has(entry.category) && entry.date >= start && entry.date <= end);
  return {
    earnings,
    expenses,
    earned: earnings.reduce((sum, entry) => sum + Number(entry.totalAmount || 0), 0),
    kept: earnings.reduce((sum, entry) => sum + Number(entry.keptAmount || 0), 0),
    operatingCosts: expenses.reduce((sum, entry) => sum + Number(entry.amount || 0), 0),
  };
}

function WeeklyVehicleWorkCard({ data, agreement }) {
  const summary = actualVehicleWeek(data, agreement.id);
  const incomeLabel = agreement.incomeType === 'sales' ? 'Sales recorded this week' : 'Work earnings this week';
  const hasActivity = summary.earnings.length > 0 || summary.expenses.length > 0;
  return <article className="overview-cash-card overview-work-week" aria-label="This week’s recorded vehicle work">
    <h3>This week’s work</h3>
    {hasActivity ? <div className="work-week-figures">
      {summary.earned > 0 && <div><span>{incomeLabel}</span><b>{formatMoney(summary.earned)}</b></div>}
      {summary.operatingCosts > 0 && <div><span>Vehicle costs paid</span><b>{formatMoney(summary.operatingCosts)}</b></div>}
      {summary.earnings.length > 0 && <div className="work-week-takehome"><span>Take-home from work</span><b>{formatMoney(summary.kept)}</b></div>}
    </div> : <p className="work-week-empty">No work or vehicle costs recorded this week yet.</p>}
    {hasActivity && summary.earnings.length === 0 && <p className="work-week-empty">No work income has been recorded this week.</p>}
    {summary.expenses.length > 0 && <small>Costs shown are expenses you recorded. Set-asides stay separate until spent.</small>}
  </article>;
}

function OwnerPaymentReminderCard({ agreement, stats, data, onPayment }) {
  const reminder = paymentScheduleReminder(agreement, data);
  const heldByOthers = heldMoneySummary(data, { agreementId: agreement.id });
  const plannedAmount = Math.min(Number(agreement.paymentAmount || 0), stats.remaining);
  const amountDue = reminder?.amountDue > 0.005 ? reminder.amountDue : plannedAmount;
  const date = reminder?.date ? formatDate(reminder.date, { weekday: 'long', day: 'numeric', month: 'short' }) : '';
  const dueStatus = stats.remaining <= 0.005 ? 'This vehicle is paid off.' : reminder?.isOverdue ? `Overdue since ${date}. You can still record a payment any day.` : reminder?.isDue ? 'Your vehicle payment is due today. You can still record it any day.' : reminder ? `Vehicle payment due ${date}. You can record it any day.` : `Your ${agreement.frequency} payment is ${formatMoney(plannedAmount)}. Record it whenever you pay.`;
  const workSetAside = Math.max(0, Number(stats.plan.funds.ownerSetAside) || 0);
  const heldForOwner = heldByOthers.totalReserved;
  const totalSetAside = workSetAside + heldForOwner;
  const savedTowardPayment = Math.min(amountDue, totalSetAside);
  const amountStillToSetAside = Math.max(0, amountDue - totalSetAside);
  const amountBeyondPayment = Math.max(0, totalSetAside - amountDue);
  const savedPercent = amountDue > 0 ? Math.min(100, (savedTowardPayment / amountDue) * 100) : 0;
  return <article className="overview-cash-card overview-owner-reserve" aria-label="Owner payment reminder">
    <span>Next vehicle payment</span>
    <strong>{formatMoney(amountDue)}</strong>
    <small className={reminder?.isOverdue ? 'owner-payment-overdue' : ''}>{dueStatus}</small>
    {stats.remaining > 0.005 && <div className="owner-payment-progress">
      <div className="owner-payment-progress-heading"><span>Saved toward this payment</span><strong>{formatMoney(savedTowardPayment)} <small>of {formatMoney(amountDue)}</small></strong></div>
      <div className="owner-payment-progress-track" role="progressbar" aria-label="Money set aside for next vehicle payment" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(savedPercent)}><span style={{ width: `${savedPercent}%` }} /></div>
      <p className={amountStillToSetAside <= 0.005 ? 'owner-payment-progress-ready' : ''}>{amountStillToSetAside > 0.005 ? `${formatMoney(amountStillToSetAside)} left to set aside. Daily work earnings add to this amount.` : 'This payment is fully set aside. Record it when you pay the owner.'}</p>
      {(workSetAside > 0.005 || heldForOwner > 0.005) && <div className="owner-payment-sources">
        {workSetAside > 0.005 && <div><span>Set aside from work</span><b>{formatMoney(workSetAside)}</b></div>}
        {heldForOwner > 0.005 && <div><span>Reserved with someone else</span><b>{formatMoney(heldForOwner)}</b></div>}
      </div>}
      {amountBeyondPayment > 0.005 && <small className="owner-payment-extra">{formatMoney(amountBeyondPayment)} is also set aside for later payments.</small>}
    </div>}
    {stats.remaining > 0.005 && <><small>Setting money aside does not lower the vehicle balance until you record a payment.</small><button className="button button-primary owner-reserve-action" type="button" onClick={() => onPayment(agreement.id, 'payment')}><Icon name="payment" size={17} /> Record payment to owner</button></>}
  </article>;
}

function OverviewPage({ data, totals, agreements, agreement, onSelectAgreement, onAction, onEdit, onPayment, onBreakdown }) {
  const stats = agreement ? agreementStats(agreement, data) : null;
  const cash = cashPosition(totals);
  return <div className="page-stack overview-page">
    <div className={`overview-title-layout ${agreements.length > 1 ? 'has-picker' : ''}`}>
      <PageTitle title="My Work and Pay vehicle" description="Track your vehicle, work income and payments." action={agreements.length > 0 && <button className="button button-outline title-action" type="button" onClick={() => onAction('agreement')}><Icon name="plus" size={17} /> Add another vehicle</button>} />
      <AgreementPicker agreements={agreements} agreement={agreement} onSelect={onSelectAgreement} />
    </div>
    {agreement && stats ? <>
      <PurchaseBalanceFlipCard agreement={agreement} stats={stats} data={data} totals={totals} onEdit={onEdit} onPayment={onPayment} onBreakdown={onBreakdown} />
    </> : <section className="panel overview-empty"><span className="empty-icon"><Icon name="agreement" size={24} /></span><div><h2>Add your Work and Pay vehicle</h2><p>Enter the vehicle price and payment agreement to start tracking.</p></div><button className="button button-primary" type="button" onClick={() => onAction('agreement')}><Icon name="plus" size={17} /> Add a vehicle</button></section>}
    <section className="overview-cash-section" aria-labelledby="overview-cash-title">
      <div className="overview-section-heading"><div><h2 id="overview-cash-title">Your money and this week’s work</h2><p>Recorded work and cash are separate from the vehicle balance.</p></div></div>
      <div className="overview-cash-summary-grid">
        <article className="overview-cash-card overview-cash-available" aria-label="Cash available after recorded spending">
          <span>Cash available</span><strong>{formatMoney(cash.available)}</strong>
          {cash.shortfall > 0 ? <small className="overview-shortfall-note">Recorded spending is {formatMoney(cash.shortfall)} more than your take-home.</small> : <small>After recorded spending.</small>}
        </article>
        {agreement && <WeeklyVehicleWorkCard data={data} agreement={agreement} />}
        {agreement && <OwnerPaymentReminderCard agreement={agreement} stats={stats} data={data} onPayment={onPayment} />}
      </div>
    </section>
  </div>;
}

function plannedCostRows(agreement, income) {
  const savedCosts = Array.isArray(agreement?.weeklyCosts)
    ? agreement.weeklyCosts.map((cost) => ({ name: `${cost.name}${cost.period === 'monthly' ? ' (monthly avg.)' : ''}`, amount: weeklyCostAmount(cost) })).filter((cost) => cost.amount > 0)
    : [];
  if (savedCosts.length) return savedCosts;
  const legacyCosts = [
    ...(Number(agreement?.weeklyFuelAmount) > 0 ? [{ name: 'Fuel', amount: Number(agreement.weeklyFuelAmount) }] : []),
    ...(Number(agreement?.weeklyMaintenanceAmount) > 0 ? [{ name: 'Maintenance', amount: Number(agreement.weeklyMaintenanceAmount) }] : []),
  ];
  return legacyCosts.length ? legacyCosts : (income.maintenance > 0 ? [{ name: 'Other weekly costs', amount: income.maintenance }] : []);
}

function AllocationCard({ kind, label, amount, weeklyIncome, showPercentage, details = [] }) {
  const percentage = weeklyIncome > 0 ? Math.round((amount / weeklyIncome) * 100) : 0;
  return <article className={`allocation-card allocation-${kind}`}>
    <div className="allocation-card-top"><span className="allocation-icon"><Icon name={kind === 'owner' ? 'payment' : kind === 'kept' ? 'wallet' : 'expense'} size={19} /></span>{showPercentage && <span className="allocation-percent">{percentage}% of income</span>}</div>
    <span className="allocation-label">{label}</span><strong>{formatMoney(amount)}</strong>
    {details.length > 0 && <ul className="allocation-details">{details.map((entry) => <li key={entry.name}><span>{entry.name}</span><b>{formatMoney(entry.amount)}</b></li>)}</ul>}
  </article>;
}

function IncomeAllocation({ income, costs }) {
  const weekly = income.weeklyIncome;
  let remaining = Math.max(0, weekly);
  const owner = Math.min(remaining, income.ownerPayment); remaining -= owner;
  const fuel = Math.min(remaining, income.fuel); remaining -= fuel;
  const other = Math.min(remaining, income.maintenance); remaining -= other;
  const kept = Math.max(0, remaining);
  const pieces = [
    { key: 'owner', label: 'Vehicle owner', amount: owner },
    { key: 'fuel', label: 'Fuel', amount: fuel },
    { key: 'costs', label: 'Vehicle costs', amount: other },
    { key: 'kept', label: 'Take-home', amount: kept },
  ];
  return <section className="allocation-section" aria-labelledby="allocation-heading">
    <div className="breakdown-section-heading"><div><h2 id="allocation-heading">Weekly work split</h2><p>Vehicle payment first, then running costs, then your take-home.</p></div></div>
    {income.ready && weekly > 0 ? <>
      <div className="allocation-bar" role="img" aria-label={pieces.map((piece) => `${piece.label} ${Math.round((piece.amount / weekly) * 100)} percent`).join(', ')}>{pieces.filter((piece) => piece.amount > 0).map((piece) => <span key={piece.key} className={`allocation-bar-segment segment-${piece.key}`} style={{ width: `${(piece.amount / weekly) * 100}%` }} />)}</div>
      <div className="allocation-legend">{pieces.map((piece) => <div key={piece.key}><span className={`legend-mark legend-${piece.key}`} /><span>{piece.label}</span><b>{Math.round((piece.amount / weekly) * 100)}%</b></div>)}</div>
    </> : <div className="allocation-no-income">Add expected daily sales or earnings to see how your week is split.</div>}
    {income.shortfall > 0 && <p className="breakdown-shortfall" role="status">Your plan is short by {formatMoney(income.shortfall)} per week. The vehicle payment comes first.</p>}
    {costs.length > 0 && <p className="allocation-cost-note">Weekly vehicle costs include {costs.map((cost) => cost.name).join(', ')}.</p>}
  </section>;
}

function actualWeekData(data, agreementId) {
  const { start, end } = currentWeekRange();
  const earnings = data.earnings.filter((earning) => earning.date >= start && earning.date <= end && (!agreementId || earning.agreementId === agreementId));
  const expenses = data.expenses.filter((expense) => expense.date >= start && expense.date <= end && (!agreementId || expense.agreementId === agreementId));
  return {
    earnings,
    expenses,
    totalIncome: earnings.reduce((sum, earning) => sum + Number(earning.totalAmount || 0), 0),
    owner: earnings.reduce((sum, earning) => sum + Number(earning.paymentAmount || 0), 0),
    fuel: earnings.reduce((sum, earning) => sum + Number(earning.fuelAmount || 0), 0),
    costs: earnings.reduce((sum, earning) => sum + Number(earning.maintenanceAmount || 0), 0),
    kept: earnings.reduce((sum, earning) => sum + Number(earning.keptAmount || 0), 0),
    expenseTotal: expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0),
  };
}

function IncomeBreakdownPage({ data, agreements, agreement, onSelectAgreement, onAction, onEdit, onDelete }) {
  const stats = agreement ? agreementStats(agreement, data) : null;
  const income = stats?.plan.income;
  const costs = agreement && income ? plannedCostRows(agreement, income) : [];
  const otherCosts = costs.filter((cost) => cost.name.trim().toLocaleLowerCase() !== 'fuel');
  const actual = actualWeekData(data, agreement?.id);
  const recentMoneyActivity = [...data.earnings.filter((entry) => entry.agreementId === agreement?.id).map((entry) => ({ ...entry, kind: 'earning' })), ...data.expenses.filter((entry) => entry.agreementId === agreement?.id).map((entry) => ({ ...entry, kind: 'expense' }))]
    .sort((a, b) => `${b.date} ${b.time || ''} ${b.createdAt || b.id}`.localeCompare(`${a.date} ${a.time || ''} ${a.createdAt || a.id}`)).slice(0, 8);
  const vehicleExpenses = data.expenses.filter((expense) => expense.agreementId === agreement?.id);
  const monthlyCategories = spendingByCategory(vehicleExpenses);
  const monthlySpent = Object.values(monthlyCategories).reduce((sum, amount) => sum + amount, 0);
  const monthlyRows = ['fuel', 'maintenance', 'tolls', 'vehicle_other']
    .map((category) => ({ category, amount: monthlyCategories[category] || 0 }))
    .filter((entry) => entry.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const percentagesValid = Boolean(income?.ready && income.weeklyIncome > 0 && income.shortfall <= 0.005);
  return <div className="page-stack breakdown-page">
    <PageTitle title="Work and earnings" description="See your vehicle payment plan and recorded work." />
    <AgreementPicker agreements={agreements} agreement={agreement} onSelect={onSelectAgreement} />
    {agreement && income ? <>
      <section className="income-plan-hero"><div><span>{income.ready ? `Planned weekly ${agreement.incomeType === 'sales' ? 'sales' : 'earnings'}` : 'Weekly work income plan'}</span><strong>{formatMoney(income.weeklyIncome)}</strong><small>{income.ready ? `${income.daysWorkedPerWeek} days worked each week` : 'Add daily sales or earnings to set a plan'}</small></div><span className="income-plan-icon"><Icon name="earning" size={24} /></span></section>
      <section className="allocation-cards" aria-label="Planned weekly allocations">
        <AllocationCard kind="owner" label="Vehicle owner payment" amount={income.ownerPayment} weeklyIncome={income.weeklyIncome} showPercentage={percentagesValid} />
        {income.fuel > 0 && <AllocationCard kind="fuel" label="Fuel" amount={income.fuel} weeklyIncome={income.weeklyIncome} showPercentage={percentagesValid} />}
        {income.maintenance > 0 && <AllocationCard kind="costs" label="Servicing and operating costs" amount={income.maintenance} weeklyIncome={income.weeklyIncome} showPercentage={percentagesValid} details={otherCosts} />}
        <AllocationCard kind="kept" label="Estimated take-home / week" amount={income.keptWeekly} weeklyIncome={income.weeklyIncome} showPercentage={percentagesValid} />
      </section>
      <IncomeAllocation income={income} costs={otherCosts} />
      <section className="breakdown-secondary-grid">
        <details className="secondary-finance-card"><summary>Per-day plan</summary><div className="secondary-finance-rows"><div><span>Vehicle payment</span><b>{formatMoney(income.ownerPerDay)}</b></div>{income.fuel > 0 && <div><span>Fuel</span><b>{formatMoney(income.fuelPerDay)}</b></div>}{income.maintenance > 0 && <div><span>Vehicle costs</span><b>{formatMoney(income.maintenancePerDay)}</b></div>}<div><span>Take-home</span><b>{formatMoney(income.keptPerDay)}</b></div></div></details>
        <section className="secondary-finance-card payoff-finance-card"><h2>Vehicle payoff estimate</h2><PayoffSummary estimate={stats.payoff} compact showBalances={false} /></section>
      </section>
      {(stats.plan.funds.ownerSetAside > 0 || stats.plan.funds.fuelSetAside > 0 || stats.plan.funds.maintenanceSetAside > 0) && <section className="set-aside-card"><h2>Set aside from recorded work</h2><div className="secondary-finance-rows">{stats.plan.funds.ownerSetAside > 0 && <div><span>For vehicle payment</span><b>{formatMoney(stats.plan.funds.ownerSetAside)}</b></div>}{stats.plan.funds.fuelSetAside > 0 && <div><span>For fuel</span><b>{formatMoney(stats.plan.funds.fuelSetAside)}</b></div>}{stats.plan.funds.maintenanceSetAside > 0 && <div><span>For vehicle costs</span><b>{formatMoney(stats.plan.funds.maintenanceSetAside)}</b></div>}</div>{stats.plan.funds.amountBeyondReserve > 0 && <p>{formatMoney(stats.plan.funds.amountBeyondReserve)} in payments or vehicle costs came from your cash because the set-asides were short.</p>}</section>}
      <section className="actual-week-section" aria-labelledby="actual-week-title">
        <div className="actual-week-heading"><div><h2 id="actual-week-title">This week’s recorded work</h2><p>Actual activity, separate from the plan.</p></div><div className="actual-week-actions"><button className="button button-outline" type="button" onClick={() => onAction('earning', null, { agreementId: agreement.id })}><Icon name="earning" size={16} /> Add sales or earnings</button><button className="button button-outline" type="button" onClick={() => onAction('expense')}><Icon name="plus" size={16} /> Add vehicle cost</button></div></div>
        {actual.earnings.length === 0 && actual.expenses.length === 0 ? <div className="actual-week-empty"><strong>Nothing recorded this week yet</strong><p>Add daily work income and vehicle costs to see your actual results.</p></div> : <>
          {actual.earnings.length > 0 ? <>
            <div className="actual-summary-grid"><div><span>{agreement.incomeType === 'sales' ? 'Sales recorded' : 'Work earnings'}</span><b>{formatMoney(actual.totalIncome)}</b></div><div><span>Set aside for owner</span><b>{formatMoney(actual.owner)}</b></div><div><span>Set aside for vehicle costs</span><b>{formatMoney(actual.fuel + actual.costs)}</b></div><div><span>Take-home from work</span><b>{formatMoney(actual.kept)}</b></div></div>
            {income.ready ? <p className={`actual-vs-plan actual-vs-plan-${income.actualStatus}`}>Recorded income is {income.actualStatus === 'ahead' ? `ahead by ${formatMoney(income.actualDifference)}` : income.actualStatus === 'behind' ? `behind by ${formatMoney(income.actualDifference)}` : 'on plan'} this week.</p> : <p className="actual-week-note">Add expected daily income to compare this activity with your plan.</p>}
          </> : <p className="actual-week-note">No work earnings logged yet this week.</p>}
          {actual.expenses.length > 0 && <p className="actual-week-expenses">Vehicle costs paid this week: <b>{formatMoney(actual.expenseTotal)}</b></p>}
        </>}
      </section>
      <section className="breakdown-history-grid">
        <section className="monthly-spending-card" aria-labelledby="monthly-spending-title"><div className="breakdown-section-heading"><div><h2 id="monthly-spending-title">Vehicle costs this month</h2><p>{formatMoney(monthlySpent)} recorded for this vehicle.</p></div><button className="button button-outline" type="button" onClick={() => onAction('expense')}><Icon name="plus" size={16} /> Add vehicle cost</button></div>
          {monthlyRows.length ? <div className="monthly-category-list">{monthlyRows.map(({ category, amount }) => <div className="monthly-category-row" key={category}><span className={`category-icon ${categoryColors[category]}`}><Icon name={categoryIcons[category]} size={17} /></span><span>{categoryLabels[category]}</span><b>{formatMoney(amount)}</b></div>)}</div> : <div className="monthly-spending-empty">No vehicle costs recorded this month.</div>}
        </section>
        <section className="recent-money-card" aria-labelledby="recent-money-title"><div className="breakdown-section-heading"><div><h2 id="recent-money-title">Recent earnings and spending</h2><p>Update or remove an entry anytime.</p></div></div>
          {recentMoneyActivity.length ? <div className="activity-list">{recentMoneyActivity.map((item) => <ActivityRow key={`${item.kind}-${item.id}`} item={item} data={data} onEdit={onEdit} onDelete={onDelete} />)}</div> : <div className="monthly-spending-empty">Your earnings and expenses will appear here.</div>}
        </section>
      </section>
    </> : <section className="panel overview-empty"><span className="empty-icon"><Icon name="spark" size={23} /></span><div><h2>Add a vehicle to see your work breakdown</h2><p>Your weekly plan and recorded work will appear here.</p></div><button className="button button-primary" type="button" onClick={() => onAction('agreement')}><Icon name="plus" size={17} /> Add a vehicle</button></section>}
  </div>;
}

function PaymentHistoryRow({ payment, agreement, data, onEdit, onDelete }) {
  const linkedEarning = payment.type === 'earning' ? data.earnings.find((entry) => entry.id === payment.earningId) : null;
  const recordedTime = formatTime(payment.time);
  return <article className="history-row">
    <span className="history-row-icon"><Icon name="payment" size={19} /></span>
    <div className="history-row-details"><strong>{payment.type === 'opening' ? 'Previous payments' : `Payment to ${agreement?.payee || 'vehicle owner'}`}</strong><span>{agreement?.item || 'Vehicle'}{agreement?.vehicleRegistrationNumber ? ` · ${agreement.vehicleRegistrationNumber}` : ''}{payment.fundingSource === 'held' ? ` · Paid directly by ${payment.holderName || 'holder'}` : ''}{payment.note && payment.type !== 'opening' ? ` · ${payment.note}` : ''}</span><small>{formatDate(payment.date)}{recordedTime ? ` · ${recordedTime}` : ' · Time not recorded'}</small><PaymentReceipt path={payment.receiptPath} /></div>
    <div className="history-row-amount"><b>{formatMoney(payment.amount)}</b><div className="row-actions"><button className="mini-action" type="button" onClick={() => onEdit(linkedEarning || payment)} aria-label="Edit payment"><Icon name="edit" size={15} /></button><button className="mini-action" type="button" onClick={() => onDelete({ ...payment, kind: 'payment' })} aria-label="Delete payment"><Icon name="trash" size={15} /></button></div></div>
  </article>;
}

function PaymentHistoryPage({ data, totals, agreements, onPayment, onEditPayment, onDeletePayment }) {
  const [filter, setFilter] = useState(() => agreements.length === 1 ? agreements[0].id : 'all');
  const visibleAgreements = filter === 'all' ? agreements : agreements.filter((agreement) => agreement.id === filter);
  const visiblePayments = data.payments.filter((payment) => filter === 'all' || payment.agreementId === filter)
    .slice().sort((a, b) => `${b.date} ${b.time || ''} ${b.createdAt || b.id}`.localeCompare(`${a.date} ${a.time || ''} ${a.createdAt || a.id}`));
  const totalPrice = visibleAgreements.reduce((sum, item) => sum + Number(item.totalPrice || 0), 0);
  const totalPaid = visiblePayments.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const balance = Math.max(0, totalPrice - totalPaid);
  const selected = agreements.find((agreement) => agreement.id === filter);

  return <div className="page-stack history-page">
    <PageTitle title="Vehicle payment history" description="A clear record of what you’ve paid the vehicle owner." action={agreements.length > 0 && <button className="button button-primary title-action" type="button" onClick={() => onPayment(selected?.id || agreements[0].id)}><Icon name="plus" size={17} /> Record payment</button>} />
    <ProfitSummaryCard data={data} totals={totals} />
    {agreements.length > 1 && <label className="history-filter"><span>Show payments for</span><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All vehicles</option>{agreements.map((agreement) => <option key={agreement.id} value={agreement.id}>{agreement.item} · {agreement.payee}</option>)}</select></label>}
    {agreements.length ? <section className="panel payment-statement">
      <div className="statement-heading"><div><div className="eyebrow">PAYLOG VEHICLE STATEMENT</div><h2>{selected ? `${selected.item} payments` : 'All vehicle payments'}</h2><p>{selected ? `Paid to ${selected.payee}` : `${agreements.length} tracked ${agreements.length === 1 ? 'vehicle' : 'vehicles'}`}</p></div><div className="statement-actions"><button className="button button-outline" type="button" onClick={() => window.print()} disabled={!visiblePayments.length}><Icon name="print" size={17} /> Print / Save PDF</button><button className="button button-outline" type="button" onClick={() => downloadFile(`paylog-vehicle-payment-history-${localDateString()}.csv`, paymentCsv(visiblePayments, agreements))} disabled={!visiblePayments.length}><Icon name="backup" size={17} /> Download CSV</button></div></div>
      <div className="statement-totals"><div><span>Agreed vehicle price</span><b>{formatMoney(totalPrice)}</b></div><div><span>Paid to owner</span><b>{formatMoney(totalPaid)}</b></div><div><span>Vehicle balance remaining</span><b>{formatMoney(balance)}</b></div></div>
      <div className="statement-print-meta">Generated {new Intl.DateTimeFormat('en-GH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())}</div>
      <div className="history-list-heading"><h3>Payments to the owner</h3><span>{visiblePayments.length} {visiblePayments.length === 1 ? 'entry' : 'entries'}</span></div>
      {visiblePayments.length ? <div className="history-list">{visiblePayments.map((payment) => <PaymentHistoryRow key={payment.id} payment={payment} agreement={agreements.find((item) => item.id === payment.agreementId)} data={data} onEdit={onEditPayment} onDelete={onDeletePayment} />)}</div> : <div className="small-empty history-empty"><span className="empty-icon"><Icon name="payment" size={20} /></span><b>No vehicle payments recorded yet</b><p>Record a payment after the owner receives it. The date, time and amount will appear on your statement.</p>{agreements.length > 0 && <button className="button button-primary" type="button" onClick={() => onPayment(selected?.id || agreements[0].id)}><Icon name="plus" size={17} /> Record first payment</button>}</div>}
    </section> : <section className="panel first-bag-card"><span className="first-bag-icon"><Icon name="history" size={27} /></span><div className="eyebrow">PAYMENT PROOF</div><h2>Add your vehicle plan first</h2><p>Once your Work and Pay vehicle is saved, each owner payment will appear here with its date, time and amount.</p></section>}
    <p className="history-proof-tip"><Icon name="check" size={16} /><span>Use <b>Print / Save PDF</b> to share a clean payment statement.</span></p>
  </div>;
}

function AgreementCard({ agreement, data, expanded, onToggle, onPayment, onEdit, onEditPayment, onDeletePayment }) {
  const stats = agreementStats(agreement, data);
  const payments = data.payments.filter((payment) => payment.agreementId === agreement.id).sort((a, b) => b.date.localeCompare(a.date));
  return <article className={`agreement-card ${expanded ? 'expanded' : ''}`}>
    <div className="agreement-card-top">
      <div className="agreement-identity"><span className="agreement-avatar">{agreement.item.slice(0, 1).toUpperCase()}</span><div><div className="agreement-item-line"><h3>{agreement.item}</h3><StatusPill status={stats.status} label={stats.statusLabel} /></div><span>{agreement.payee}</span></div></div>
      <button className="button button-small button-outline" type="button" onClick={() => onEdit(agreement)}><Icon name="edit" size={15} /> Edit</button>
    </div>
    <div className="agreement-balance-row"><div><span className="field-label">Balance remaining</span><strong>{formatMoney(stats.remaining)}</strong></div><div className="agreement-paid"><span className="field-label">Paid of {formatMoney(agreement.totalPrice)}</span><strong>{formatMoney(stats.paid)}</strong></div></div>
    <ProgressBar value={stats.progress} />
    <div className="progress-caption"><span>{Math.round(stats.progress)}% complete</span></div>
    <PayoffSummary estimate={stats.payoff} compact />
    <div className="agreement-facts"><span>{agreement.frequency[0].toUpperCase() + agreement.frequency.slice(1)} · {formatMoney(agreement.paymentAmount)} per payment</span></div>
    <div className="agreement-card-actions"><button className="button button-primary" type="button" onClick={() => onPayment(agreement.id)}><Icon name="plus" size={16} /> Add payment</button><button className="button button-quiet" type="button" onClick={onToggle}>{expanded ? 'Hide log' : `Payment log (${payments.length})`}<Icon name={expanded ? 'close' : 'arrow'} size={15} /></button></div>
    {expanded && <div className="payment-log"><div className="payment-log-heading"><div><div className="eyebrow">History</div><h4>Payments log</h4></div><span>{formatMoney(stats.paid)} total paid</span></div>
      {payments.length ? <div className="activity-list compact-activity">{payments.map((payment) => <ActivityRow key={payment.id} item={{ ...payment, kind: 'payment' }} data={data} onEdit={(entry) => onEditPayment(payment)} onDelete={() => onDeletePayment(payment)} />)}</div> : <p className="log-empty">No payments recorded yet. Add your first payment when you’re ready.</p>}
    </div>}
  </article>;
}

function Agreements({ data, onAction, onEdit, onPayment, onEditPayment, onDeletePayment }) {
  const [expanded, setExpanded] = useState('');
  const ordered = [...data.agreements].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return <div className="page-stack">
    <PageTitle eyebrow="Your plans" title="Agreements" description="Track each item, its payments and your progress." action={<button className="button button-primary title-action" type="button" onClick={() => onAction('agreement')}><Icon name="plus" size={17} /> New agreement</button>} />
    {ordered.length ? <div className="agreement-list">{ordered.map((agreement) => <AgreementCard key={agreement.id} agreement={agreement} data={data} expanded={expanded === agreement.id} onToggle={() => setExpanded((current) => current === agreement.id ? '' : agreement.id)} onPayment={onPayment} onEdit={onEdit} onEditPayment={onEditPayment} onDeletePayment={onDeletePayment} />)}</div> : <div className="panel empty-panel"><EmptyState icon="agreement" title="No agreements to track yet" description="Add the seller, item, total price and payment plan. If you have already paid some, add the opening balance too." action="Create your first agreement" onClick={() => onAction('agreement')} /></div>}
  </div>;
}

const categoryColors = { food: 'cat-food', transport: 'cat-transport', fuel: 'cat-fuel', maintenance: 'cat-maintenance', tolls: 'cat-transport', vehicle_other: 'cat-other', family: 'cat-family', savings: 'cat-savings', other: 'cat-other' };
const categoryIcons = { food: 'expense', transport: 'arrow', fuel: 'expense', maintenance: 'agreement', tolls: 'arrow', vehicle_other: 'more', family: 'home', savings: 'wallet', other: 'more' };
const categoryLabels = { food: 'Food', transport: 'Personal transport', fuel: 'Vehicle fuel', maintenance: 'Servicing and repairs', tolls: 'Tolls and parking', vehicle_other: 'Other vehicle costs', family: 'Family', savings: 'Savings', other: 'Other' };

function MoneyPage({ data, totals, onAction, onEdit, onDelete }) {
  const cash = cashPosition(totals);
  const categories = spendingByCategory(data.expenses);
  const total = Object.values(categories).reduce((sum, amount) => sum + amount, 0);
  const categoryRows = ['food', 'transport', 'fuel', 'maintenance', 'tolls', 'vehicle_other', 'family', 'savings', 'other'].map((category) => ({ category, amount: categories[category] || 0 })).filter((entry) => entry.amount > 0).sort((a, b) => b.amount - a.amount);
  const expenses = data.expenses.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);
  return <div className="page-stack">
    <PageTitle eyebrow={new Intl.DateTimeFormat('en-GH', { month: 'long', year: 'numeric' }).format(new Date())} title="My money" description="See what you’ve kept and where it goes." action={<button className="button button-primary title-action" type="button" onClick={() => onAction('expense')}><Icon name="plus" size={17} /> Add expense</button>} />
    <section className="money-hero"><div className="money-hero-main"><span className="eyebrow">Cash available</span><strong>{formatMoney(cash.available)}</strong><span>After recorded spending and money held by others.</span>{cash.shortfall > 0 && <span className="money-hero-shortfall">Recorded payments and spending are {formatMoney(cash.shortfall)} more than your profit.</span>}</div><div className="money-hero-mark"><Icon name="wallet" size={30} /></div><div className="money-hero-side"><span>Profit kept from recorded work</span><strong>{formatMoney(totals.keptEarned)}</strong><span>This is actual profit from saved earnings.</span></div></section>
    <div className="money-columns">
      <section className="panel category-panel"><div className="section-heading"><div><div className="eyebrow">This month</div><h2>Spending by category</h2></div><span className="subtle-total">{formatMoney(total)}</span></div>
        {categoryRows.length ? <div className="category-list">{categoryRows.map(({ category, amount }) => <div className="category-row" key={category}><span className={`category-icon ${categoryColors[category]}`}><Icon name={categoryIcons[category]} size={17} /></span><div className="category-info"><div><b>{categoryLabels[category]}</b><strong>{formatMoney(amount)}</strong></div><div className="category-track"><span className={categoryColors[category]} style={{ width: `${total ? (amount / total) * 100 : 0}%` }} /></div></div><small>{total ? Math.round((amount / total) * 100) : 0}%</small></div>)}</div> : <div className="small-empty category-empty"><span className="empty-icon"><Icon name="expense" /></span><b>No spending recorded this month</b><p>Add a vehicle or personal expense to see where it goes.</p><button className="text-button" type="button" onClick={() => onAction('expense')}><Icon name="plus" size={16} /> Add expense</button></div>}
      </section>
      <section className="panel expense-list-panel"><div className="section-heading"><div><div className="eyebrow">Your records</div><h2>Recent expenses</h2></div><span className="subtle-total">{data.expenses.length} total</span></div>
        {expenses.length ? <div className="activity-list">{expenses.map((expense) => <ActivityRow key={expense.id} item={{ ...expense, kind: 'expense' }} data={data} onEdit={onEdit} onDelete={onDelete} />)}</div> : <p className="log-empty">Expenses you add will appear here.</p>}
      </section>
    </div>
  </div>;
}

function BackupPage({ data, onRestore }) {
  const fileInput = useRef(null);
  const [message, setMessage] = useState('');
  function download(name, mime, content) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = name; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const stamp = localDateString();
  async function restore(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const restored = repository.parseBackup(await file.text());
      if (!window.confirm(`Restore this backup? It will replace the data currently saved to your Supabase account. The backup contains ${restored.agreements.length} agreements, ${restored.payments.length} payments, ${restored.earnings.length} earnings and ${restored.expenses.length} expenses.`)) return;
      const saved = await onRestore(restored);
      if (saved === false) { setMessage('The backup could not be saved. Check your Supabase configuration and try again.'); return; }
      setMessage('Backup restored. Your Paylog data has been updated.');
    } catch (error) {
      setMessage(error instanceof SyntaxError ? 'That file is not valid JSON. Choose a Paylog backup file.' : (error.message || 'This file could not be restored.'));
    }
  }
  return <div className="page-stack">
    <PageTitle eyebrow="Keep it safe" title="Your data" description="Your records are saved privately to Supabase for this browser. Download a copy before clearing browser data or switching devices." />
    <div className="backup-grid">
      <section className="panel backup-card"><span className="backup-illustration csv-illustration"><Icon name="payment" size={25} /><small>.CSV</small></span><div className="eyebrow">Take your records</div><h2>Export to CSV</h2><p>Download agreements, payments, earnings and expenses in a spreadsheet friendly file.</p><button className="button button-primary" type="button" onClick={() => download(`paylog-export-${stamp}.csv`, 'text/csv;charset=utf-8', `\uFEFF${repository.exportCsv(data)}`)}><Icon name="backup" size={17} /> Export CSV</button></section>
      <section className="panel backup-card"><span className="backup-illustration json-illustration"><Icon name="backup" size={25} /><small>.JSON</small></span><div className="eyebrow">Make a full copy</div><h2>Backup or restore</h2><p>Your records are included in the JSON file. Receipt images stay in private Supabase Storage and are not embedded in the backup.</p><div className="backup-actions"><button className="button button-outline" type="button" onClick={() => download(`paylog-backup-${stamp}.json`, 'application/json', repository.backupJson(data))}><Icon name="backup" size={17} /> Download backup</button><button className="button button-quiet" type="button" onClick={() => fileInput.current?.click()}>Restore from file <Icon name="arrow" size={16} /></button><input ref={fileInput} className="visually-hidden" type="file" accept="application/json,.json" onChange={restore} /></div></section>
    </div>
    {message && <div className="backup-message" role="status"><Icon name="check" size={17} />{message}<button className="icon-button small-icon" type="button" onClick={() => setMessage('')} aria-label="Dismiss"><Icon name="close" size={16} /></button></div>}
    <section className="privacy-note"><span className="privacy-icon"><Icon name="wallet" size={18} /></span><div><b>Saved privately with Supabase</b><p>Paylog uses a private anonymous account for this browser. Clearing browser storage or changing devices creates a different account, so export a backup regularly.</p></div></section>
    <section className="data-counts"><div><b>{data.agreements.length}</b><span>Agreements</span></div><div><b>{data.payments.length}</b><span>Payments</span></div><div><b>{data.earnings.length}</b><span>Earnings</span></div><div><b>{data.expenses.length}</b><span>Expenses</span></div></section>
  </div>;
}

function RecordsPage({ data, totals, onAction, onEdit, onDelete, onPayment, onEditPayment, onDeletePayment, onRestore }) {
  return <div className="records-page">
    <Agreements data={data} onAction={onAction} onEdit={onEdit} onPayment={onPayment} onEditPayment={onEditPayment} onDeletePayment={onDeletePayment} />
    <MoneyPage data={data} totals={totals} onAction={onAction} onEdit={onEdit} onDelete={onDelete} />
    <BackupPage data={data} onRestore={onRestore} />
  </div>;
}

export default function App() {
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [storageError, setStorageError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [resettingTestData, setResettingTestData] = useState(false);
  const [page, setPage] = useState(initialPage);
  const [selectedAgreementId, setSelectedAgreementId] = useState('');
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState('');
  const totals = useMemo(() => dashboardTotals(data), [data]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setStorageError('');
    repository.load().then((saved) => { if (active) setData(saved); }).catch((error) => {
      if (active) setStorageError(error.message || 'Paylog could not connect to Supabase. Check your environment variables and database setup.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reloadKey]);

  async function write(nextData, message) {
    try {
      const saved = await repository.save(typeof nextData === 'function' ? nextData(data) : nextData);
      setData(saved);
      setModal(null);
      setStorageError('');
      if (message) setToast(message);
      window.setTimeout(() => setToast(''), 3200);
      return true;
    } catch (error) {
      setToast(error.message || 'Could not save to Supabase. Check your configuration and try again.');
      return false;
    }
  }

  async function resetTestData() {
    if (!import.meta.env.DEV || loading || storageError || resettingTestData) return;
    const answer = window.prompt('This clears Paylog records for the test session open in this browser only. It will not affect other users. Type RESET TEST DATA to continue.');
    if (answer !== 'RESET TEST DATA') return;

    setResettingTestData(true);
    try {
      const cleared = await repository.resetCurrentUserData();
      setData(cleared);
      setSelectedAgreementId('');
      setModal(null);
      goto('overview');
      setToast('Test data cleared for this browser.');
      window.setTimeout(() => setToast(''), 3200);
    } catch (error) {
      setToast(error.message || 'Could not clear test data.');
      window.setTimeout(() => setToast(''), 3200);
    } finally {
      setResettingTestData(false);
    }
  }

  function handleAgreementSave(values) {
    const editing = modal?.entity;
    if (!values.payee.trim() || !values.item.trim() || values.totalPrice <= 0 || values.paymentAmount <= 0 || !values.startDate || (values.frequency === 'weekly' && (values.paymentDay === '' || values.paymentDay == null))) return;
    if (editing) {
      const { openingAmount, pastPayments, ...agreementValues } = values;
      agreementValues.paymentDay = values.frequency === 'weekly' ? Number(values.paymentDay) : '';
      const next = { ...data, agreements: data.agreements.map((agreement) => agreement.id === editing.id ? { ...agreement, ...agreementValues } : agreement) };
      const entries = next.payments.slice();
      const openingIndex = entries.findIndex((payment) => payment.agreementId === editing.id && payment.type === 'opening');
      const openingAmountValue = Number(openingAmount) || 0;
      if (openingAmountValue > 0) {
        const opening = { id: openingIndex >= 0 ? entries[openingIndex].id : makeId(), agreementId: editing.id, date: values.startDate, amount: openingAmountValue, note: 'Previous payments', type: 'opening' };
        if (openingIndex >= 0) entries[openingIndex] = opening; else entries.push(opening);
      } else if (openingIndex >= 0) entries.splice(openingIndex, 1);
      next.payments = entries;
      write(next, 'Vehicle plan updated.');
      return;
    }
    const id = makeId();
    const agreement = { id, payee: values.payee.trim(), item: values.item.trim(), vehicleRegistrationNumber: values.vehicleRegistrationNumber.trim(), incomeType: values.incomeType === 'sales' ? 'sales' : 'earnings', totalPrice: values.totalPrice, paymentAmount: values.paymentAmount, frequency: values.frequency, paymentDay: values.frequency === 'weekly' ? Number(values.paymentDay) : '', startDate: values.startDate, dailyIncome: values.dailyIncome, daysWorkedPerWeek: values.daysWorkedPerWeek, weeklyCosts: values.weeklyCosts ?? [], weeklyFuelAmount: values.weeklyFuelAmount, weeklyMaintenanceAmount: values.weeklyMaintenanceAmount, createdAt: new Date().toISOString() };
    const payments = [...data.payments];
    if (values.openingAmount > 0) payments.push({ id: makeId(), agreementId: id, date: values.startDate, amount: values.openingAmount, note: 'Previous payments', type: 'opening' });
    (values.pastPayments || []).forEach((payment) => payments.push({ id: makeId(), agreementId: id, date: payment.date, amount: payment.amount, note: 'Past payment', type: 'manual' }));
    setSelectedAgreementId(id);
    write({ ...data, agreements: [...data.agreements, agreement], payments }, 'Vehicle plan saved.');
  }

  function handleHeldTransferSave(values) {
    try {
      const next = recordHeldTransfer(data, { ...values, id: makeId(), createdAt: new Date().toISOString() });
      return write(next, values.type === 'given' ? 'Money held recorded.' : 'Money returned recorded.');
    } catch (error) {
      setToast(error.message || 'Could not save this held-money record.');
      return false;
    }
  }

  function handleOwnerAllocationSave(values) {
    try {
      const next = recordOwnerAllocation(data, { ...values, id: makeId(), createdAt: new Date().toISOString() });
      return write(next, values.type === 'set_aside' ? 'Money set aside for the owner.' : 'Owner set-aside released.');
    } catch (error) {
      setToast(error.message || 'Could not update this owner set-aside.');
      return false;
    }
  }

  async function handlePaymentSave(values) {
    if (!values.agreementId || values.amount <= 0) return false;
    const editing = modal?.entity;
    const paymentId = editing?.id ?? makeId();
    let ledgerFields = null;
    if (editing?.type !== 'opening') {
      try {
        ledgerFields = paymentLedgerFields(data, { ...values, excludePaymentId: editing?.id ?? '' });
      } catch (error) {
        setToast(error.message || 'Check the money source for this payment.');
        return false;
      }
    }
    const previousReceiptPath = editing?.receiptPath ?? '';
    let receiptPath = previousReceiptPath;
    let uploadedPath = '';
    try {
      if (values.receiptFile) {
        uploadedPath = await repository.uploadPaymentReceipt(paymentId, values.receiptFile);
        receiptPath = uploadedPath;
      } else if (values.removeReceipt) {
        receiptPath = '';
      }

      const { receiptFile: _receiptFile, removeReceipt: _removeReceipt, ...paymentValues } = values;
      if (editing?.type === 'opening') {
        delete paymentValues.fundingSource;
        delete paymentValues.holderId;
        delete paymentValues.holderName;
        delete paymentValues.reserveConsumption;
      } else {
        Object.assign(paymentValues, ledgerFields);
      }
      const updatedPayment = editing
        ? { ...editing, ...paymentValues, id: paymentId, agreementId: editing.type === 'opening' ? editing.agreementId : values.agreementId, date: editing.type === 'opening' ? (data.agreements.find((agreement) => agreement.id === editing.agreementId)?.startDate ?? values.date) : values.date, time: values.time || '', amount: values.amount, note: editing.type === 'opening' ? 'Previous payments' : values.note, createdAt: editing.createdAt ?? new Date().toISOString() }
        : { id: paymentId, ...paymentValues, type: 'manual', createdAt: new Date().toISOString() };
      if (receiptPath) updatedPayment.receiptPath = receiptPath;
      else delete updatedPayment.receiptPath;

      const nextPayments = editing
        ? data.payments.map((payment) => payment.id === editing.id ? updatedPayment : payment)
        : [...data.payments, updatedPayment];
      const saved = await write({ ...data, payments: nextPayments }, editing ? 'Payment updated.' : 'Payment recorded.');
      if (!saved) {
        if (uploadedPath) await repository.deletePaymentReceipt(uploadedPath).catch(() => { });
        return false;
      }
      if (previousReceiptPath && previousReceiptPath !== receiptPath) {
        await repository.deletePaymentReceipt(previousReceiptPath).catch(() => setToast('Payment saved, but the replaced receipt could not be removed.'));
      }
      return true;
    } catch (error) {
      if (uploadedPath) await repository.deletePaymentReceipt(uploadedPath).catch(() => { });
      setToast(error.message || 'Could not save this payment. Please try again.');
      return false;
    }
  }

  function handleEarningSave(values) {
    if (values.totalAmount <= 0 || Math.abs(values.paymentAmount + values.fuelAmount + values.maintenanceAmount + values.keptAmount - values.totalAmount) > 0.011 || ((values.paymentAmount > 0 || values.fuelAmount > 0 || values.maintenanceAmount > 0) && !values.agreementId)) return;
    const editing = modal?.entity;
    const id = editing?.id ?? makeId();
    const existingPaymentId = editing?.paymentId;
    // Legacy earnings may already have a linked payment. Preserve edits to that
    // historical payment, but never create a payment from a new earning.
    let paymentId = existingPaymentId ?? '';
    let payments = data.payments;
    if (existingPaymentId) {
      if (values.paymentAmount > 0) {
        payments = data.payments.map((payment) => payment.id === existingPaymentId ? { ...payment, agreementId: values.agreementId, date: values.date, time: values.time || '', amount: values.paymentAmount, note: values.note || 'From work' } : payment);
      } else {
        payments = data.payments.filter((payment) => payment.id !== existingPaymentId);
        paymentId = '';
      }
    }
    const earning = { id, ...values, agreementId: values.agreementId || '', paymentId, createdAt: editing?.createdAt ?? new Date().toISOString() };
    const earnings = editing ? data.earnings.map((entry) => entry.id === id ? earning : entry) : [...data.earnings, earning];
    const previousMaintenance = (data.maintenanceRecords || []).find((entry) => entry.earningId === id);
    const maintenanceRecords = (data.maintenanceRecords || []).filter((entry) => entry.earningId !== id);
    if (values.maintenanceAmount > 0) maintenanceRecords.push({ id: previousMaintenance?.id ?? makeId(), earningId: id, agreementId: values.agreementId || '', date: values.date, amount: values.maintenanceAmount, note: values.note || 'Maintenance set aside from work', createdAt: previousMaintenance?.createdAt ?? new Date().toISOString() });
    write({ ...data, earnings, payments, maintenanceRecords }, 'Earning saved.');
  }

  function handleExpenseSave(values) {
    if (values.amount <= 0 || (vehicleExpenseCategories.has(values.category) && !values.agreementId)) return;
    const editing = modal?.entity;
    const expense = { id: editing?.id ?? makeId(), ...values };
    const expenses = editing ? data.expenses.map((entry) => entry.id === expense.id ? expense : entry) : [...data.expenses, expense];
    write({ ...data, expenses }, 'Expense saved.');
  }

  function editActivity(item) {
    if (!item) return;
    if (item.kind === 'expense') setModal({ type: 'expense', entity: item });
    else if (item.kind === 'earning' || data.earnings.some((entry) => entry.id === item.id)) setModal({ type: 'earning', entity: data.earnings.find((entry) => entry.id === item.id) || item });
    else if (item.type === 'earning') {
      const earning = data.earnings.find((entry) => entry.id === item.earningId);
      if (earning) setModal({ type: 'earning', entity: earning });
    } else setModal({ type: 'payment', entity: item });
  }

  async function deleteActivity(item) {
    if (item.kind === 'payment' && item.type === 'earning') {
      if (!window.confirm('This payment is linked to a work earning. Delete both the payment and its earning record?')) return;
      const saved = await write({ ...data, payments: data.payments.filter((payment) => payment.id !== item.id), earnings: data.earnings.filter((earning) => earning.id !== item.earningId), maintenanceRecords: (data.maintenanceRecords || []).filter((entry) => entry.earningId !== item.earningId) }, 'Linked earning and payment deleted.');
      if (saved && item.receiptPath) await repository.deletePaymentReceipt(item.receiptPath).catch(() => setToast('The payment was deleted, but its receipt image could not be removed.'));
      return;
    }
    const label = item.kind === 'expense' ? 'expense' : item.kind === 'earning' ? 'earning' : item.type === 'opening' ? 'Previous payments entry' : 'payment';
    if (!window.confirm(`Delete this ${label}? This cannot be undone.`)) return;
    if (item.kind === 'expense') write({ ...data, expenses: data.expenses.filter((entry) => entry.id !== item.id) }, 'Expense deleted.');
    else if (item.kind === 'earning') {
      const linkedPayment = data.payments.find((payment) => payment.id === item.paymentId);
      const saved = await write({ ...data, earnings: data.earnings.filter((entry) => entry.id !== item.id), payments: data.payments.filter((payment) => payment.id !== item.paymentId), maintenanceRecords: (data.maintenanceRecords || []).filter((entry) => entry.earningId !== item.id) }, 'Earning deleted.');
      if (saved && linkedPayment?.receiptPath) await repository.deletePaymentReceipt(linkedPayment.receiptPath).catch(() => setToast('The earning was deleted, but its payment receipt could not be removed.'));
    }
    else {
      const saved = await write({ ...data, payments: data.payments.filter((entry) => entry.id !== item.id) }, 'Payment deleted.');
      if (saved && item.receiptPath) await repository.deletePaymentReceipt(item.receiptPath).catch(() => setToast('The payment was deleted, but its receipt image could not be removed.'));
    }
  }

  const action = (type, entity = null, details = {}) => {
    if (!entity && (type === 'earning' || type === 'payment')) {
      setModal({ type: 'money', entity: null, initialMode: type, ...details });
      return;
    }
    setModal({ type, entity, ...details });
  };
  const goto = (nextPage) => {
    setPage(nextPage);
    window.history.replaceState(null, '', `#${nextPage}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const recordPaymentFor = (agreementId, initialMode = 'payment') => {
    const target = data.agreements.find((item) => item.id === agreementId);
    const stats = target ? agreementStats(target, data) : null;
    const reminder = target ? paymentScheduleReminder(target, data) : null;
    const installmentSuggestion = reminder?.amountDue > 0 ? reminder.amountDue : Number(target?.paymentAmount || 0);
    const suggestedAmount = stats ? Math.min(stats.plan.funds.ownerSetAside, stats.remaining, installmentSuggestion) : 0;
    setModal({ type: 'money', entity: null, agreementId, initialMode, suggestedAmount: suggestedAmount > 0 ? suggestedAmount : '' });
  };
  const agreement = data.agreements.find((item) => item.id === selectedAgreementId) || data.agreements[0] || null;
  const activePage = pageHeadings[page] ? page : 'overview';
  const totalPaidAll = data.payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const pageContent = activePage === 'overview' ? <OverviewPage data={data} totals={totals} agreements={data.agreements} agreement={agreement} onSelectAgreement={setSelectedAgreementId} onAction={action} onEdit={(item) => action('agreement', item)} onPayment={recordPaymentFor} onBreakdown={() => goto('breakdown')} /> :
    activePage === 'breakdown' ? <IncomeBreakdownPage data={data} agreements={data.agreements} agreement={agreement} onSelectAgreement={setSelectedAgreementId} onAction={action} onEdit={editActivity} onDelete={deleteActivity} /> :
      <PaymentHistoryPage data={data} totals={totals} agreements={data.agreements} onPayment={recordPaymentFor} onEditPayment={editActivity} onDeletePayment={deleteActivity} />;

  return <div className="app-shell">
    <div className="app-main">
      <header className="topbar"><div className="brand"><span className="brand-mark"><span /></span><span>paylog<small>Pay it off. Keep your profit.</small></span></div><nav className="desktop-nav" aria-label="Main navigation">{navItems.map((item) => <NavLink key={item.id} item={item} active={activePage === item.id} onClick={() => goto(item.id)} />)}</nav><div className="topbar-right"><span className="saved-indicator"><i />{loading ? 'Connecting' : storageError ? 'Supabase offline' : 'Saved'}</span></div></header>
      <main className="main-content">{loading ? <div className="panel connection-message">Connecting to Paylog…</div> : storageError ? <div className="panel connection-message"><strong>{storageError.startsWith('Anonymous sign-ins are disabled') ? 'One Supabase setting is off' : 'Can’t reach Supabase'}</strong><p>{storageError}</p><button className="button button-primary" type="button" onClick={() => setReloadKey((value) => value + 1)}>Try again</button></div> : pageContent}<footer className="app-footer"><span>Paylog · Your Work and Pay records.</span><span>{formatMoney(totalPaidAll)} recorded toward tracked vehicles</span>{import.meta.env.DEV && !loading && !storageError && <button className="dev-reset-button" type="button" onClick={resetTestData} disabled={resettingTestData}>{resettingTestData ? 'Clearing…' : 'Reset test data'}</button>}</footer></main>
    </div>
    <nav className="mobile-nav" aria-label="Main navigation">{navItems.map((item) => <NavLink key={item.id} item={item} active={activePage === item.id} compact onClick={() => goto(item.id)} />)}</nav>
    {modal?.type === 'agreement' && <AgreementForm key={`agreement-${modal.entity?.id ?? 'new'}`} agreement={modal.entity} data={data} onClose={() => setModal(null)} onSave={handleAgreementSave} />}
    {modal?.type === 'money' && <RecordMoneyForm key={`money-${modal.agreementId ?? 'new'}`} data={data} initialAgreementId={modal.agreementId} initialMode={modal.initialMode} initialAmount={modal.suggestedAmount} onClose={() => setModal(null)} onCreateAgreement={() => setModal({ type: 'agreement', entity: null })} onSavePayment={handlePaymentSave} onSaveEarning={handleEarningSave} />}
    {modal?.type === 'payment' && <PaymentForm key={`payment-${modal.entity?.id ?? modal.agreementId ?? 'new'}`} payment={modal.entity ? { ...modal.entity } : null} agreements={data.agreements} data={data} initialAgreementId={modal.agreementId} initialAmount={modal.suggestedAmount} onClose={() => setModal(null)} onCreateAgreement={() => setModal({ type: 'agreement', entity: null })} onSave={handlePaymentSave} />}
    {modal?.type === 'held' && <HeldMoneyForm key={`held-${modal.initialType || 'given'}`} data={data} initialType={modal.initialType} onClose={() => setModal(null)} onSave={handleHeldTransferSave} />}
    {modal?.type === 'allocation' && <OwnerAllocationForm key={`allocation-${modal.agreementId || ''}`} data={data} agreements={data.agreements} initialAgreementId={modal.agreementId} onClose={() => setModal(null)} onSave={handleOwnerAllocationSave} />}
    {modal?.type === 'earning' && <EarningForm key={`earning-${modal.entity?.id ?? 'new'}`} earning={modal.entity} data={data} initialAgreementId={modal.agreementId} onClose={() => setModal(null)} onSave={handleEarningSave} />}
    {modal?.type === 'expense' && <ExpenseForm key={`expense-${modal.entity?.id ?? 'new'}`} expense={modal.entity} data={data} initialAgreementId={modal.agreementId} onClose={() => setModal(null)} onSave={handleExpenseSave} />}
    {toast && <div className="toast" role="status"><Icon name="check" size={17} />{toast}</div>}
  </div>;
}
