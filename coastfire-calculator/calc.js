// Pure CoastFIRE math. No DOM access, no globals, no mutation of arguments.
// All money values are in today's dollars; all returns are real (after inflation).

export const DEFAULT_MAX_AGE = 100;

// Relative tolerance so floating-point noise doesn't push a crossing a month late.
const EPSILON = 1e-9;

export const PORTFOLIOS = Object.freeze([
  Object.freeze({ id: "sp500", label: "100% S&P 500", rate: 0.07, note: "Long-run average real return of the S&P 500" }),
  Object.freeze({ id: "total-market", label: "Total US stock market", rate: 0.068, note: "Broad US equities incl. small/mid caps" }),
  Object.freeze({ id: "global-80-20", label: "80/20 global stocks/bonds", rate: 0.06, note: "Aggressive diversified portfolio" }),
  Object.freeze({ id: "target-date", label: "Target-date fund", rate: 0.055, note: "Glide path that de-risks toward retirement" }),
  Object.freeze({ id: "balanced-60-40", label: "60/40 stocks/bonds", rate: 0.05, note: "Classic balanced portfolio" }),
  Object.freeze({ id: "conservative-40-60", label: "40/60 stocks/bonds", rate: 0.04, note: "Conservative, bond-heavy portfolio" }),
]);

export const DEFAULT_PORTFOLIO_ID = "sp500";

/** Real annual return for a preset id, or the custom rate when id is "custom". */
export function resolveReturn(presetId, customRate) {
  if (presetId === "custom") {
    return Number.isFinite(customRate) ? customRate : defaultRate();
  }
  const preset = PORTFOLIOS.find((p) => p.id === presetId);
  return preset ? preset.rate : defaultRate();
}

function defaultRate() {
  return PORTFOLIOS.find((p) => p.id === DEFAULT_PORTFOLIO_ID).rate;
}

/** Monthly rate that compounds to the given annual rate over 12 months. */
export function monthlyRate(annualRate) {
  return Math.pow(1 + annualRate, 1 / 12) - 1;
}

/** Balance needed to fully retire: annual spending / safe withdrawal rate. */
export function fireNumber(annualSpending, withdrawalRate) {
  if (!(withdrawalRate > 0)) return NaN;
  return annualSpending / withdrawalRate;
}

/** Annual spending a FIRE number supports at a withdrawal rate (inverse of fireNumber). */
export function spendingFromFire(fire, withdrawalRate) {
  if (!(withdrawalRate > 0)) return NaN;
  return fire * withdrawalRate;
}

/**
 * Balance needed at `age` so that, with no further contributions, it grows to
 * `fire` by `retirementAge`. At or after retirement age it is simply `fire`.
 */
export function coastTarget({ fire, annualReturn, age, retirementAge }) {
  const years = Math.max(0, retirementAge - age);
  return fire / Math.pow(1 + annualReturn, years);
}

/** Balance after `years` of growth with no contributions. */
export function balanceNoContrib(balance, annualReturn, years) {
  return balance * Math.pow(1 + annualReturn, years);
}

/** Balance after `months` of growth plus end-of-month contributions. */
export function balanceWithContrib(balance, monthlyContribution, annualReturn, months) {
  const rm = monthlyRate(annualReturn);
  if (rm === 0) return balance + monthlyContribution * months;
  const growth = Math.pow(1 + rm, months);
  return balance * growth + monthlyContribution * ((growth - 1) / rm);
}

export function isCoastReached(balance, target) {
  return balance >= target * (1 - EPSILON);
}

/**
 * Month-by-month balances: out[0] = balance, then each month grows by that
 * month's return and receives that month's contribution at month end.
 * `monthlyReturns` is an array (one monthly rate per month) or a single number
 * used for every month. Returns a Float64Array of length contributions.length + 1.
 */
export function simulate({ balance, contributions, monthlyReturns }) {
  const months = contributions.length;
  const constant = typeof monthlyReturns === "number";
  const out = new Float64Array(months + 1);
  out[0] = balance;
  for (let n = 0; n < months; n++) {
    out[n + 1] = out[n] * (1 + (constant ? monthlyReturns : monthlyReturns[n])) + contributions[n];
  }
  return out;
}

/** A contribution schedule of the same amount every month. */
export function constantSchedule(monthly, months) {
  return new Float64Array(Math.max(0, months)).fill(monthly);
}

/**
 * First month index n whose balance reaches `targetAt(n)` (within tolerance),
 * or null if none does.
 */
export function firstMonthAtOrAbove(balances, targetAt) {
  for (let n = 0; n < balances.length; n++) {
    if (isCoastReached(balances[n], targetAt(n))) return n;
  }
  return null;
}

/**
 * Earliest age (in 1-month steps) at which the contributed balance reaches the
 * CoastFIRE target. Returns `age` if already there, or null if it isn't reached
 * by retirement age (or maxAge). `contributions` optionally replaces the
 * constant `monthlyContribution` with a per-month schedule.
 */
export function findCoastAge({ age, balance, monthlyContribution, annualReturn, fire, retirementAge, maxAge = DEFAULT_MAX_AGE, contributions }) {
  const lastAge = Math.min(retirementAge, maxAge);
  const months = Math.round((lastAge - age) * 12);
  if (months < 0) return null;
  const schedule = contributions ? contributions.slice(0, months) : constantSchedule(monthlyContribution, months);
  const balances = simulate({ balance, contributions: schedule, monthlyReturns: monthlyRate(annualReturn) });
  const n = firstMonthAtOrAbove(balances, (k) => coastTarget({ fire, annualReturn, age: age + k / 12, retirementAge }));
  return n === null ? null : age + n / 12;
}

/**
 * Earliest age (in 1-month steps) at which the contributed balance reaches the
 * balance needed to fully retire. Returns null if not reached by maxAge.
 * `requiredAt(age)` gives the balance needed at an age (default: constant `fire`);
 * `contributions` optionally replaces the constant `monthlyContribution`.
 */
export function findFireAge({ age, balance, monthlyContribution, annualReturn, fire, maxAge = DEFAULT_MAX_AGE, requiredAt = () => fire, contributions }) {
  const months = Math.round((maxAge - age) * 12);
  if (months < 0) return null;
  const schedule = contributions ? contributions.slice(0, months) : constantSchedule(monthlyContribution, months);
  const balances = simulate({ balance, contributions: schedule, monthlyReturns: monthlyRate(annualReturn) });
  const n = firstMonthAtOrAbove(balances, (k) => requiredAt(age + k / 12));
  return n === null ? null : age + n / 12;
}

/**
 * Monthly contribution needed to reach `fire` exactly at `retirementAge`.
 * 0 if the current balance alone gets there; null if retirementAge <= age.
 */
export function requiredMonthlyContribution({ age, balance, annualReturn, fire, retirementAge }) {
  const months = Math.round((retirementAge - age) * 12);
  if (months <= 0) return null;
  const rm = monthlyRate(annualReturn);
  const shortfall = rm === 0
    ? fire - balance
    : fire - balance * Math.pow(1 + rm, months);
  if (shortfall <= 0) return 0;
  return rm === 0 ? shortfall / months : (shortfall * rm) / (Math.pow(1 + rm, months) - 1);
}

/** Last age to show on the chart: a few years past the later of the milestones. */
export function chartEndAge({ age, retirementAge, fireAge, maxAge = DEFAULT_MAX_AGE, padding = 5 }) {
  const milestone = Math.max(retirementAge, fireAge ?? 0, age + 1);
  return Math.min(maxAge, Math.ceil(milestone + padding));
}

/**
 * Yearly series for the chart, from `age` through `endAge` inclusive.
 * `contributions` optionally replaces the constant `monthlyContribution`.
 */
export function buildSeries({ age, balance, monthlyContribution, annualReturn, fire, retirementAge, endAge, contributions }) {
  const years = Math.max(0, Math.floor(endAge - age));
  const schedule = contributions ? contributions.slice(0, years * 12) : constantSchedule(monthlyContribution, years * 12);
  const balances = simulate({ balance, contributions: schedule, monthlyReturns: monthlyRate(annualReturn) });
  const ages = [];
  const noContrib = [];
  const withContrib = [];
  const target = [];
  for (let t = 0; t <= years; t++) {
    const a = age + t;
    ages.push(a);
    noContrib.push(balanceNoContrib(balance, annualReturn, t));
    withContrib.push(balances[Math.min(t * 12, balances.length - 1)]);
    target.push(coastTarget({ fire, annualReturn, age: a, retirementAge }));
  }
  return { ages, noContrib, withContrib, coastTarget: target };
}

/** Split a fractional age into whole years and months. */
export function splitAge(age) {
  const totalMonths = Math.round(age * 12);
  return { years: Math.floor(totalMonths / 12), months: totalMonths % 12 };
}
