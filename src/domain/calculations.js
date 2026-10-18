import { formatMoney, localDateString, monthKey } from './money.js';
import { calculateAgreementPlan } from './payoff.js';

export function paymentsFor(data, agreementId) {
  return data.payments.filter((payment) => payment.agreementId === agreementId);
}

export function totalPaidFor(data, agreementId) {
  return paymentsFor(data, agreementId).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
}

/** Convert a vehicle cost to the weekly amount used by the work-income plan. */
export function weeklyCostAmount(cost) {
  const amount = Math.max(0, Number(cost?.amount) || 0);
  return cost?.period === 'monthly' ? amount * 12 / 52 : amount;
}

/**
 * Summarize money physically held by someone else and the portion reserved for
 * an agreement payment. Held money stays outside the user's cash balance.
 */
export function heldMoneySummary(data, { excludePaymentId = '', agreementId = '' } = {}) {
  const holders = new Map();
  const getHolder = (holderId, holderName = '') => {
    const id = String(holderId || '');
    if (!id) return null;
    if (!holders.has(id)) holders.set(id, { holderId: id, holderName: String(holderName || 'Someone'), balance: 0, reserved: 0, firstSeen: holders.size });
    const holder = holders.get(id);
    if (holderName && (!holder.holderName || holder.holderName === 'Someone')) holder.holderName = String(holderName);
    return holder;
  };

  for (const transfer of data.heldTransfers || []) {
    const holder = getHolder(transfer.holderId, transfer.holderName);
    if (!holder) continue;
    const amount = Math.max(0, Number(transfer.amount) || 0);
    if (transfer.type === 'given') holder.balance += amount;
    if (transfer.type === 'returned') holder.balance -= amount;
  }

  const payments = (data.payments || []).filter((payment) => payment.id !== excludePaymentId);
  for (const payment of payments) {
    if (payment.fundingSource === 'held' && payment.holderId) {
      const holder = getHolder(payment.holderId, payment.holderName);
      if (holder) holder.balance -= Math.max(0, Number(payment.amount) || 0);
    }
    if (!agreementId || payment.agreementId === agreementId) {
      for (const use of payment.reserveConsumption || []) {
        const holder = getHolder(use.holderId, use.holderName);
        if (holder) holder.reserved -= Math.max(0, Number(use.amount) || 0);
      }
    }
  }

  for (const allocation of data.ownerAllocations || []) {
    if (agreementId && allocation.agreementId !== agreementId) continue;
    const holder = getHolder(allocation.holderId, allocation.holderName);
    if (!holder) continue;
    const amount = Math.max(0, Number(allocation.amount) || 0);
    if (allocation.type === 'set_aside') holder.reserved += amount;
    if (allocation.type === 'release') holder.reserved -= amount;
  }

  const rows = [...holders.values()].map((holder) => {
    const balance = Math.max(0, holder.balance);
    const reserved = Math.min(balance, Math.max(0, holder.reserved));
    return { ...holder, balance, reserved, unallocated: Math.max(0, balance - reserved) };
  });
  return rows.reduce((summary, holder) => ({
    holders: [...summary.holders, holder],
    totalHeld: summary.totalHeld + holder.balance,
    totalReserved: summary.totalReserved + holder.reserved,
    totalUnallocated: summary.totalUnallocated + holder.unallocated,
  }), { holders: [], totalHeld: 0, totalReserved: 0, totalUnallocated: 0 });
}

/** Reserve usage for a newly recorded payment, preferring its paying holder. */
export function reserveConsumptionForPayment(data, amount, { preferredHolderId = '', excludePaymentId = '', agreementId = '' } = {}) {
  let remaining = Math.max(0, Number(amount) || 0);
  if (!remaining) return [];
  const snapshot = heldMoneySummary(data, { excludePaymentId, agreementId });
  const holders = snapshot.holders
    .filter((holder) => holder.reserved > 0)
    .sort((a, b) => Number(b.holderId === preferredHolderId) - Number(a.holderId === preferredHolderId) || a.firstSeen - b.firstSeen);
  const consumption = [];
  for (const holder of holders) {
    if (remaining <= 0.005) break;
    const used = Math.min(holder.reserved, remaining);
    if (used > 0) consumption.push({ holderId: holder.holderId, holderName: holder.holderName, amount: used });
    remaining -= used;
  }
  return consumption;
}

export function paymentLedgerFields(data, { agreementId, amount, fundingSource = 'cash', holderId = '', excludePaymentId = '' }) {
  const source = fundingSource === 'held' ? 'held' : 'cash';
  const snapshot = heldMoneySummary(data, { excludePaymentId });
  const holder = source === 'held' ? snapshot.holders.find((entry) => entry.holderId === holderId) : null;
  const paymentAmount = Math.max(0, Number(amount) || 0);
  if (source === 'held' && (!holder || paymentAmount > holder.balance + 0.005)) {
    throw new Error(`Choose someone with enough money held, or lower the payment to ${formatMoney(holder?.balance ?? 0)}.`);
  }
  return {
    fundingSource: source,
    holderId: holder?.holderId ?? '',
    holderName: holder?.holderName ?? '',
    reserveConsumption: reserveConsumptionForPayment(data, paymentAmount, {
      preferredHolderId: holder?.holderId ?? '', excludePaymentId, agreementId,
    }),
  };
}

export function recordHeldTransfer(data, values) {
  const amount = Number(values.amount) || 0;
  const summary = heldMoneySummary(data);
  const normalizeName = (name) => String(name || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  const matchedHolder = summary.holders.find((holder) => normalizeName(holder.holderName) === normalizeName(values.holderName));
  const holder = values.type === 'returned' ? summary.holders.find((entry) => entry.holderId === values.holderId) : matchedHolder;
  const holderName = String(values.holderName || holder?.holderName || '').trim().replace(/\s+/g, ' ');
  if (!amount || amount <= 0 || !holderName || !['given', 'returned'].includes(values.type)) throw new Error('Enter who is holding the money and an amount above zero.');
  if (values.type === 'returned' && (!holder || amount > holder.unallocated + 0.005)) {
    throw new Error(`Only ${formatMoney(holder?.unallocated ?? 0)} is unallocated and available to return. Release an owner set-aside first.`);
  }
  const transfer = {
    id: values.id,
    holderId: holder?.holderId || values.holderId || values.id,
    holderName: holder?.holderName ?? holderName,
    type: values.type,
    amount,
    date: values.date,
    note: values.note || '',
    createdAt: values.createdAt,
  };
  if (!transfer.id || !transfer.holderId || !transfer.date) throw new Error('Add a date and person before saving this held-money record.');
  return { ...data, heldTransfers: [...(data.heldTransfers || []), transfer] };
}

export function recordOwnerAllocation(data, values) {
  const amount = Number(values.amount) || 0;
  if (!values.agreementId || !['set_aside', 'release'].includes(values.type)) throw new Error('Choose a purchase and allocation action.');
  const snapshot = heldMoneySummary(data, { agreementId: values.agreementId });
  const holder = snapshot.holders.find((entry) => entry.holderId === values.holderId);
  const limit = values.type === 'set_aside'
    ? heldMoneySummary(data).holders.find((entry) => entry.holderId === values.holderId)?.unallocated ?? 0
    : holder?.reserved ?? 0;
  if (!holder || amount <= 0 || amount > limit + 0.005) {
    throw new Error(values.type === 'set_aside' ? 'That amount is more than the unallocated money being held.' : 'That amount is more than the money set aside for this purchase.');
  }
  const allocation = {
    id: values.id,
    agreementId: values.agreementId,
    holderId: values.holderId,
    holderName: holder.holderName,
    type: values.type,
    amount,
    date: values.date,
    createdAt: values.createdAt,
  };
  if (!allocation.id || !allocation.date) throw new Error('Add a date before saving this owner set-aside.');
  return { ...data, ownerAllocations: [...(data.ownerAllocations || []), allocation] };
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
  if (!isDue && amountDue <= 0.005 && remaining > 0) {
    if (dueDate > current) nextDate.setDate(nextDate.getDate() + 7);
  }

  return {
    paymentDay,
    dayName: weekdayNames[paymentDay],
    date: isDue ? dueDateKey : localDateString(nextDate),
    isDue,
    isOverdue,
    amountDue: !isDue && amountDue <= 0.005 && remaining > 0 ? Math.min(installment, remaining) : amountDue,
    heldAmount,
    readyAmount,
    amountShort,
    surplusHeld,
  };
}

/** Payment reminder using the agreement's daily, weekly, or monthly schedule. */
export function paymentScheduleReminder(agreement, data, today = new Date()) {
  if (!agreement) return null;
  if (agreement.frequency === 'weekly') return weeklyPaymentReminder(agreement, data, today);
  if (!['daily', 'monthly'].includes(agreement.frequency)) return null;

  const current = typeof today === 'string' ? new Date(`${today}T12:00:00`) : new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  if (Number.isNaN(current.getTime())) return null;
  const todayKey = localDateString(current);
  const start = agreement.startDate ? new Date(`${agreement.startDate}T12:00:00`) : new Date(current);
  const startKey = localDateString(start);
  const remaining = Math.max(0, Number(agreement.totalPrice || 0) - totalPaidFor(data, agreement.id));
  const installment = Math.max(0, Number(agreement.paymentAmount || 0));
  const actualPayments = paymentsFor(data, agreement.id).filter((payment) => payment.type !== 'opening' && Number(payment.amount) > 0);
  const workReserve = agreementFunds(data, agreement.id).ownerSetAside;
  const daily = agreement.frequency === 'daily';

  if (current < start) {
    const amountDue = Math.min(remaining, installment);
    return { date: startKey, isDue: false, isOverdue: false, amountDue, heldAmount: workReserve, readyAmount: Math.min(workReserve, amountDue), amountShort: Math.max(0, amountDue - workReserve), surplusHeld: Math.max(0, workReserve - amountDue) };
  }

  let dueDate = new Date(current);
  let cycleStart = new Date(current);
  let nextDate = new Date(current);
  let paidThisCycle = 0;
  if (daily) {
    paidThisCycle = actualPayments.filter((payment) => payment.date === todayKey).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    if (paidThisCycle >= installment - 0.005 && remaining > 0) {
      nextDate.setDate(nextDate.getDate() + 1);
      dueDate = nextDate;
      paidThisCycle = 0;
    } else {
      cycleStart = new Date(current);
    }
  } else {
    const startDay = start.getDate();
    const monthDate = (year, month) => new Date(year, month, Math.min(startDay, new Date(year, month + 1, 0).getDate()), 12);
    const thisMonthDue = monthDate(current.getFullYear(), current.getMonth());
    if (current < thisMonthDue) {
      dueDate = thisMonthDue;
      nextDate = thisMonthDue;
      const previousMonthDue = monthDate(current.getFullYear(), current.getMonth() - 1);
      cycleStart = previousMonthDue < start ? new Date(start) : new Date(previousMonthDue);
      cycleStart.setDate(cycleStart.getDate() + 1);
    } else {
      dueDate = thisMonthDue;
      const previousMonthDue = monthDate(current.getFullYear(), current.getMonth() - 1);
      cycleStart = previousMonthDue < start ? new Date(start) : new Date(previousMonthDue);
      cycleStart.setDate(cycleStart.getDate() + 1);
    }
    const cycleStartKey = localDateString(cycleStart < start ? start : cycleStart);
    paidThisCycle = actualPayments.filter((payment) => payment.date >= cycleStartKey && payment.date <= todayKey).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    if (paidThisCycle >= installment - 0.005 && remaining > 0) {
      nextDate = monthDate(current.getFullYear(), current.getMonth() + 1);
      dueDate = nextDate;
      paidThisCycle = 0;
    }
  }

  const amountDue = Math.min(remaining, Math.max(0, Math.min(installment, remaining + paidThisCycle) - paidThisCycle));
  const dateKey = localDateString(dueDate);
  const isDue = current >= dueDate && remaining > 0 && amountDue > 0.005;
  const isOverdue = isDue && dateKey < todayKey;
  return {
    date: dateKey,
    isDue,
    isOverdue,
    amountDue,
    heldAmount: workReserve,
    readyAmount: Math.min(workReserve, amountDue),
    amountShort: Math.max(0, amountDue - workReserve),
    surplusHeld: Math.max(0, workReserve - amountDue),
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
      const available = Math.max(0, balance);
      amountBeyondReserve += Math.max(0, amount - available);
      // A shortfall is paid from personal cash. Keep it separate so future
      // earnings can be reserved for the next payment instead of repaying an
      // earlier shortfall in this ledger.
      balance = Math.max(0, available - amount);
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
    ...payments.filter((payment) => payment.type !== 'opening' && payment.type !== 'earning' && payment.fundingSource !== 'held').map((payment) => ({ id: payment.id, date: payment.date, time: payment.time, direction: 'out', amount: payment.amount })),
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
  const heldTransfersOut = Math.max(0, (data.heldTransfers || []).reduce((sum, transfer) => sum + (transfer.type === 'given' ? Number(transfer.amount || 0) : transfer.type === 'returned' ? -Number(transfer.amount || 0) : 0), 0));
  const afterRecordedSpending = kept - personalExpenses - reserveOverruns;
  const heldFromProfit = Math.min(Math.max(0, afterRecordedSpending), heldTransfersOut);
  const spentThisMonth = data.expenses.filter((expense) => monthKey(expense.date) === month).reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const paymentsThisWeek = data.payments.filter((payment) => payment.type !== 'opening' && payment.date >= weekStartKey && payment.date <= todayKey).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const paymentsThisMonth = data.payments.filter((payment) => payment.type !== 'opening' && monthKey(payment.date) === month && payment.date <= todayKey).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  return { paid, owed, kept: afterRecordedSpending - heldFromProfit, keptEarned: kept, personalExpenses, reserveOverruns, heldFromProfit, heldTransfersOut, spentFromProfit: personalExpenses + reserveOverruns, spentThisMonth, paymentsThisWeek, paymentsThisMonth };
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
