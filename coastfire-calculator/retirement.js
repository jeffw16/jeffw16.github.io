// Pure helpers for how much a retiree needs in retirement accounts: taxes on withdrawals
// and a Social Security / pension benefit that starts later. No DOM, no globals.
import { monthlyRate } from "./calc.js?v=c6dcd7d35c";

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

export const EARLY_ACCESS_AGE = 59.5;
/** The 10% additional tax on early distributions (IRC §72(t)), paid on top of income tax. */
export const EARLY_PENALTY_RATE = 0.1;

/**
 * How withdrawals before 59½ are treated:
 * - "penalty": every withdrawal before 59½ owes the 10% penalty.
 * - "rule55": the Rule of 55 — no penalty when you leave your employer at 55 or
 *   later (approximated as a retirement age of 55+); retiring earlier, the
 *   penalty applies until 59½.
 * - "rule50": the same at 50, for public-safety workers in a governmental plan.
 * - "none": penalty-free early access (72(t) payments, a Roth conversion ladder,
 *   governmental 457(b) money, taxable savings).
 */
export const EARLY_ACCESS_OPTIONS = Object.freeze([
  Object.freeze({ id: "penalty", label: "Pay the 10% penalty until 59½" }),
  Object.freeze({ id: "rule55", label: "Rule of 55 (leave my job at 55 or later)" }),
  Object.freeze({ id: "rule50", label: "Rule of 55 for public safety (age 50)" }),
  Object.freeze({ id: "none", label: "No penalty (72(t), Roth ladder, 457(b), taxable)" }),
]);
export const DEFAULT_EARLY_ACCESS = "penalty";
const RULE_AGES = Object.freeze({ rule55: 55, rule50: 50 });

/** Age from which withdrawals are penalty-free, for a retirement age and an early-access choice. */
export function penaltyFreeAge(retireAge, earlyAccess = DEFAULT_EARLY_ACCESS) {
  if (earlyAccess === "none") return retireAge;
  const ruleAge = RULE_AGES[earlyAccess];
  if (ruleAge !== undefined && retireAge >= ruleAge) return retireAge;
  return Math.max(retireAge, EARLY_ACCESS_AGE);
}

/**
 * Required balance as `alpha * spending + beta * max(0, spending - benefit)`:
 * the first term pays the full spending until the benefit starts, the second
 * the shortfall left once it has. Withdrawals are grossed up for tax and,
 * before the penalty-free age, also for the 10% penalty. NaN when the rates
 * don't allow a gross-up.
 */
function needCoefficients({ taxRate, swr, benefitAge = 67, retireAge, annualReturn, earlyAccess = DEFAULT_EARLY_ACCESS }) {
  if (!(swr > 0) || !(taxRate >= 0 && taxRate < 1)) return { alpha: NaN, beta: NaN };
  const k = 1 - taxRate;
  const bridge = bridgeMonths(benefitAge, retireAge);
  const penalty = bridgeMonths(penaltyFreeAge(retireAge, earlyAccess), retireAge);
  // Extra withdrawn per $1 of spending while the penalty applies.
  const extra = penalty > 0 ? grossWithdrawal(1, taxRate + EARLY_PENALTY_RATE) - 1 / k : 0;
  const preBenefit = annuityFactor(annualReturn, Math.min(bridge, penalty));
  const bridgeFactor = annuityFactor(annualReturn, bridge);
  return {
    alpha: bridgeFactor / k + extra * preBenefit,
    beta: 1 / (k * swr) - bridgeFactor / k + extra * (annuityFactor(annualReturn, penalty) - preBenefit),
  };
}

/**
 * Retirement balance needed to retire at `retireAge`.
 * The benefit offsets spending dollar for dollar; only withdrawals are
 * taxed. Before the benefit starts the balance pays the full spending (funded by
 * an annuity at the real return); afterwards it pays the shortfall at the
 * safe withdrawal rate. Withdrawals before the penalty-free age (see
 * `earlyAccess`) also pay the 10% early-withdrawal penalty, funded the same way.
 */
export function requiredBalance({ spending, benefit = 0, ...rest }) {
  const { alpha, beta } = needCoefficients(rest);
  return alpha * spending + beta * Math.max(0, spending - benefit);
}

/** The part of `requiredBalance` that pays the early-withdrawal penalty (0 when none applies). */
export function earlyPenaltyCost(need) {
  const cost = requiredBalance(need) - requiredBalance({ ...need, earlyAccess: "none" });
  return cost > 0 ? cost : 0;
}

/**
 * Annual spending that makes `requiredBalance` equal `required` (its inverse in
 * spending). NaN when no spending maps to that balance.
 */
export function spendingFromRequired({ required, benefit = 0, ...rest }) {
  const { alpha, beta } = needCoefficients(rest);
  if (!Number.isFinite(alpha) || !(required >= 0)) return NaN;
  if (required >= alpha * benefit) return benefit + (required - alpha * benefit) / (alpha + beta);
  return alpha > 0 ? required / alpha : NaN;
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

/**
 * Which early-withdrawal note applies to a retirement age and early-access choice:
 * "none" (59½ or later), "penalty" (the penalty applies until 59½), "rule-of-55"
 * (the Rule of 55 waives it), "rule-too-early" (Rule of 55 chosen, but retiring
 * before its age) or "penalty-free" (counted as penalty-free).
 */
export function earlyAccessGuidance(retireAge, earlyAccess = DEFAULT_EARLY_ACCESS) {
  if (!(retireAge < EARLY_ACCESS_AGE)) return "none";
  if (earlyAccess === "none") return "penalty-free";
  if (earlyAccess in RULE_AGES) return penaltyFreeAge(retireAge, earlyAccess) === retireAge ? "rule-of-55" : "rule-too-early";
  return "penalty";
}
