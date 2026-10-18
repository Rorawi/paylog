import PayoffSummary from './PayoffSummary.jsx';
import { formatMoney } from '../domain/money.js';
import { weeklyCostAmount } from '../domain/calculations.js';

function Amount({ label, value, emphasized = false }) {
  return <div className={`income-plan-amount ${emphasized ? 'income-plan-emphasis' : ''}`}>
    <span>{label}</span><strong>{formatMoney(value)}</strong>
  </div>;
}

export default function IncomePlanSummary({ plan, weeklyCosts = [], incomeType = 'earnings', showPayoff = true, showActual = true }) {
  if (!plan) return null;
  const income = plan.income;
  const costs = weeklyCosts.map((cost) => ({ ...cost, weeklyAmount: weeklyCostAmount(cost) })).filter((cost) => cost.weeklyAmount > 0);
  return <section className="income-plan-summary" aria-live="polite">
    <div className="income-plan-heading"><strong>Work income plan</strong><span>Weekly plan · monthly costs averaged</span></div>
    {income.ready ? <>
      <div className="income-plan-grid">
        <Amount label={`Weekly ${incomeType === 'sales' ? 'sales' : 'earnings'}`} value={income.weeklyIncome}/>
        <Amount label="Vehicle owner payment" value={income.ownerPayment}/>
        {costs.length ? costs.map((cost) => <Amount key={cost.id || cost.name} label={`${cost.name}${cost.period === 'monthly' ? ' (monthly avg.)' : ''}`} value={cost.weeklyAmount}/>) : <>{income.fuel > 0 && <Amount label="Fuel" value={income.fuel} />}{income.maintenance > 0 && <Amount label="Vehicle costs" value={income.maintenance} />}</>}
        <Amount label="Estimated take-home / week" value={income.keptWeekly} emphasized/>
      </div>
      <div className="income-plan-daily">
        <span>Per day</span>
        <span>Owner <b>{formatMoney(income.ownerPerDay)}</b></span>
        {costs.length ? costs.map((cost) => <span key={cost.id || cost.name}>{cost.name} <b>{formatMoney(income.daysWorkedPerWeek ? cost.weeklyAmount / income.daysWorkedPerWeek : 0)}</b></span>) : <>{income.fuel > 0 && <span>Fuel <b>{formatMoney(income.fuelPerDay)}</b></span>}{income.maintenance > 0 && <span>Vehicle costs <b>{formatMoney(income.maintenancePerDay)}</b></span>}</>}
        <span>Take-home <b>{formatMoney(income.keptPerDay)}</b></span>
      </div>
      {income.shortfall > 0 && <p className="income-plan-warning" role="status">You are short {formatMoney(income.shortfall)} per week. The owner payment comes first, then vehicle costs.</p>}
      {showActual && <p className={`income-plan-actual income-plan-actual-${income.actualStatus}`}>
        {income.actualStatus === 'not-recorded' ? 'No work income logged yet this week.' : `This week’s recorded income is ${income.actualStatus === 'ahead' ? `ahead by ${formatMoney(income.actualDifference)}` : income.actualStatus === 'behind' ? `behind by ${formatMoney(income.actualDifference)}` : 'on plan'}.`}
      </p>}
    </> : <p className="income-plan-empty">Enter expected daily sales or earnings to see the split.</p>}
    {plan.funds && <div className="income-plan-funds"><strong>Set aside from recorded work</strong><span>For vehicle payment <b>{formatMoney(plan.funds.ownerSetAside)}</b></span>{plan.funds.fuelSetAside > 0 && <span>For fuel <b>{formatMoney(plan.funds.fuelSetAside)}</b></span>}{plan.funds.maintenanceSetAside > 0 && <span>For vehicle costs <b>{formatMoney(plan.funds.maintenanceSetAside)}</b></span>}</div>}
    {plan.funds?.amountBeyondReserve > 0 && <p className="income-plan-fund-warning">{formatMoney(plan.funds.amountBeyondReserve)} in payments or vehicle costs came from your cash because the set-asides were short.</p>}
    {showPayoff && <div className="income-plan-payoff"><span>Vehicle payoff estimate</span><PayoffSummary estimate={plan.payoff} compact showBalances={false}/></div>}
  </section>;
}
