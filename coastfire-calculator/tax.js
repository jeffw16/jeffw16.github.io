// Federal (plus flat state) income tax on 401(k) withdrawals, used to suggest the
// "effective tax rate on withdrawals". Pure functions, no DOM or globals.
//
// Sources, tax year 2025 (IRS, "Federal income tax rates and brackets" and Publication 17,
// Tables 10-1 and 10-2; Publication 915 for the Social Security worksheet):
//   - Ordinary-income brackets and standard deductions for Single, Married filing jointly
//     and Head of household.
//   - The extra standard deduction at 65+ is the Table 10-2 amount minus the Table 10-1 amount
//     (single 17,750 - 15,750; joint 33,100 - 31,500 for one box; head 25,625 - 23,625).
//   - Social Security "base amount" 25,000 (single, head of household) / 32,000 (joint).
//     The "adjusted base amount" 34,000 / 44,000 is the second statutory threshold of the
//     same worksheet (not indexed for inflation).
// Simplifications: ordinary income only (no capital gains rates), standard deduction only,
// benefits are treated as Social Security, and state tax is a flat rate on taxable withdrawals.

export const TAX_YEAR = 2025;

export const FILING_STATUSES = Object.freeze([
  Object.freeze({ id: "single", label: "Single" }),
  Object.freeze({ id: "married", label: "Married filing jointly" }),
  Object.freeze({ id: "head", label: "Head of household" }),
]);
export const DEFAULT_FILING_STATUS = "single";

const INF = Infinity;
// [top of bracket, rate], lowest bracket first.
export const BRACKETS = Object.freeze({
  single: [[11925, 0.1], [48475, 0.12], [103350, 0.22], [197300, 0.24], [250525, 0.32], [626350, 0.35], [INF, 0.37]],
  married: [[23850, 0.1], [96950, 0.12], [206700, 0.22], [394600, 0.24], [501050, 0.32], [751600, 0.35], [INF, 0.37]],
  head: [[17000, 0.1], [64850, 0.12], [103350, 0.22], [197300, 0.24], [250500, 0.32], [626350, 0.35], [INF, 0.37]],
});

export const STANDARD_DEDUCTION = Object.freeze({ single: 15750, married: 31500, head: 23625 });
/** Extra standard deduction per person aged 65+. */
export const OVER_65_EXTRA = Object.freeze({ single: 2000, married: 1600, head: 2000 });
/** People on the return (a joint return assumes both are 65+ when `over65` is set). */
export const PEOPLE = Object.freeze({ single: 1, married: 2, head: 1 });

export const SS_BASE = Object.freeze({ single: 25000, married: 32000, head: 25000 });
export const SS_ADJUSTED = Object.freeze({ single: 34000, married: 44000, head: 34000 });

const bracketsFor = (status) => BRACKETS[status] ?? BRACKETS[DEFAULT_FILING_STATUS];
const known = (status) => (status in BRACKETS ? status : DEFAULT_FILING_STATUS);

/** Federal income tax on `taxableIncome` (after deductions). */
export function federalTax(taxableIncome, status) {
  if (!(taxableIncome > 0)) return 0;
  let tax = 0;
  let floor = 0;
  for (const [top, rate] of bracketsFor(status)) {
    if (taxableIncome <= floor) break;
    tax += (Math.min(taxableIncome, top) - floor) * rate;
    floor = top;
  }
  return tax;
}

/** Standard deduction, with the extra amount for each person aged 65+ when `over65`. */
export function standardDeduction(status, over65 = false) {
  const s = known(status);
  return STANDARD_DEDUCTION[s] + (over65 ? OVER_65_EXTRA[s] * PEOPLE[s] : 0);
}

/**
 * Taxable part of Social Security: up to 50% above the base amount and up to 85%
 * above the adjusted base amount, based on provisional income = other income + half the benefit.
 */
export function taxableSocialSecurity({ benefit, otherIncome, status }) {
  if (!(benefit > 0)) return 0;
  const s = known(status);
  const provisional = Math.max(0, otherIncome) + benefit / 2;
  const base = SS_BASE[s];
  const adjusted = SS_ADJUSTED[s];
  if (provisional <= base) return 0;
  const tierOne = Math.min(benefit / 2, (Math.min(provisional, adjusted) - base) / 2);
  if (provisional <= adjusted) return tierOne;
  return Math.min(0.85 * benefit, 0.85 * (provisional - adjusted) + tierOne);
}

/**
 * Tax on a year with a gross 401(k) `withdrawal` and a Social Security `benefit`.
 * `taxFreeShare` is the part of the withdrawal that is untaxed (Roth, or a return of basis).
 */
export function taxBreakdown({ withdrawal, benefit = 0, status = DEFAULT_FILING_STATUS, over65 = false, stateRate = 0, taxFreeShare = 0 }) {
  const taxableWithdrawal = withdrawal * (1 - taxFreeShare);
  const taxedBenefit = taxableSocialSecurity({ benefit, otherIncome: taxableWithdrawal, status });
  const income = taxableWithdrawal + taxedBenefit;
  const deduction = standardDeduction(status, over65);
  const taxableIncome = Math.max(0, income - deduction);
  const federal = federalTax(taxableIncome, status);
  const state = stateRate * taxableWithdrawal;
  return { withdrawal, benefit, taxableWithdrawal, taxableBenefit: taxedBenefit, income, deduction, taxableIncome, federal, state, total: federal + state };
}

/**
 * The effective tax rate on 401(k) withdrawals that leaves `spending` after tax once a
 * `benefit` also pays. Returns { rate, withdrawal, breakdown }; `rate` is tax / withdrawal,
 * the quantity the calculator's tax-rate field means. 0 when the benefit alone covers spending.
 */
export function estimateRate({ spending, benefit = 0, status = DEFAULT_FILING_STATUS, over65 = false, stateRate = 0, taxFreeShare = 0 }) {
  const need = spending - benefit;
  const at = (withdrawal) => taxBreakdown({ withdrawal, benefit, status, over65, stateRate, taxFreeShare });
  if (!(need > 0)) return { rate: 0, withdrawal: 0, breakdown: at(0) };
  const net = (b) => b.withdrawal + b.benefit - b.total;
  let lo = need;
  let hi = need * 2 + 1000;
  for (let k = 0; k < 60 && net(at(hi)) < spending; k++) hi *= 2;
  for (let k = 0; k < 200 && hi - lo > 1e-6; k++) {
    const mid = (lo + hi) / 2;
    if (net(at(mid)) < spending) lo = mid;
    else hi = mid;
  }
  const breakdown = at(hi);
  return { rate: breakdown.total / breakdown.withdrawal, withdrawal: breakdown.withdrawal, breakdown };
}
