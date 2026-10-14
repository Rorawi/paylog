import { formatDate, formatMoney } from '../domain/money.js';

export default function PayoffSummary({ estimate, compact = false, showBalances = true }) {
  if (!estimate || estimate.status === 'incomplete') return null;
  const className = `payoff-summary ${compact ? 'payoff-summary-compact' : ''}`;
  const balances = showBalances ? <div className="payoff-summary-balances"><span>Total <b>{formatMoney(estimate.total)}</b></span><i>·</i><span>Paid <b>{formatMoney(estimate.paid)}</b></span><i>·</i><span>Remaining <b>{formatMoney(estimate.remaining)}</b></span></div> : null;

  if (estimate.status === 'overpaid') return <section className={`${className} payoff-summary-warning`}><strong>Paid amount is above the total price.</strong>{balances}<span>You have paid {formatMoney(estimate.paid)} against a total of {formatMoney(estimate.total)}.</span></section>;
  if (estimate.status === 'paid') return <section className={`${className} payoff-summary-paid`}><strong>This item is fully paid.</strong>{balances}</section>;
  if (estimate.status === 'invalid-payment') return <section className={`${className} payoff-summary-warning`}>{balances}<span>Enter a payment amount above zero to estimate the finish date.</span></section>;
  if (estimate.status !== 'ready') return null;

  const finalNote = estimate.finalPaymentSmaller
    ? estimate.paymentCount > 1
      ? `${estimate.paymentCount - 1} payments of ${formatMoney(estimate.paymentAmount)}; final payment ${formatMoney(estimate.finalPayment)}.`
      : `One final payment of ${formatMoney(estimate.finalPayment)}.`
    : '';
  return <section className={className} aria-live="polite">
    {balances}
    <strong className="payoff-summary-duration">{estimate.durationText}</strong>
    <span className="payoff-summary-finish">Finish around {formatDate(estimate.expectedFinish)}{finalNote ? ` · ${finalNote}` : ''}</span>
  </section>;
}
