// Pure helpers for how much a retiree needs in the 401(k): taxes on withdrawals
// and a Social Security / pension benefit that starts later. No DOM, no globals.
import { monthlyRate } from "./calc.js?v=270c7a2de5";

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

/**
 * 401(k) balance needed to retire at `retireAge`.
 * The benefit offsets spending dollar for dollar; only 401(k) withdrawals are
 * taxed. Before the benefit starts the 401(k) pays the full spending (funded by
 * an annuity at the real return); afterwards it pays the shortfall at the
 * safe withdrawal rate.
 */
export function requiredBalance({ spending, taxRate, swr, benefit = 0, benefitAge = 67, retireAge, annualReturn }) {
  if (!(swr > 0)) return NaN;
  const wPre = grossWithdrawal(spending, taxRate);
  const wPost = grossWithdrawal(Math.max(0, spending - benefit), taxRate);
  const bridge = annuityFactor(annualReturn, bridgeMonths(benefitAge, retireAge));
  return wPost / swr + (wPre - wPost) * bridge;
}

/**
 * Annual spending that makes `requiredBalance` equal `required` (its inverse in
 * spending). NaN when no spending maps to that balance.
 */
export function spendingFromRequired({ required, taxRate, swr, benefit = 0, benefitAge = 67, retireAge, annualReturn }) {
  if (!(swr > 0) || !(taxRate >= 0 && taxRate < 1) || !(required >= 0)) return NaN;
  const k = 1 - taxRate;
  const a = annuityFactor(annualReturn, bridgeMonths(benefitAge, retireAge));
  if (k * required >= benefit * a) return benefit + (k * required - benefit * a) * swr;
  return a > 0 ? (k * required) / a : NaN;
}

/** True when a benefit that has started by retirement covers all spending, so no 401(k) balance is needed. */
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

/** Which early-withdrawal note applies to a retirement age: "none", "rule-of-55" or "before-55". */
export function earlyAccessGuidance(retireAge) {
  if (retireAge >= EARLY_ACCESS_AGE) return "none";
  return retireAge >= 55 ? "rule-of-55" : "before-55";
}
