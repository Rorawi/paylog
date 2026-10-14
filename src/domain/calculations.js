import { localDateString, monthKey } from './money.js';
import { calculateAgreementPlan } from './payoff.js';

export function paymentsFor(data, agreementId) {
  return data.payments.filter((payment) => payment.agreementId === agreementId);
}

export function totalPaidFor(data, agreementId) {
  return paymentsFor(data, agreementId).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
}

const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Reminder information for weekly agreements; recording a payment is never restricted by this schedule. */
export function weeklyPaymentReminder(agreement, data, today = new Date()) {
  if (!agreement || agreement.frequency !== 'weekly' || agreement.paymentDay === '' || agreement.paymentDay == null) return null;
  const paymentDay = Number(agreement.paymentDay);
  if (!Number.isInteger(paymentDay) || paymentDay < 0 || paymentDay > 6) return null;

  const current = typeof today === 'string' ? new Date(`${today}T12:00:00`) : new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  if (Number.isNaN(current.getTime())) return null;
  const daysSincePayDay = (current.getDay() - paymentDay + 7) % 7;
  const dueDate = new Date(current);
  dueDate.setDate(dueDate.getDate() - daysSincePayDay);
  const startDate = agreement.startDate ? new Date(`${agreement.startDate}T12:00:00`) : null;
  if (startDate && !Number.isNaN(startDate.getTime()) && dueDate < startDate) {
    dueDate.setTime(startDate.getTime());
    dueDate.setDate(dueDate.getDate() + ((paymentDay - dueDate.getDay() + 7) % 7));
  }
  const cycleStart = new Date(dueDate);
  cycleStart.setDate(cycleStart.getDate() - 6);
  const dueDateKey = localDateString(dueDate);
  const todayKey = localDateString(current);
  const cycleStartKey = startDate && !Number.isNaN(startDate.getTime()) && cycleStart < startDate ? localDateString(startDate) : localDateString(cycleStart);
  const paidThisCycle = paymentsFor(data, agreement.id)
    .filter((payment) => payment.type !== 'opening' && payment.date >= cycleStartKey && payment.date <= todayKey)
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const totalPaid = totalPaidFor(data, agreement.id);
  const remaining = Math.max(0, Number(agreement.totalPrice || 0) - totalPaid);
  const installment = Math.max(0, Number(agreement.paymentAmount || 0));
  const cycleTarget = Math.min(installment, remaining + paidThisCycle);
  const amountDue = Math.min(remaining, Math.max(0, cycleTarget - paidThisCycle));
  const heldAmount = agreementFunds(data, agreement.id).ownerSetAside;
  const readyAmount = Math.min(heldAmount, amountDue);
  const amountShort = Math.max(0, amountDue - heldAmount);
  const surplusHeld = Math.max(0, heldAmount - amountDue);
  const isDue = current >= dueDate && remaining > 0 && amountDue > 0.005;
  const isOverdue = isDue && dueDateKey < todayKey;
  const nextDate = new Date(dueDate);
  if (!isDue && dueDate <= current) nextDate.setDate(nextDate.getDate() + 7);

  return {
    paymentDay,
    dayName: weekdayNames[paymentDay],
    date: isDue ? dueDateKey : localDateString(nextDate),
    isDue,
    isOverdue,
    amountDue,
    heldAmount,
    readyAmount,
    amountShort,
    surplusHeld,
  };
}

function balanceLedger(transactions) {
  let balance = 0;
  let amountBeyondReserve = 0;
  const ordered = transactions.slice().sort((a, b) => {
    const byDateTime = `${a.date || ''} ${a.time || '23:59:59'}`.localeCompare(`${b.date || ''} ${b.time || '23:59:59'}`);
    if (byDateTime) return byDateTime;
    if (a.direction !== b.direction) return a.direction === 'in' ? -1 : 1;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
  for (const entry of ordered) {
    const amount = Number(entry.amount) || 0;
    if (entry.direction === 'in') balance += amount;
    else {
      amountBeyondReserve += Math.max(0, amount - Math.max(0, balance));
      balance -= amount;
    }
  }
  return { balance, amountBeyondReserve };
}

/** Current reserved funds and any costs that had to come from personal profit. */
export function agreementFunds(data, agreementId) {
  const earnings = (data.earnings || []).filter((earning) => earning.agreementId === agreementId);
  const payments = paymentsFor(data, agreementId);
  const expenses = (data.expenses || []).filter((expense) => expense.agreementId === agreementId);

  // Old earnings had a linked payment entry. They were already counted as paid,
  // so only new, unlinked earnings contribute to the owner's reserve.
  const ownerLedger = balanceLedger([
    ...earnings.filter((earning) => !earning.paymentId).map((earning) => ({ id: earning.id, date: earning.date, time: earning.time, direction: 'in', amount: earning.paymentAmount })),
    ...payments.filter((payment) => payment.type !== 'opening' && payment.type !== 'earning').map((payment) => ({ id: payment.id, date: payment.date, time: payment.time, direction: 'out', amount: payment.amount })),
  ]);
  const fuelLedger = balanceLedger([
    ...earnings.map((earning) => ({ id: earning.id, date: earning.date, time: earning.time, direction: 'in', amount: earning.fuelAmount })),
    ...expenses.filter((expense) => expense.category === 'fuel').map((expense) => ({ id: expense.id, date: expense.date, direction: 'out', amount: expense.amount })),
  ]);
  const maintenanceLedger = balanceLedger([
    ...earnings.map((earning) => ({ id: earning.id, date: earning.date, time: earning.time, direction: 'in', amount: earning.maintenanceAmount })),
    ...expenses.filter((expense) => expense.category === 'maintenance').map((expense) => ({ id: expense.id, date: expense.date, direction: 'out', amount: expense.amount })),
  ]);
  return {
    ownerSetAside: Math.max(0, ownerLedger.balance),
    fuelSetAside: Math.max(0, fuelLedger.balance),
    maintenanceSetAside: Math.max(0, maintenanceLedger.balance),
    amountBeyondReserve: ownerLedger.amountBeyondReserve + fuelLedger.amountBeyondReserve + maintenanceLedger.amountBeyondReserve,
  };
}

function weeklyEarningsFor(data, agreementId, today) {
  const weekStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const startKey = localDateString(weekStart);
  const endKey = localDateString(today);
  const entries = (data.earnings || []).filter((earning) => earning.agreementId === agreementId && earning.date >= startKey && earning.date <= endKey);
  return {
    total: entries.reduce((sum, earning) => sum + Number(earning.totalAmount || 0), 0),
    count: entries.length,
  };
}

export function agreementStats(agreement, data, today = new Date()) {
  const entries = paymentsFor(data, agreement.id);
  const actual = entries.filter((payment) => payment.type !== 'opening' && Number(payment.amount) > 0);
  const total = Number(agreement.totalPrice) || 0;
  const installment = Number(agreement.paymentAmount) || 0;
  const paid = entries.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const remaining = Math.max(0, total - paid);
  const actualIncome = weeklyEarningsFor(data, agreement.id, today);
  const plan = calculateAgreementPlan({
    totalPrice: total,
    alreadyPaid: paid,
    paymentAmount: installment,
    frequency: agreement.frequency,
    startDate: localDateString(today),
    scheduleStartDate: agreement.startDate,
    dailyIncome: agreement.dailyIncome ?? '',
    daysWorkedPerWeek: agreement.daysWorkedPerWeek ?? 7,
    weeklyFuelAmount: agreement.weeklyFuelAmount ?? 0,
    weeklyMaintenanceAmount: agreement.weeklyMaintenanceAmount ?? 0,
    actualWeeklyIncome: actualIncome.total,
    actualEarningCount: actualIncome.count,
  });
  const payoff = plan.payoff;
  plan.funds = agreementFunds(data, agreement.id);
  const paymentsLeft = payoff.paymentCount;
  const progress = total > 0 ? Math.min(100, Math.max(0, (paid / total) * 100)) : 0;
  const start = new Date(`${agreement.startDate}T12:00:00`);
  const now = new Date(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}T12:00:00`);
  const intervalDays = agreement.frequency === 'daily' ? 1 : agreement.frequency === 'monthly' ? 30.4375 : 7;
  const elapsedDays = Math.max(0, (now.getTime() - start.getTime()) / 86400000);
  const dueCount = Math.floor(elapsedDays / intervalDays);
  const dueAmount = Math.min(total, dueCount * installment);
  const difference = paid - dueAmount;
  const lagPeriods = installment > 0 ? Math.ceil(Math.abs(difference) / installment) : 0;

  const estimated = payoff.expectedFinish ? new Date(`${payoff.expectedFinish}T12:00:00`) : now;

  let status = 'on-track';
  let statusLabel = 'On track';
  if (difference > installment * 0.25) {
    status = 'ahead';
    const unit = agreement.frequency === 'daily' ? 'day' : agreement.frequency === 'weekly' ? 'week' : 'month';
    statusLabel = `${lagPeriods} ${unit}${lagPeriods === 1 ? '' : 's'} ahead`;
  } else if (difference < -installment * 0.25) {
    status = 'behind';
    const unit = agreement.frequency === 'daily' ? 'day' : agreement.frequency === 'weekly' ? 'week' : 'month';
    statusLabel = `${lagPeriods} ${unit}${lagPeriods === 1 ? '' : 's'} behind`;
  }
  return {
    paid,
    remaining,
    paymentsLeft,
    progress,
    expectedFinish: estimated,
    payoff,
    plan,
    status,
    statusLabel,
    dueCount,
    dueAmount,
    difference,
    actualPaymentCount: actual.length,
  };
}

export function dashboardTotals(data, now = new Date()) {
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const todayKey = localDateString(now);
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const weekStartKey = localDateString(weekStart);
  const paid = data.payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const owed = data.agreements.reduce((sum, agreement) => sum + Math.max(0, Number(agreement.totalPrice || 0) - totalPaidFor(data, agreement.id)), 0);
  const kept = data.earnings.reduce((sum, earning) => sum + Number(earning.keptAmount || 0), 0);
  const businessExpenseIds = new Set(['fuel', 'maintenance']);
  const personalExpenses = data.expenses.filter((expense) => !businessExpenseIds.has(expense.category) || !data.agreements.some((agreement) => agreement.id === expense.agreementId)).reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const reserveOverruns = data.agreements.reduce((sum, agreement) => sum + agreementFunds(data, agreement.id).amountBeyondReserve, 0);
  const spentThisMonth = data.expenses.filter((expense) => monthKey(expense.date) === month).reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const paymentsThisWeek = data.payments.filter((payment) => payment.type !== 'opening' && payment.date >= weekStartKey && payment.date <= todayKey).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const paymentsThisMonth = data.payments.filter((payment) => payment.type !== 'opening' && monthKey(payment.date) === month && payment.date <= todayKey).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  return { paid, owed, kept: kept - personalExpenses - reserveOverruns, keptEarned: kept, personalExpenses, reserveOverruns, spentFromProfit: personalExpenses + reserveOverruns, spentThisMonth, paymentsThisWeek, paymentsThisMonth };
}

export function spendingByCategory(expenses, now = new Date()) {
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return expenses.filter((expense) => monthKey(expense.date) === month).reduce((categories, expense) => {
    categories[expense.category] = (categories[expense.category] || 0) + Number(expense.amount || 0);
    return categories;
  }, {});
}

export function recentActivity(data) {
  return [
    ...data.payments.map((payment) => ({ ...payment, kind: 'payment', date: payment.date })),
    ...data.earnings.map((earning) => ({ ...earning, kind: 'earning', date: earning.date })),
    ...data.expenses.map((expense) => ({ ...expense, kind: 'expense', date: expense.date })),
  ].sort((a, b) => `${b.date}-${b.id}`.localeCompare(`${a.date}-${a.id}`)).slice(0, 8);
}
