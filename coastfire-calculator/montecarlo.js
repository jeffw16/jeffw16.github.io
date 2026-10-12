// Monte Carlo helpers: seeded random market paths and statistics over them.
// All functions are pure; randomness only enters through an explicit seed.
import { simulate, firstMonthAtOrAbove } from "./calc.js?v=270c7a2de5";

const EPSILON = 1e-9;

/** Seeded PRNG (mulberry32): () => number in [0, 1). The same seed gives the same sequence. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Two independent standard normals from two uniforms (Box–Muller). */
export function normalPair(rand) {
  let u1 = rand();
  while (u1 === 0) u1 = rand();
  const u2 = rand();
  const radius = Math.sqrt(-2 * Math.log(u1));
  return [radius * Math.cos(2 * Math.PI * u2), radius * Math.sin(2 * Math.PI * u2)];
}

/**
 * One path of monthly returns where ln(1+R) is normal with mean ln(1+r)/12 and
 * standard deviation volatility/√12. The *median* compound annual return is the
 * stated `annualReturn` (the average is a little higher, as in real markets).
 */
export function lognormalMonthlyReturns({ annualReturn, volatility, months, rand }) {
  const mu = Math.log(1 + annualReturn) / 12;
  const sigma = volatility / Math.sqrt(12);
  const out = new Float64Array(months);
  for (let n = 0; n < months; n += 2) {
    const [z1, z2] = normalPair(rand);
    out[n] = Math.exp(mu + sigma * z1) - 1;
    if (n + 1 < months) out[n + 1] = Math.exp(mu + sigma * z2) - 1;
  }
  return out;
}

/** `paths` independent monthly-return paths, reproducible from `seed`. */
export function monthlyReturnPaths({ paths = 1000, seed = 1, months, annualReturn, volatility }) {
  const rand = mulberry32(seed);
  return Array.from({ length: paths }, () => lognormalMonthlyReturns({ annualReturn, volatility, months, rand }));
}

/** Balances (Float64Array per path) when each return path is combined with one contribution schedule. */
export function balancePaths({ returnPaths, balance, contributions }) {
  return returnPaths.map((returns) => {
    const schedule = contributions.length > returns.length ? contributions.slice(0, returns.length) : contributions;
    return simulate({ balance, contributions: schedule, monthlyReturns: returns });
  });
}

/** Linear-interpolated percentile (p in [0, 1]) of an ascending-sorted array. */
export function percentile(sorted, p) {
  if (sorted.length === 0) return NaN;
  const index = Math.min(1, Math.max(0, p)) * (sorted.length - 1);
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
}

/**
 * Percentiles of balance at each whole year (0..years) across paths, as an
 * array per requested probability: result[k][t] is the probs[k] percentile at year t.
 */
export function percentilesByYear(paths, probs, years = Math.floor((paths[0].length - 1) / 12)) {
  const result = probs.map(() => []);
  const column = new Float64Array(paths.length);
  for (let t = 0; t <= years; t++) {
    for (let k = 0; k < paths.length; k++) column[k] = paths[k][Math.min(t * 12, paths[k].length - 1)];
    column.sort();
    probs.forEach((p, k) => result[k].push(percentile(column, p)));
  }
  return result;
}

/** Share of paths whose balance at `month` reaches `target`. */
export function successRate(paths, month, target) {
  if (paths.length === 0) return 0;
  let hits = 0;
  for (const path of paths) if (path[Math.min(month, path.length - 1)] >= target * (1 - EPSILON)) hits++;
  return hits / paths.length;
}

/**
 * Distribution of the age at which each path first reaches the balance needed
 * to fully retire (`requiredAt(age)`). Returns { p10, p50, p90 } ages, where an
 * age is null if that share of paths never gets there within the path length.
 */
export function fireAgeDistribution(paths, requiredAt, age) {
  const months = paths[0].length;
  const required = Array.from({ length: months }, (_, n) => requiredAt(age + n / 12));
  const ages = new Float64Array(paths.length);
  paths.forEach((path, k) => {
    const n = firstMonthAtOrAbove(path, (m) => required[Math.min(m, months - 1)]);
    ages[k] = n === null ? Infinity : age + n / 12;
  });
  ages.sort();
  const at = (p) => {
    const value = ages[Math.min(ages.length - 1, Math.floor(p * ages.length))];
    return Number.isFinite(value) ? value : null;
  };
  return { p10: at(0.1), p50: at(0.5), p90: at(0.9) };
}

// Final balance after `months`, contributing only before `stopMonth`.
function finalBalance(balance, contributions, returns, months, stopMonth) {
  let b = balance;
  for (let n = 0; n < months; n++) b = b * (1 + returns[n]) + (n < stopMonth ? contributions[n] : 0);
  return b;
}

const shareReaching = (returnPaths, target, run) => {
  let hits = 0;
  for (const returns of returnPaths) if (run(returns) >= target * (1 - EPSILON)) hits++;
  return hits / returnPaths.length;
};

/**
 * Chance that contributing until `stopMonth` and then stopping still reaches
 * `fire` at `retirementAge`.
 */
export function coastSuccessRate({ returnPaths, balance, contributions, age, retirementAge, fire, stopMonth }) {
  const months = Math.round((retirementAge - age) * 12);
  return shareReaching(returnPaths, fire, (returns) => finalBalance(balance, contributions, returns, months, stopMonth));
}

/**
 * Earliest age at which you can stop contributing and still reach `fire` at
 * `retirementAge` in at least `confidence` of paths. null if even contributing
 * until retirement doesn't get there. Success only improves with more months of
 * contributions, so this bisects.
 */
export function coastConfidenceAge({ returnPaths, balance, contributions, age, retirementAge, fire, confidence = 0.9 }) {
  const months = Math.round((retirementAge - age) * 12);
  if (!(months >= 0)) return null;
  const ok = (stopMonth) => coastSuccessRate({ returnPaths, balance, contributions, age, retirementAge, fire, stopMonth }) >= confidence;
  if (ok(0)) return age;
  if (!ok(months)) return null;
  let lo = 0;
  let hi = months;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ok(mid)) hi = mid;
    else lo = mid;
  }
  return age + hi / 12;
}

/**
 * Smallest contribution amount (to half a cent) whose schedule, `scheduleFor(amount)`,
 * reaches `target` after `months` in at least `confidence` of paths. 0 if none is
 * needed; null if no amount works. The same paths are reused for every try, so
 * the answer is stable.
 */
export function contributionForConfidence({ returnPaths, balance, months, target, scheduleFor, confidence = 0.9 }) {
  const ok = (amount) => {
    const contributions = scheduleFor(amount);
    return shareReaching(returnPaths, target, (returns) => finalBalance(balance, contributions, returns, months, Infinity)) >= confidence;
  };
  if (ok(0)) return 0;
  let hi = 1;
  for (let k = 0; k < 60 && !ok(hi); k++) hi *= 2;
  if (!ok(hi)) return null;
  let lo = hi === 1 ? 0 : hi / 2;
  for (let k = 0; k < 100 && hi - lo > 0.005; k++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}
