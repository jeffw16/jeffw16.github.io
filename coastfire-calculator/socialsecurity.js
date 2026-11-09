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
// Real wage growth: the bend points and the taxable maximum rise with the national average wage,
// which has outpaced prices by about 1% a year (the Trustees' intermediate "real-wage
// differential" is 1.1%). If your earnings keep pace with average wages, your benefit at
// eligibility (62) is today's-formula benefit times (1 + growth)^(years to 62), in today's
// dollars; after that, cost-of-living adjustments only keep pace with prices.
//
// Trust fund: the 2025 Trustees Report projects the retirement (OASI) trust fund to run out in
// 2033, after which incoming taxes would pay about 77% of scheduled benefits under current law.
// The optional cut applies that share to the whole benefit (conservative for anyone who starts
// before 2033, who would get the full amount until then).
//
// Simplifications: your earnings stay at the same level relative to average wages for every
// year you work, the benefit is your own retirement benefit only (no spousal, survivor or
// disability), and you work from `startAge` until retirement.

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
/** Default real wage growth (wages over prices) a year. */
export const DEFAULT_REAL_WAGE_GROWTH = 0.01;
/** Year the retirement trust fund is projected to run out, and the share of benefits payable after it. */
export const TRUST_FUND = Object.freeze({ depletionYear: 2033, payableShare: 0.77 });

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

/** Growth of the benefit with real wages from `currentAge` until eligibility at 62 (1 at 62 or later). */
export function wageGrowthFactor(currentAge, realWageGrowth) {
  if (!Number.isFinite(currentAge) || !Number.isFinite(realWageGrowth)) return 1;
  return Math.pow(1 + realWageGrowth, Math.max(0, EARLIEST_AGE - currentAge));
}

/**
 * Estimated benefit. Years from `startAge` to `retirementAge` count (at most 35, the rest are
 * zeros). `currentAge` and `realWageGrowth` grow the benefit with real wages until 62 (no growth
 * without them); `payableShare` (default 1) scales it for a trust-fund shortfall. Returns null for
 * unusable inputs; otherwise { eligible, years, countedEarnings, aime, todayPia, wageFactor, pia,
 * factor, payableShare, fullMonthly, monthly, annual }, where `todayPia` is the benefit at full
 * retirement age under today's formula and `pia` the same after wage growth. Not eligible
 * (benefit 0) with under 10 years of earnings.
 */
export function estimateBenefit({ annualEarnings, startAge, retirementAge, claimAge, currentAge, realWageGrowth = 0, payableShare = 1 }) {
  if (!(annualEarnings > 0) || !Number.isFinite(startAge) || !Number.isFinite(retirementAge) || !(claimAge >= EARLIEST_AGE && claimAge <= LATEST_AGE)) return null;
  const years = Math.max(0, Math.floor(retirementAge - startAge));
  const countedEarnings = Math.min(annualEarnings, TAXABLE_MAX);
  const aime = Math.floor((countedEarnings * Math.min(years, COUNTED_YEARS)) / COUNTED_YEARS / 12);
  const eligible = years >= MIN_YEARS;
  const todayPia = eligible ? primaryInsuranceAmount(aime) : 0;
  const wageFactor = wageGrowthFactor(currentAge, realWageGrowth);
  const pia = Math.floor(todayPia * wageFactor * 10 + 1e-9) / 10;
  const factor = claimingFactor(claimAge);
  const share = payableShare >= 0 && payableShare <= 1 ? payableShare : 1;
  const fullMonthly = Math.floor(pia * factor);
  const monthly = Math.floor(pia * factor * share);
  return { eligible, years, countedEarnings, aime, todayPia, wageFactor, pia, factor, payableShare: share, fullMonthly, monthly, annual: monthly * 12 };
}
