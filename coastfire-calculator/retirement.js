// Pure helpers for how much a retiree needs in retirement accounts: taxes on withdrawals
// and a Social Security / pension benefit that starts later. No DOM, no globals.
import { monthlyRate } from "./calc.js?v=aea5148f5a";

/** Withdrawal needed to net `spending` after an effective tax rate. NaN for rates outside [0, 1). */
export function grossWithdrawal(spending, taxRate) {
  if (!(taxRate >= 0 && taxRate < 1)) return NaN;
  return spending / (1 - taxRate);
}

/**
 * Present value of $1 per year, paid in equal monthly instalments for `months`
 * months, discounted at the annual return. months <= 0 gives 0.
 */
export function annuityFactor(annualReturn, months) {
  if (!(months > 0)) return 0;
  const rm = monthlyRate(annualReturn);
  if (rm === 0) return months / 12;
  return (1 / 12) * (1 - Math.pow(1 + rm, -months)) / rm;
}

/** Whole months from retirement until the benefit starts (0 if it starts first). */
function bridgeMonths(benefitAge, retireAge) {
  return Math.round(Math.max(0, benefitAge - retireAge) * 12);
}

/** Default real return on money set aside for the bridge years: roughly the real yield of a TIPS ladder. */
export const DEFAULT_BRIDGE_RETURN = 0.02;

/**
 * Real return used to fund the bridge years: `bridgeReturn`, but never above the
 * portfolio's `annualReturn`. Without a `bridgeReturn` it is the portfolio return.
 */
export function bridgeRate(annualReturn, bridgeReturn) {
  return Number.isFinite(bridgeReturn) ? Math.min(bridgeReturn, annualReturn) : annualReturn;
}

/**
 * Retirement balance needed to retire at `retireAge`.
 * The benefit offsets spending dollar for dollar; only withdrawals are
 * taxed. After the benefit starts the balance pays the shortfall, grossed up at
 * `taxRate`, at the safe withdrawal rate. Before it starts the balance pays the
 * full spending, grossed up at `bridgeTaxRate` (default `taxRate`): the part
 * above the safe-withdrawal draw is funded as an annuity at `bridgeRate`, a
 * safe real return rather than the portfolio's expected one, since those
 * dollars must be there whatever markets do.
 */
export function requiredBalance({ spending, taxRate, bridgeTaxRate = taxRate, swr, benefit = 0, benefitAge = 67, retireAge, annualReturn, bridgeReturn }) {
  if (!(swr > 0)) return NaN;
  const wPost = grossWithdrawal(Math.max(0, spending - benefit), taxRate);
  // Without a benefit there are no bridge years: the safe-withdrawal draw covers everything.
  const months = benefit > 0 ? bridgeMonths(benefitAge, retireAge) : 0;
  if (months === 0) return wPost / swr;
  const wPre = grossWithdrawal(spending, bridgeTaxRate);
  const bridge = annuityFactor(bridgeRate(annualReturn, bridgeReturn), months);
  return wPost / swr + Math.max(0, wPre - wPost) * bridge;
}

/**
 * Annual spending that makes `requiredBalance` equal `required` (its inverse in
 * spending), found by bisection. NaN when no spending maps to that balance.
 */
export function spendingFromRequired({ required, ...need }) {
  const { swr, taxRate, bridgeTaxRate = taxRate } = need;
  const validRate = (t) => t >= 0 && t < 1;
  if (!(swr > 0) || !validRate(taxRate) || !validRate(bridgeTaxRate) || !(required >= 0)) return NaN;
  const at = (spending) => requiredBalance({ ...need, spending });
  // A started benefit covers any spending up to it; otherwise only zero spending needs nothing.
  if (required === 0) return need.benefitAge <= need.retireAge ? need.benefit ?? 0 : 0;
  let lo = 0;
  let hi = Math.max(1, need.benefit ?? 0) * 2;
  for (let k = 0; k < 200 && at(hi) < required; k++) hi *= 2;
  if (!(at(hi) >= required)) return NaN;
  for (let k = 0; k < 200 && hi - lo > 1e-9 * Math.max(1, hi); k++) {
    const mid = (lo + hi) / 2;
    if (at(mid) < required) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** True when a benefit that has started by retirement covers all spending, so no retirement balance is needed. */
export function benefitCoversSpending({ spending, benefit, benefitAge, retireAge }) {
  return benefit > 0 && benefit >= spending && benefitAge <= retireAge;
}

/**
 * Function age -> required balance, scaled so it equals `anchorValue` at
 * `anchorAge`. This keeps a hand-typed FIRE number exact while the benefit
 * bridge still changes the need at other retirement ages.
 */
export function requiredBalanceFn(need, anchorAge, anchorValue) {
  const at = (retireAge) => requiredBalance({ ...need, retireAge });
  const anchor = at(anchorAge);
  const scale = anchor > 0 && Number.isFinite(anchorValue) ? anchorValue / anchor : 1;
  return (retireAge) => at(retireAge) * scale;
}

export const EARLY_ACCESS_AGE = 59.5;

/**
 * Money needed at `retireAge` that you can withdraw before 59½ without the 10% penalty
 * (taxable savings, Roth IRA contributions), and how much of it you have. The need is the
 * present value, at the bridge rate, of every withdrawal from `retireAge` to 59½: the full
 * spending grossed up at `bridgeTaxRate` before the benefit starts, the shortfall grossed up
 * at `taxRate` after. `accessible` is the part of today's balance you can already reach,
 * grown at the portfolio return from `age` with no contributions. Returns { months, needed,
 * accessibleAtRetirement, shortfall }; months and needed are 0 from 59½ on.
 */
export function earlyAccessNeed({ spending, taxRate, bridgeTaxRate = taxRate, benefit = 0, benefitAge = 67, retireAge, annualReturn, bridgeReturn, age, accessible = 0 }) {
  const months = Math.max(0, Math.round((EARLY_ACCESS_AGE - retireAge) * 12));
  const rate = bridgeRate(annualReturn, bridgeReturn);
  const benefitMonth = Math.min(months, benefit > 0 ? Math.max(0, Math.round((benefitAge - retireAge) * 12)) : months);
  const wPre = grossWithdrawal(spending, bridgeTaxRate);
  const wPost = grossWithdrawal(Math.max(0, spending - benefit), taxRate);
  // Payments in months [0, benefitMonth) at wPre, then [benefitMonth, months) at wPost.
  const before = annuityFactor(rate, benefitMonth);
  const after = annuityFactor(rate, months) - before;
  const needed = months > 0 ? wPre * before + wPost * after : 0;
  const years = Math.max(0, retireAge - age);
  const accessibleAtRetirement = accessible > 0 && Number.isFinite(years) ? accessible * Math.pow(1 + annualReturn, years) : 0;
  return { months, needed, accessibleAtRetirement, shortfall: Math.max(0, needed - accessibleAtRetirement) };
}

/** Which early-withdrawal note applies to a retirement age: "none", "rule-of-55" or "before-55". */
export function earlyAccessGuidance(retireAge) {
  if (retireAge >= EARLY_ACCESS_AGE) return "none";
  return retireAge >= 55 ? "rule-of-55" : "before-55";
}

// Withdrawal-rate guidelines by retirement length. The 4% rule comes from 30-year
// retirements (Bengen 1994; the Trinity study, 1998); for longer horizons, historical
// studies such as Early Retirement Now's "Safe Withdrawal Rate Series" (2016-)
// put the rate that survived nearly every historical start year at about 3.25-3.5%
// for 50-60 years. [years of retirement, rate], shortest first; rates between rows
// are interpolated and the last row holds beyond it.
export const SWR_GUIDELINES = Object.freeze([[30, 0.04], [40, 0.037], [50, 0.035], [60, 0.033]]);
/** Age the withdrawal-rate guideline plans to. */
export const PLAN_TO_AGE = 95;

/**
 * Suggested safe withdrawal rate for retiring at `retireAge` and planning to
 * `planToAge`, rounded to 0.1 percentage point. 4% for 30 years or less.
 */
export function suggestedWithdrawalRate(retireAge, planToAge = PLAN_TO_AGE) {
  const years = planToAge - retireAge;
  if (!Number.isFinite(years)) return NaN;
  const rows = SWR_GUIDELINES;
  let rate = rows.at(-1)[1];
  if (years <= rows[0][0]) rate = rows[0][1];
  else {
    for (let k = 1; k < rows.length; k++) {
      const [y0, r0] = rows[k - 1];
      const [y1, r1] = rows[k];
      if (years <= y1) { rate = r0 + ((years - y0) / (y1 - y0)) * (r1 - r0); break; }
    }
  }
  return Math.round(rate * 1000) / 1000;
}
