import { localDateString } from './money.js';

const intervalDays = { daily: 1, weekly: 7, monthly: 30.4375 };

function dateFromInput(value) {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addPeriods(dateValue, count, frequency) {
  const date = dateFromInput(dateValue);
  if (!date) return '';
  if (frequency === 'monthly') {
    const day = date.getDate();
    date.setDate(1);
    date.setMonth(date.getMonth() + count);
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    date.setDate(Math.min(day, lastDay));
  } else {
    date.setDate(date.getDate() + count * (frequency === 'daily' ? 1 : 7));
  }
  return localDateString(date);
}

function completedPeriods(startDate, today, frequency) {
  const start = dateFromInput(startDate);
  const end = dateFromInput(today);
  if (!start || !end || end < start) return 0;
  if (frequency === 'daily') return Math.floor((end.getTime() - start.getTime()) / 86400000);
  if (frequency === 'weekly') return Math.floor((end.getTime() - start.getTime()) / (7 * 86400000));
  let months = (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth();
  const anniversary = dateFromInput(addPeriods(startDate, months, 'monthly'));
  if (anniversary && anniversary > end) months -= 1;
  return Math.max(0, months);
}

function timeline(paymentCount, frequency) {
  const days = paymentCount * intervalDays[frequency];
  if (days >= 365) {
    let years = Math.floor(days / 365.25);
    let months = Math.round((days - years * 365.25) / 30.4375);
    if (months >= 12) { years += 1; months = 0; }
    const parts = [];
    if (years) parts.push(`${years} year${years === 1 ? '' : 's'}`);
    if (months) parts.push(`${months} month${months === 1 ? '' : 's'}`);
    return `About ${parts.join(', ')}`;
  }
  const dayCount = Math.round(days);
  if (frequency === 'daily') return `About ${dayCount} days`;
  const unit = frequency === 'weekly' ? 'week' : 'month';
  const unitCount = Math.round(days / (frequency === 'weekly' ? 7 : 30.4375));
  return `About ${unitCount} ${unit}${unitCount === 1 ? '' : 's'} · about ${dayCount} days`;
}

/** Shared payoff and expected-finish calculation for agreement forms and saved agreements. */
export function calculatePayoff({ totalPrice, alreadyPaid = 0, paymentAmount, frequency = 'weekly', startDate = '', scheduleStartDate = startDate, today = new Date() }) {
  const totalText = String(totalPrice ?? '').trim();
  const paymentText = String(paymentAmount ?? '').trim();
  const total = Number(totalPrice) || 0;
  const paid = Number(alreadyPaid) || 0;
  const amount = Number(paymentAmount) || 0;
  const remaining = Math.max(0, total - paid);
  const result = { status: 'incomplete', total, paid, remaining, paymentAmount: amount, frequency, paymentCount: 0, finalPayment: 0, expectedFinish: '', durationText: '', nextPaymentDate: '', nextPaymentAmount: 0 };

  if (!totalText || total <= 0) return result;
  if (paid > total) return { ...result, remaining: 0, status: 'overpaid' };
  if (paid >= total) return { ...result, remaining: 0, status: 'paid' };
  if (!paymentText) return result;
  if (amount <= 0) return { ...result, status: 'invalid-payment' };
  if (!dateFromInput(startDate)) return { ...result, status: startDate ? 'invalid-start-date' : 'incomplete' };
  if (!intervalDays[frequency]) return { ...result, status: 'invalid-frequency' };

  const paymentCount = Math.ceil((remaining - 1e-9) / amount);
  const finalPayment = Math.round((remaining - amount * (paymentCount - 1)) * 100) / 100;
  const todayKey = typeof today === 'string' ? today : localDateString(today);
  const periodsElapsed = completedPeriods(scheduleStartDate, todayKey, frequency);
  const periodsPaid = Math.floor((paid + 0.005) / amount);
  // An unpaid installment keeps its original due date; otherwise show the next
  // upcoming date in the agreement's schedule.
  const nextPeriod = periodsPaid < periodsElapsed ? periodsPaid + 1 : periodsElapsed + 1;
  return {
    ...result,
    status: 'ready',
    paymentCount,
    finalPayment,
    finalPaymentSmaller: finalPayment < amount,
    expectedFinish: addPeriods(startDate, paymentCount, frequency),
    durationText: timeline(paymentCount, frequency),
    nextPaymentDate: addPeriods(scheduleStartDate, nextPeriod, frequency),
    nextPaymentAmount: Math.min(amount, remaining),
  };
}

/** Keeps the installment payoff and work-income split in one agreement calculation. */
export function calculateAgreementPlan({
  totalPrice,
  alreadyPaid = 0,
  paymentAmount,
  frequency = 'weekly',
  startDate = '',
  scheduleStartDate = startDate,
  dailyIncome = '',
  daysWorkedPerWeek = 7,
  weeklyFuelAmount = 0,
  weeklyMaintenanceAmount = 0,
  actualWeeklyIncome = 0,
  actualEarningCount = 0,
}) {
  const payoff = calculatePayoff({ totalPrice, alreadyPaid, paymentAmount, frequency, startDate, scheduleStartDate });
  const dailyIncomeValue = Number(dailyIncome) || 0;
  const daysWorked = Math.max(0, Math.min(7, Number(daysWorkedPerWeek) || 0));
  const ownerPayment = Math.max(0, Number(paymentAmount) || 0);
  const fuel = Math.max(0, Number(weeklyFuelAmount) || 0);
  const maintenance = Math.max(0, Number(weeklyMaintenanceAmount) || 0);
  const weeklyIncome = dailyIncome === '' || dailyIncome == null ? 0 : dailyIncomeValue * daysWorked;
  const plannedCosts = ownerPayment + fuel + maintenance;
  const keptWeekly = Math.max(0, weeklyIncome - plannedCosts);
  const shortfall = dailyIncome === '' || dailyIncome == null ? 0 : Math.max(0, plannedCosts - weeklyIncome);
  const actual = Math.max(0, Number(actualWeeklyIncome) || 0);
  const actualCount = Math.max(0, Number(actualEarningCount) || 0);
  const actualDifference = actual - weeklyIncome;
  const actualStatus = actualCount === 0 ? 'not-recorded' : actualDifference > 0.005 ? 'ahead' : actualDifference < -0.005 ? 'behind' : 'on-plan';

  return {
    payoff,
    income: {
      ready: String(dailyIncome ?? '').trim() !== '',
      dailyIncome: dailyIncomeValue,
      daysWorkedPerWeek: daysWorked,
      weeklyIncome,
      ownerPayment,
      fuel,
      maintenance,
      keptWeekly,
      ownerPerDay: daysWorked ? ownerPayment / daysWorked : 0,
      fuelPerDay: daysWorked ? fuel / daysWorked : 0,
      maintenancePerDay: daysWorked ? maintenance / daysWorked : 0,
      keptPerDay: daysWorked ? keptWeekly / daysWorked : 0,
      shortfall,
      actualWeeklyIncome: actual,
      actualEarningCount: actualCount,
      actualDifference: Math.abs(actualDifference),
      actualStatus,
    },
  };
}

/** Reserves each day's income in priority order: owner, fuel, maintenance, then profit. */
export function splitActualEarning(amount, incomePlan) {
  const total = Math.max(0, Number(amount) || 0);
  const owner = Math.round(Math.min(total, Math.max(0, Number(incomePlan?.ownerPerDay) || 0)) * 100) / 100;
  const afterOwner = Math.max(0, total - owner);
  const fuel = Math.round(Math.min(afterOwner, Math.max(0, Number(incomePlan?.fuelPerDay) || 0)) * 100) / 100;
  const afterFuel = Math.max(0, afterOwner - fuel);
  const maintenance = Math.round(Math.min(afterFuel, Math.max(0, Number(incomePlan?.maintenancePerDay) || 0)) * 100) / 100;
  const kept = Math.round(Math.max(0, total - owner - fuel - maintenance) * 100) / 100;
  return { paymentAmount: owner, fuelAmount: fuel, maintenanceAmount: maintenance, keptAmount: kept };
}
