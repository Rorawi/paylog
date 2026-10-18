import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardTotals, heldMoneySummary, paymentLedgerFields, paymentScheduleReminder, recordHeldTransfer, recordOwnerAllocation } from './calculations.js';

function sampleData() {
  return {
    version: 1,
    agreements: [{ id: 'agreement-1', item: 'Laptop', payee: 'Ama', totalPrice: 1000, paymentAmount: 100, frequency: 'weekly', paymentDay: 0, startDate: '2026-10-01' }],
    payments: [], earnings: [], maintenanceRecords: [], expenses: [], heldTransfers: [], ownerAllocations: [],
  };
}

function giveAndReserve() {
  const transferred = recordHeldTransfer(sampleData(), { id: 'transfer-1', holderId: 'holder-1', holderName: 'Ama', type: 'given', amount: 400, date: '2026-10-16' });
  return recordOwnerAllocation(transferred, { id: 'allocation-1', agreementId: 'agreement-1', holderId: 'holder-1', type: 'set_aside', amount: 300, date: '2026-10-16' });
}

test('held money and owner set-aside remain separate from cash and payments', () => {
  const data = giveAndReserve();
  const summary = heldMoneySummary(data);
  assert.equal(summary.totalHeld, 400);
  assert.equal(summary.totalReserved, 300);
  assert.equal(summary.totalUnallocated, 100);
  assert.equal(dashboardTotals(data).paid, 0);
  assert.equal(dashboardTotals(data).owed, 1000);
});

test('a familiar holder name reuses the same held-money balance', () => {
  let data = recordHeldTransfer(sampleData(), { id: 'transfer-1', holderName: 'Ama', type: 'given', amount: 250, date: '2026-10-16' });
  data = recordHeldTransfer(data, { id: 'transfer-2', holderName: ' ama ', type: 'given', amount: 150, date: '2026-10-17' });
  const summary = heldMoneySummary(data);
  assert.equal(summary.holders.length, 1);
  assert.equal(summary.totalHeld, 400);
  assert.equal(summary.holders[0].holderName, 'Ama');
});

test('giving money to a holder reduces available cash without becoming an expense or new income', () => {
  let data = sampleData();
  data.earnings.push({ id: 'earning-1', agreementId: 'agreement-1', date: '2026-10-16', totalAmount: 500, keptAmount: 500 });
  data = recordHeldTransfer(data, { id: 'transfer-1', holderName: 'Ama', type: 'given', amount: 400, date: '2026-10-16' });
  let totals = dashboardTotals(data);
  assert.equal(totals.keptEarned, 500);
  assert.equal(totals.kept, 100);
  assert.equal(totals.heldFromProfit, 400);
  assert.equal(totals.personalExpenses, 0);

  data = recordHeldTransfer(data, { id: 'transfer-2', holderId: data.heldTransfers[0].holderId, holderName: 'Ama', type: 'returned', amount: 100, date: '2026-10-17' });
  totals = dashboardTotals(data);
  assert.equal(totals.keptEarned, 500);
  assert.equal(totals.kept, 200);
  assert.equal(totals.personalExpenses, 0);
  assert.equal(totals.spentThisMonth, 0);
});

test('a full scheduled payment by a holder changes the balance and held funds once', () => {
  const data = giveAndReserve();
  const ledgerFields = paymentLedgerFields(data, { agreementId: 'agreement-1', amount: 100, fundingSource: 'held', holderId: 'holder-1' });
  data.payments.push({ id: 'payment-full', agreementId: 'agreement-1', amount: 100, date: '2026-10-18', type: 'manual', ...ledgerFields });
  const summary = heldMoneySummary(data);
  const totals = dashboardTotals(data);
  assert.equal(summary.totalHeld, 300);
  assert.equal(summary.totalReserved, 200);
  assert.equal(totals.paid, 100);
  assert.equal(totals.owed, 900);
});

test('a partial payment made directly by the holder updates the payment and held balances once', () => {
  const data = giveAndReserve();
  data.earnings.push({ id: 'earning-1', agreementId: 'agreement-1', date: '2026-10-16', totalAmount: 500, keptAmount: 500 });
  const ledgerFields = paymentLedgerFields(data, { agreementId: 'agreement-1', amount: 200, fundingSource: 'held', holderId: 'holder-1' });
  data.payments.push({ id: 'payment-1', agreementId: 'agreement-1', amount: 200, date: '2026-10-18', type: 'manual', ...ledgerFields });

  const summary = heldMoneySummary(data);
  const totals = dashboardTotals(data);
  assert.equal(summary.totalHeld, 200);
  assert.equal(summary.totalReserved, 100);
  assert.equal(summary.totalUnallocated, 100);
  assert.equal(totals.paid, 200);
  assert.equal(totals.owed, 800);
  assert.equal(totals.kept, 100);
  assert.equal(totals.keptEarned, 500);
});

test('a payment from the customer releases the reservation but does not remove physically held money', () => {
  const data = giveAndReserve();
  const ledgerFields = paymentLedgerFields(data, { agreementId: 'agreement-1', amount: 100, fundingSource: 'cash' });
  data.payments.push({ id: 'payment-2', agreementId: 'agreement-1', amount: 100, date: '2026-10-18', type: 'manual', ...ledgerFields });

  const summary = heldMoneySummary(data);
  assert.equal(summary.totalHeld, 400);
  assert.equal(summary.totalReserved, 200);
  assert.equal(summary.totalUnallocated, 200);
  assert.equal(dashboardTotals(data).paid, 100);
});

test('returning money is a transfer, not income or an expense', () => {
  let data = giveAndReserve();
  data = recordHeldTransfer(data, { id: 'transfer-2', holderId: 'holder-1', holderName: 'Ama', type: 'returned', amount: 100, date: '2026-10-17' });

  const summary = heldMoneySummary(data);
  const totals = dashboardTotals(data);
  assert.equal(summary.totalHeld, 300);
  assert.equal(summary.totalReserved, 300);
  assert.equal(summary.totalUnallocated, 0);
  assert.equal(totals.kept, 0);
  assert.equal(totals.spentThisMonth, 0);
});

test('held balances reject returns of reserved funds and reject over-allocation', () => {
  const data = giveAndReserve();
  assert.throws(() => recordOwnerAllocation(data, { id: 'allocation-2', agreementId: 'agreement-1', holderId: 'holder-1', type: 'set_aside', amount: 101, date: '2026-10-17' }), /more than the unallocated/);
  assert.throws(() => recordHeldTransfer(data, { id: 'transfer-2', holderId: 'holder-1', holderName: 'Ama', type: 'returned', amount: 101, date: '2026-10-17' }), /unallocated and available to return/);
  assert.throws(() => paymentLedgerFields(data, { agreementId: 'agreement-1', amount: 401, fundingSource: 'held', holderId: 'holder-1' }), /enough money held/);
});

test('payment reminders use the agreement schedule and do not treat reserved held money as cash in hand', () => {
  const data = giveAndReserve();
  const reminder = paymentScheduleReminder(data.agreements[0], data, '2026-10-18');
  assert.equal(reminder.date, '2026-10-18');
  assert.equal(reminder.isDue, true);
  assert.equal(reminder.amountDue, 100);
  assert.equal(reminder.readyAmount, 0);
  assert.equal(heldMoneySummary(data, { agreementId: 'agreement-1' }).totalReserved, 300);
});

test('a payment made before the scheduled day moves the next due date forward', () => {
  const data = sampleData();
  data.payments.push({ id: 'payment-early', agreementId: 'agreement-1', amount: 100, date: '2026-10-17', type: 'manual' });
  const reminder = paymentScheduleReminder(data.agreements[0], data, '2026-10-18');
  assert.equal(reminder.date, '2026-10-25');
  assert.equal(reminder.amountDue, 100);
  assert.equal(reminder.isDue, false);
});

test('monthly and daily agreements get calendar-based next payment reminders', () => {
  const data = sampleData();
  data.agreements[0] = { ...data.agreements[0], frequency: 'monthly' };
  data.payments.push({ id: 'payment-month', agreementId: 'agreement-1', amount: 100, date: '2026-10-18', type: 'manual' });
  const monthly = paymentScheduleReminder(data.agreements[0], data, '2026-10-18');
  assert.equal(monthly.date, '2026-11-01');
  assert.equal(monthly.amountDue, 100);

  data.agreements[0] = { ...data.agreements[0], frequency: 'daily' };
  data.payments[0].date = '2026-10-17';
  const daily = paymentScheduleReminder(data.agreements[0], data, '2026-10-18');
  assert.equal(daily.date, '2026-10-18');
  assert.equal(daily.isDue, true);
});
