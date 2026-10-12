// Estimate a Social Security retirement benefit from a simple earnings history.
// Pure functions, no DOM or globals.
//
// Sources (SSA): "Dollar amounts in Primary Insurance Amount and maximum family benefit
// formulas" and "Contribution and benefit bases" (ssa.gov/oact/cola), 2026 rows; and
// "How Your Social Security Benefit Is Reduced" (ssa.gov/benefits/retirement/planner/ageincrease.html)
// for people born in 1960 or later. Statutory rules not in those tables, to confirm against
// ssa.gov: the 90% / 32% / 15% formula factors, the 8%-a-year credit for delaying past full
// retirement age (up to 70), and the 10 years (40 credits) of earnings needed to qualify.
//
// Simplifications: your earnings stay constant in real, wage-indexed terms for every year you
// work (so today's-dollar amounts need no wage indexing), the benefit is your own retirement
// benefit only (no spousal, survivor or disability), and you work from `startAge` until retirement.

export const SS_YEAR = 2026;
/** Monthly PIA bend points for the 2026 eligibility year. */
export const BEND_POINTS = Object.freeze([1286, 7749]);
/** PIA formula: share of average monthly earnings below, between and above the bend points. */
export const PIA_FACTORS = Object.freeze([0.9, 0.32, 0.15]);
/** Annual earnings above this aren't counted (the 2026 contribution and benefit base). */
export const TAXABLE_MAX = 184500;
export const COUNTED_YEARS = 35;
export const MIN_YEARS = 10;
export const FULL_RETIREMENT_AGE = 67;
export const EARLIEST_AGE = 62;
export const LATEST_AGE = 70;

/** Share of the full benefit received when claiming at `claimAge` (0.70 at 62, 1 at 67, 1.24 at 70). */
export function claimingFactor(claimAge) {
  const months = Math.round((claimAge - FULL_RETIREMENT_AGE) * 12);
  if (months >= 0) return 1 + (2 / 3 / 100) * Math.min(months, (LATEST_AGE - FULL_RETIREMENT_AGE) * 12);
  const early = Math.min(-months, (FULL_RETIREMENT_AGE - EARLIEST_AGE) * 12);
  const first = Math.min(early, 36);
  return 1 - (5 / 9 / 100) * first - (5 / 12 / 100) * (early - first);
}

/** Primary insurance amount (monthly benefit at full retirement age) for an average indexed monthly earnings, rounded down to the dime. */
export function primaryInsuranceAmount(aime) {
  if (!(aime > 0)) return 0;
  const [b1, b2] = BEND_POINTS;
  const [f1, f2, f3] = PIA_FACTORS;
  const pia = f1 * Math.min(aime, b1) + f2 * Math.max(0, Math.min(aime, b2) - b1) + f3 * Math.max(0, aime - b2);
  return Math.floor(pia * 10 + 1e-9) / 10;
}

/**
 * Estimated benefit. Years from `startAge` to `retirementAge` count (at most 35, the rest are
 * zeros). Returns null for unusable inputs; otherwise { eligible, years, countedEarnings, aime,
 * pia, factor, monthly, annual }. Not eligible (benefit 0) with under 10 years of earnings.
 */
export function estimateBenefit({ annualEarnings, startAge, retirementAge, claimAge }) {
  if (!(annualEarnings > 0) || !Number.isFinite(startAge) || !Number.isFinite(retirementAge) || !(claimAge >= EARLIEST_AGE && claimAge <= LATEST_AGE)) return null;
  const years = Math.max(0, Math.floor(retirementAge - startAge));
  const countedEarnings = Math.min(annualEarnings, TAXABLE_MAX);
  const aime = Math.floor((countedEarnings * Math.min(years, COUNTED_YEARS)) / COUNTED_YEARS / 12);
  const eligible = years >= MIN_YEARS;
  const pia = eligible ? primaryInsuranceAmount(aime) : 0;
  const factor = claimingFactor(claimAge);
  const monthly = Math.floor(pia * factor);
  return { eligible, years, countedEarnings, aime, pia, factor, monthly, annual: monthly * 12 };
}
