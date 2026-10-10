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
 * Earliest age (in 1-month steps) at which the contributed balance reaches the
 * CoastFIRE target. Returns `age` if already there, or null if it isn't reached
 * by retirement age (or maxAge).
 */
export function findCoastAge({ age, balance, monthlyContribution, annualReturn, fire, retirementAge, maxAge = DEFAULT_MAX_AGE }) {
  const lastAge = Math.min(retirementAge, maxAge);
  const months = Math.round((lastAge - age) * 12);
  for (let n = 0; n <= months; n++) {
    const a = age + n / 12;
    const b = balanceWithContrib(balance, monthlyContribution, annualReturn, n);
    if (isCoastReached(b, coastTarget({ fire, annualReturn, age: a, retirementAge }))) return a;
  }
  return null;
}

/**
 * Earliest age (in 1-month steps) at which the contributed balance reaches the
 * full FIRE number. Returns null if not reached by maxAge.
 */
export function findFireAge({ age, balance, monthlyContribution, annualReturn, fire, maxAge = DEFAULT_MAX_AGE }) {
  const months = Math.round((maxAge - age) * 12);
  for (let n = 0; n <= months; n++) {
    const b = balanceWithContrib(balance, monthlyContribution, annualReturn, n);
    if (b >= fire * (1 - EPSILON)) return age + n / 12;
  }
  return null;
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

/** Yearly series for the chart, from `age` through `endAge` inclusive. */
export function buildSeries({ age, balance, monthlyContribution, annualReturn, fire, retirementAge, endAge }) {
  const ages = [];
  const noContrib = [];
  const withContrib = [];
  const target = [];
  const years = Math.max(0, Math.floor(endAge - age));
  for (let t = 0; t <= years; t++) {
    const a = age + t;
    ages.push(a);
    noContrib.push(balanceNoContrib(balance, annualReturn, t));
    withContrib.push(balanceWithContrib(balance, monthlyContribution, annualReturn, t * 12));
    target.push(coastTarget({ fire, annualReturn, age: a, retirementAge }));
  }
  return { ages, noContrib, withContrib, coastTarget: target };
}

/** Split a fractional age into whole years and months. */
export function splitAge(age) {
  const totalMonths = Math.round(age * 12);
  return { years: Math.floor(totalMonths / 12), months: totalMonths % 12 };
}
