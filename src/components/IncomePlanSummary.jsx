import PayoffSummary from './PayoffSummary.jsx';
import { formatMoney } from '../domain/money.js';

function Amount({ label, value, emphasized = false }) {
  return <div className={`income-plan-amount ${emphasized ? 'income-plan-emphasis' : ''}`}>
    <span>{label}</span><strong>{formatMoney(value)}</strong>
  </div>;
}

export default function IncomePlanSummary({ plan }) {
  if (!plan) return null;
  const income = plan.income;
  return <section className="income-plan-summary" aria-live="polite">
    <div className="income-plan-heading"><strong>Income plan</strong><span>Weekly plan · daily view</span></div>
    {income.ready ? <>
      <div className="income-plan-grid">
        <Amount label="Weekly income" value={income.weeklyIncome}/>
        <Amount label="Owner payment" value={income.ownerPayment}/>
        <Amount label="Fuel" value={income.fuel}/>
        <Amount label="Other costs" value={income.maintenance}/>
        <Amount label="Estimated to keep / week" value={income.keptWeekly} emphasized/>
      </div>
      <div className="income-plan-daily">
        <span>Per day</span>
        <span>Owner <b>{formatMoney(income.ownerPerDay)}</b></span>
        <span>Fuel <b>{formatMoney(income.fuelPerDay)}</b></span>
        <span>Other costs <b>{formatMoney(income.maintenancePerDay)}</b></span>
        <span>Estimated keep <b>{formatMoney(income.keptPerDay)}</b></span>
      </div>
      {income.shortfall > 0 && <p className="income-plan-warning" role="status">You are short {formatMoney(income.shortfall)} per week. The owner reserve comes first, followed by weekly costs.</p>}
      <p className={`income-plan-actual income-plan-actual-${income.actualStatus}`}>
        {income.actualStatus === 'not-recorded' ? 'No income logged yet this week.' : `This week’s actual income is ${income.actualStatus === 'ahead' ? `ahead by ${formatMoney(income.actualDifference)}` : income.actualStatus === 'behind' ? `behind by ${formatMoney(income.actualDifference)}` : 'on plan'}.`}
      </p>
    </> : <p className="income-plan-empty">Enter daily income to see the weekly and per-day split.</p>}
    {plan.funds && <div className="income-plan-funds"><strong>Set aside now</strong><span>Owner <b>{formatMoney(plan.funds.ownerSetAside)}</b></span><span>Fuel <b>{formatMoney(plan.funds.fuelSetAside)}</b></span><span>Other costs <b>{formatMoney(plan.funds.maintenanceSetAside)}</b></span></div>}
    {plan.funds?.amountBeyondReserve > 0 && <p className="income-plan-fund-warning">{formatMoney(plan.funds.amountBeyondReserve)} in payments or running costs has come from your profit because the related reserve was short.</p>}
    <div className="income-plan-payoff"><span>Payoff estimate</span><PayoffSummary estimate={plan.payoff} compact showBalances={false}/></div>
  </section>;
}
