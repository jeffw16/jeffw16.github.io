import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PORTFOLIOS,
  DEFAULT_PORTFOLIO_ID,
  resolveReturn,
  resolveVolatility,
  DEFAULT_CUSTOM_VOLATILITY,
  monthlyRate,
  fireNumber,
  spendingFromFire,
  coastTarget,
  balanceNoContrib,
  balanceWithContrib,
  isCoastReached,
  simulate,
  constantSchedule,
  DEFAULT_CONTRIBUTION,
  contributionSchedule,
  coastPathSchedule,
  convertContribution,
  solveEmployeeAmount,
  firstMonthAtOrAbove,
  findCoastAge,
  findFireAge,
  requiredMonthlyContribution,
  chartEndAge,
  buildSeries,
  splitAge,
} from "../coastfire-calculator/calc.js";

const close = (actual, expected, tol = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tol * Math.max(1, Math.abs(expected)), `${actual} ≉ ${expected}`);

const base = Object.freeze({
  age: 30,
  balance: 50_000,
  monthlyContribution: 500,
  annualReturn: 0.07,
  fire: 1_000_000,
  retirementAge: 65,
});

describe("PORTFOLIOS", () => {
  it("is frozen and has unique ids with sensible rates", () => {
    assert.ok(Object.isFrozen(PORTFOLIOS));
    const ids = PORTFOLIOS.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const p of PORTFOLIOS) {
      assert.ok(Object.isFrozen(p));
      assert.ok(p.rate > 0 && p.rate < 0.15);
    }
    assert.ok(ids.includes(DEFAULT_PORTFOLIO_ID));
  });
});

describe("resolveReturn", () => {
  it("returns each preset's rate", () => {
    for (const p of PORTFOLIOS) assert.equal(resolveReturn(p.id), p.rate);
  });
  it("defaults to the S&P 500 at 7% real", () => {
    assert.equal(resolveReturn("sp500"), 0.07);
  });
  it("uses the custom rate for 'custom'", () => {
    assert.equal(resolveReturn("custom", 0.031), 0.031);
    assert.equal(resolveReturn("custom", 0), 0);
    assert.equal(resolveReturn("custom", -0.01), -0.01);
  });
  it("falls back to the default for a missing custom rate or unknown id", () => {
    assert.equal(resolveReturn("custom", NaN), 0.07);
    assert.equal(resolveReturn("custom", undefined), 0.07);
    assert.equal(resolveReturn("nope"), 0.07);
  });
});

describe("resolveVolatility", () => {
  it("returns each preset's volatility, higher for more stock-heavy portfolios", () => {
    for (const p of PORTFOLIOS) {
      assert.equal(resolveVolatility(p.id), p.volatility);
      assert.ok(p.volatility > 0 && p.volatility < 0.3);
    }
    assert.ok(resolveVolatility("sp500") > resolveVolatility("balanced-60-40"));
    assert.ok(resolveVolatility("balanced-60-40") > resolveVolatility("conservative-40-60"));
  });
  it("uses the custom value for 'custom' and falls back when it isn't a number", () => {
    assert.equal(resolveVolatility("custom", 0.2), 0.2);
    assert.equal(resolveVolatility("custom", 0), 0);
    assert.equal(resolveVolatility("custom", NaN), DEFAULT_CUSTOM_VOLATILITY);
  });
  it("falls back to the default portfolio's volatility for an unknown id", () => {
    assert.equal(resolveVolatility("nope"), resolveVolatility("sp500"));
  });
});

describe("monthlyRate", () => {
  it("is 0 for 0%", () => assert.equal(monthlyRate(0), 0));
  it("compounds back to the annual rate over 12 months", () => {
    for (const r of [0.04, 0.07, 0.1]) close(Math.pow(1 + monthlyRate(r), 12) - 1, r, 1e-12);
  });
  it("is less than annual / 12 for positive rates", () => {
    assert.ok(monthlyRate(0.07) < 0.07 / 12);
  });
});

describe("fireNumber", () => {
  it("is spending / withdrawal rate", () => {
    assert.equal(fireNumber(40_000, 0.04), 1_000_000);
    close(fireNumber(60_000, 0.035), 1_714_285.714285);
  });
  it("is NaN for a zero, negative, or missing withdrawal rate", () => {
    assert.ok(Number.isNaN(fireNumber(40_000, 0)));
    assert.ok(Number.isNaN(fireNumber(40_000, -0.04)));
    assert.ok(Number.isNaN(fireNumber(40_000, undefined)));
  });
});

describe("spendingFromFire", () => {
  it("is FIRE number × withdrawal rate", () => {
    assert.equal(spendingFromFire(1_000_000, 0.04), 40_000);
    close(spendingFromFire(1_500_000, 0.035), 52_500);
  });
  it("round-trips with fireNumber", () => {
    close(fireNumber(spendingFromFire(1_234_567, 0.037), 0.037), 1_234_567);
  });
  it("is NaN for a zero, negative, or missing withdrawal rate", () => {
    assert.ok(Number.isNaN(spendingFromFire(1e6, 0)));
    assert.ok(Number.isNaN(spendingFromFire(1e6, -0.04)));
    assert.ok(Number.isNaN(spendingFromFire(1e6, undefined)));
  });
});

describe("coastTarget", () => {
  it("discounts the FIRE number back to the given age", () => {
    close(coastTarget({ fire: 1_000_000, annualReturn: 0.07, age: 30, retirementAge: 65 }), 1_000_000 / 1.07 ** 35);
    close(coastTarget({ fire: 1_000_000, annualReturn: 0.07, age: 30, retirementAge: 65 }), 93_663.6, 1e-5);
  });
  it("equals the FIRE number at and after retirement age", () => {
    assert.equal(coastTarget({ fire: 1e6, annualReturn: 0.07, age: 65, retirementAge: 65 }), 1e6);
    assert.equal(coastTarget({ fire: 1e6, annualReturn: 0.07, age: 70, retirementAge: 65 }), 1e6);
  });
  it("equals the FIRE number when returns are 0", () => {
    assert.equal(coastTarget({ fire: 1e6, annualReturn: 0, age: 30, retirementAge: 65 }), 1e6);
  });
  it("does not mutate its argument", () => {
    const args = Object.freeze({ fire: 1e6, annualReturn: 0.05, age: 40, retirementAge: 60 });
    coastTarget(args);
  });
});

describe("balanceNoContrib", () => {
  it("returns the balance after 0 years", () => assert.equal(balanceNoContrib(50_000, 0.07, 0), 50_000));
  it("compounds annually", () => {
    close(balanceNoContrib(50_000, 0.07, 10), 50_000 * 1.07 ** 10);
    close(balanceNoContrib(100, 0.1, 2), 121);
  });
  it("is flat at 0%", () => assert.equal(balanceNoContrib(50_000, 0, 30), 50_000));
});

describe("balanceWithContrib", () => {
  it("returns the balance after 0 months", () => assert.equal(balanceWithContrib(50_000, 500, 0.07, 0), 50_000));
  it("is balance + contributions at 0%", () => assert.equal(balanceWithContrib(1_000, 100, 0, 24), 3_400));
  it("matches a month-by-month simulation", () => {
    const rm = monthlyRate(0.07);
    let b = 50_000;
    for (let i = 0; i < 120; i++) b = b * (1 + rm) + 500;
    close(balanceWithContrib(50_000, 500, 0.07, 120), b, 1e-9);
  });
  it("matches balanceNoContrib with no contributions", () => {
    close(balanceWithContrib(50_000, 0, 0.07, 12 * 25), balanceNoContrib(50_000, 0.07, 25), 1e-9);
  });
});

describe("isCoastReached", () => {
  it("is false just below, true at and above the target", () => {
    assert.equal(isCoastReached(99_999, 100_000), false);
    assert.equal(isCoastReached(100_000, 100_000), true);
    assert.equal(isCoastReached(100_001, 100_000), true);
  });
  it("tolerates floating-point noise", () => {
    assert.equal(isCoastReached(100_000 - 1e-7, 100_000), true);
  });
});

describe("findCoastAge", () => {
  it("returns the current age when already at CoastFIRE", () => {
    assert.equal(findCoastAge({ ...base, balance: 100_000 }), 30);
  });
  it("finds the first month the balance meets the coast target", () => {
    const a = findCoastAge(base);
    assert.ok(a > 30 && a < 65);
    const target = (x) => coastTarget({ ...base, age: x });
    const bal = (x) => balanceWithContrib(base.balance, base.monthlyContribution, base.annualReturn, Math.round((x - 30) * 12));
    assert.ok(bal(a) >= target(a) * (1 - 1e-9));
    assert.ok(bal(a - 1 / 12) < target(a - 1 / 12));
  });
  it("returns null with no contributions when not already there", () => {
    assert.equal(findCoastAge({ ...base, monthlyContribution: 0 }), null);
  });
  it("returns null when the target can't be reached before retirement", () => {
    assert.equal(findCoastAge({ ...base, balance: 0, monthlyContribution: 50 }), null);
  });
  it("works with 0% returns", () => {
    // Need 1e6 total; 50k + 10k/mo → 95 months.
    close(findCoastAge({ ...base, annualReturn: 0, monthlyContribution: 10_000 }), 30 + 95 / 12, 1e-12);
  });
  it("does not mutate its argument", () => {
    findCoastAge(base);
    assert.ok(Object.isFrozen(base));
  });
});

describe("findFireAge", () => {
  it("returns the current age when already at the FIRE number", () => {
    assert.equal(findFireAge({ ...base, balance: 2_000_000 }), 30);
  });
  it("finds the first month the balance meets the FIRE number", () => {
    const a = findFireAge(base);
    const months = Math.round((a - 30) * 12);
    assert.ok(balanceWithContrib(50_000, 500, 0.07, months) >= 1_000_000);
    assert.ok(balanceWithContrib(50_000, 500, 0.07, months - 1) < 1_000_000);
  });
  it("returns null when unreachable by max age", () => {
    assert.equal(findFireAge({ ...base, balance: 0, monthlyContribution: 10, annualReturn: 0 }), null);
  });
  it("respects a custom max age", () => {
    assert.equal(findFireAge({ ...base, maxAge: 40 }), null);
  });
  it("works with 0% returns", () => {
    close(findFireAge({ ...base, annualReturn: 0, balance: 40_000, monthlyContribution: 8_000 }), 40, 1e-12);
  });
});

describe("requiredMonthlyContribution", () => {
  it("round-trips: contributing it reaches the FIRE number at retirement", () => {
    const c = requiredMonthlyContribution(base);
    assert.ok(c > 0);
    close(balanceWithContrib(base.balance, c, base.annualReturn, 35 * 12), base.fire, 1e-9);
  });
  it("is 0 when the current balance alone is enough", () => {
    assert.equal(requiredMonthlyContribution({ ...base, balance: 200_000 }), 0);
  });
  it("works with 0% returns", () => {
    assert.equal(requiredMonthlyContribution({ ...base, annualReturn: 0, balance: 160_000 }), 2_000);
  });
  it("is null when retirement age is not after current age", () => {
    assert.equal(requiredMonthlyContribution({ ...base, retirementAge: 30 }), null);
    assert.equal(requiredMonthlyContribution({ ...base, retirementAge: 25 }), null);
  });
  it("agrees with findFireAge", () => {
    const c = requiredMonthlyContribution({ ...base, retirementAge: 55 });
    close(findFireAge({ ...base, monthlyContribution: c }), 55, 1e-12);
  });
});

describe("chartEndAge", () => {
  it("pads past retirement age", () => {
    assert.equal(chartEndAge({ age: 30, retirementAge: 65, fireAge: 50 }), 70);
  });
  it("pads past a FIRE age later than retirement", () => {
    assert.equal(chartEndAge({ age: 30, retirementAge: 65, fireAge: 72.4 }), 78);
  });
  it("ignores a null FIRE age", () => {
    assert.equal(chartEndAge({ age: 30, retirementAge: 65, fireAge: null }), 70);
  });
  it("caps at max age", () => {
    assert.equal(chartEndAge({ age: 30, retirementAge: 98, fireAge: null }), 100);
  });
  it("always shows at least a year past the current age", () => {
    assert.equal(chartEndAge({ age: 70, retirementAge: 65, fireAge: 70, padding: 0 }), 71);
  });
});

describe("buildSeries", () => {
  const s = buildSeries({ ...base, endAge: 70 });
  it("has one aligned point per year", () => {
    assert.equal(s.ages.length, 41);
    assert.equal(s.ages[0], 30);
    assert.equal(s.ages.at(-1), 70);
    for (const key of ["noContrib", "withContrib", "coastTarget"]) assert.equal(s[key].length, s.ages.length);
  });
  it("starts both balance lines at the current balance", () => {
    assert.equal(s.noContrib[0], 50_000);
    assert.equal(s.withContrib[0], 50_000);
  });
  it("matches the underlying balance functions", () => {
    close(s.noContrib[10], balanceNoContrib(50_000, 0.07, 10));
    close(s.withContrib[10], balanceWithContrib(50_000, 500, 0.07, 120));
  });
  it("has a coast line that reaches the FIRE number at retirement and stays flat", () => {
    close(s.coastTarget[0], coastTarget({ ...base }));
    assert.equal(s.coastTarget[35], 1_000_000);
    assert.ok(s.coastTarget.slice(35).every((v) => v === 1_000_000));
    for (let i = 1; i <= 35; i++) assert.ok(s.coastTarget[i] > s.coastTarget[i - 1]);
  });
  it("returns a single point when endAge equals age", () => {
    assert.equal(buildSeries({ ...base, endAge: 30 }).ages.length, 1);
  });
});

describe("splitAge", () => {
  it("splits whole years", () => assert.deepEqual(splitAge(42), { years: 42, months: 0 }));
  it("splits fractional ages into months", () => {
    assert.deepEqual(splitAge(42 + 3 / 12), { years: 42, months: 3 });
    assert.deepEqual(splitAge(42 + 11 / 12), { years: 42, months: 11 });
  });
  it("rounds to the nearest month", () => {
    assert.deepEqual(splitAge(42.999), { years: 43, months: 0 });
  });
});

describe("simulate", () => {
  it("starts at the balance and has one more entry than there are months", () => {
    const out = simulate({ balance: 100, contributions: [0, 0, 0], monthlyReturns: 0.01 });
    assert.equal(out.length, 4);
    assert.equal(out[0], 100);
  });
  it("grows each month then adds the contribution at month end", () => {
    const out = simulate({ balance: 1000, contributions: [100, 200], monthlyReturns: [0.1, 0.2] });
    close(out[1], 1000 * 1.1 + 100);
    close(out[2], (1000 * 1.1 + 100) * 1.2 + 200);
  });
  it("treats a number as the same monthly rate every month", () => {
    const a = simulate({ balance: 500, contributions: [10, 10, 10], monthlyReturns: 0.02 });
    const b = simulate({ balance: 500, contributions: [10, 10, 10], monthlyReturns: [0.02, 0.02, 0.02] });
    assert.deepEqual([...a], [...b]);
  });
  it("matches balanceWithContrib for a range of rates and horizons", () => {
    for (const r of [0, 0.04, 0.07, -0.02]) {
      const out = simulate({ balance: 12_345, contributions: constantSchedule(321, 420), monthlyReturns: monthlyRate(r) });
      for (const n of [0, 1, 12, 420]) close(out[n], balanceWithContrib(12_345, 321, r, n), 1e-9);
    }
  });
  it("returns just the balance for zero months and does not mutate inputs", () => {
    const contributions = Object.freeze([1, 2]);
    const monthlyReturns = Object.freeze([0.1, 0.1]);
    assert.deepEqual([...simulate({ balance: 7, contributions: [], monthlyReturns: 0.5 })], [7]);
    simulate({ balance: 7, contributions, monthlyReturns });
    assert.deepEqual([...contributions], [1, 2]);
  });
});

describe("constantSchedule", () => {
  it("repeats the amount for each month", () => {
    assert.deepEqual([...constantSchedule(250, 3)], [250, 250, 250]);
  });
  it("is empty for zero or negative months", () => {
    assert.equal(constantSchedule(250, 0).length, 0);
    assert.equal(constantSchedule(250, -4).length, 0);
  });
});

describe("firstMonthAtOrAbove", () => {
  it("returns the first index meeting its target", () => {
    assert.equal(firstMonthAtOrAbove([1, 2, 3, 4], () => 3), 2);
  });
  it("uses a per-month target", () => {
    assert.equal(firstMonthAtOrAbove([1, 2, 3, 4], (n) => 10 - 2 * n), 3);
  });
  it("accepts a balance within floating-point tolerance of the target", () => {
    assert.equal(firstMonthAtOrAbove([99.99999999999], () => 100), 0);
  });
  it("returns null when never reached or empty", () => {
    assert.equal(firstMonthAtOrAbove([1, 2], () => 5), null);
    assert.equal(firstMonthAtOrAbove([], () => 0), null);
  });
});

describe("regression pins (age 30, $50k, $500/mo, 7%, $1M FIRE, 65)", () => {
  it("coast age is 30 + 121 months", () => {
    close(findCoastAge(base), 30 + 121 / 12, 1e-12);
  });
  it("FIRE age is 30 + 366 months", () => {
    close(findFireAge(base), 30 + 366 / 12, 1e-12);
  });
  it("required contribution to retire at 55 rounds to $931", () => {
    assert.equal(Math.round(requiredMonthlyContribution({ ...base, retirementAge: 55 })), 931);
  });
});

describe("findCoastAge / findFireAge extensions", () => {
  it("findCoastAge accepts a schedule equal to the constant contribution", () => {
    const contributions = constantSchedule(500, 35 * 12);
    assert.equal(findCoastAge({ ...base, contributions }), findCoastAge(base));
  });
  it("findCoastAge is null when the age window is negative", () => {
    assert.equal(findCoastAge({ ...base, age: 70 }), null);
  });
  it("findFireAge uses requiredAt per age", () => {
    // Needing less each year pulls the FIRE age earlier than a constant need.
    const earlier = findFireAge({ ...base, requiredAt: (a) => 1_000_000 - (a - 30) * 10_000 });
    assert.ok(earlier < findFireAge(base));
  });
  it("findFireAge accepts a contribution schedule", () => {
    const contributions = constantSchedule(1000, 70 * 12);
    assert.ok(findFireAge({ ...base, contributions }) < findFireAge(base));
  });
  it("does not mutate a frozen schedule", () => {
    const contributions = Object.freeze(Array.from({ length: 840 }, () => 500));
    assert.doesNotThrow(() => findFireAge({ ...base, contributions }));
  });
});

describe("contributionSchedule", () => {
  const neutral = { months: 24, unit: "usd", amount: 500 };
  it("equals a constant schedule with no raise, match or salary", () => {
    const { employee, total } = contributionSchedule(neutral);
    assert.deepEqual([...employee], [...constantSchedule(500, 24)]);
    assert.deepEqual([...total], [...employee]);
  });
  it("steps dollar contributions up by the raise every 12 months", () => {
    const { employee } = contributionSchedule({ ...neutral, months: 36, raise: 0.1 });
    close(employee[0], 500);
    close(employee[11], 500);
    close(employee[12], 550);
    close(employee[24], 605);
  });
  it("computes percent contributions from salary, growing with raises", () => {
    const { employee } = contributionSchedule({ months: 24, unit: "pct", amount: 6, salary: 120_000, raise: 0.05 });
    close(employee[0], 600);
    close(employee[12], 630);
  });
  it("percent of salary and the equivalent dollars give the same schedule", () => {
    const pct = contributionSchedule({ months: 36, unit: "pct", amount: 6, salary: 120_000, raise: 0.03, matchRate: 0.5, matchCap: 0.06 });
    const usd = contributionSchedule({ months: 36, unit: "usd", amount: 600, salary: 120_000, raise: 0.03, matchRate: 0.5, matchCap: 0.06 });
    for (let n = 0; n < 36; n++) {
      close(pct.employee[n], usd.employee[n]);
      close(pct.total[n], usd.total[n]);
    }
  });
  it("adds a match of matchRate on the employee amount up to the cap", () => {
    const below = contributionSchedule({ months: 1, unit: "usd", amount: 300, salary: 120_000, matchRate: 0.5, matchCap: 0.06 });
    close(below.total[0] - below.employee[0], 150); // 50% of 300, under the 600 cap
    const above = contributionSchedule({ months: 1, unit: "usd", amount: 1_000, salary: 120_000, matchRate: 0.5, matchCap: 0.06 });
    close(above.total[0] - above.employee[0], 300); // 50% of the capped 600
  });
  it("gives no match and no percent contribution without a salary", () => {
    const usd = contributionSchedule({ months: 2, unit: "usd", amount: 500, matchRate: 1, matchCap: 0.1 });
    assert.deepEqual([...usd.total], [500, 500]);
    const pct = contributionSchedule({ months: 2, unit: "pct", amount: 6 });
    assert.deepEqual([...pct.total], [0, 0]);
  });
  it("is empty for zero months", () => {
    assert.equal(contributionSchedule({ ...neutral, months: 0 }).total.length, 0);
  });
});

describe("convertContribution", () => {
  it("converts dollars per month to percent of salary and back", () => {
    close(convertContribution({ amount: 600, from: "usd", to: "pct", salary: 120_000 }), 6);
    close(convertContribution({ amount: 6, from: "pct", to: "usd", salary: 120_000 }), 600);
  });
  it("returns the amount unchanged when the unit is unchanged", () => {
    assert.equal(convertContribution({ amount: 5, from: "usd", to: "usd" }), 5);
  });
  it("is null when salary is needed but missing", () => {
    assert.equal(convertContribution({ amount: 5, from: "usd", to: "pct", salary: 0 }), null);
    assert.equal(convertContribution({ amount: 5, from: "pct", to: "usd", salary: NaN }), null);
  });
});

describe("DEFAULT_CONTRIBUTION", () => {
  it("has defaults for each unit", () => {
    assert.deepEqual({ ...DEFAULT_CONTRIBUTION }, { usd: 500, pct: 6 });
    assert.ok(Object.isFrozen(DEFAULT_CONTRIBUTION));
  });
});

describe("solveEmployeeAmount", () => {
  const p = { balance: 50_000, annualReturn: 0.07, months: 300, target: 1_000_000, unit: "usd" };
  it("matches requiredMonthlyContribution with neutral inputs", () => {
    const expected = requiredMonthlyContribution({ ...base, fire: 1_000_000, retirementAge: 55 });
    close(solveEmployeeAmount(p), expected, 1e-4);
    assert.ok(Math.abs(solveEmployeeAmount(p) - expected) < 0.01);
  });
  it("lands on the target when plugged back in", () => {
    const amount = solveEmployeeAmount(p);
    const { total } = contributionSchedule({ months: 300, unit: "usd", amount });
    const end = simulate({ balance: 50_000, contributions: total, monthlyReturns: monthlyRate(0.07) })[300];
    assert.ok(end >= 1_000_000 * (1 - 1e-9));
    assert.ok(end < 1_000_000 + 100);
  });
  it("is 0 when the balance alone reaches the target", () => {
    assert.equal(solveEmployeeAmount({ ...p, balance: 900_000 }), 0);
  });
  it("is null when there is no time left", () => {
    assert.equal(solveEmployeeAmount({ ...p, months: 0 }), null);
    assert.equal(solveEmployeeAmount({ ...p, months: -5 }), null);
  });
  it("asks for less when there is an employer match", () => {
    const withMatch = solveEmployeeAmount({ ...p, salary: 120_000, matchRate: 1, matchCap: 0.05 });
    assert.ok(withMatch < solveEmployeeAmount(p));
  });
  it("asks for less when raises grow the contribution", () => {
    assert.ok(solveEmployeeAmount({ ...p, raise: 0.03 }) < solveEmployeeAmount(p));
  });
  it("solves in percent of salary, equivalent to the dollar answer with no raise", () => {
    const usd = solveEmployeeAmount(p);
    const pct = solveEmployeeAmount({ ...p, unit: "pct", salary: 120_000 });
    close(pct, ((usd * 12) / 120_000) * 100, 1e-3);
  });
  it("is null for a percent target without salary", () => {
    assert.equal(solveEmployeeAmount({ ...p, unit: "pct" }), null);
  });
  it("works at a zero return", () => {
    close(solveEmployeeAmount({ ...p, annualReturn: 0, balance: 0, months: 100, target: 100_000 }), 1_000, 1e-4);
  });
});

describe("coastPathSchedule", () => {
  it("keeps contributions before the coast month and zeroes the rest", () => {
    assert.deepEqual([...coastPathSchedule(constantSchedule(100, 6), 2)], [100, 100, 0, 0, 0, 0]);
  });
  it("zeroes everything for month 0 and keeps everything past the end", () => {
    assert.deepEqual([...coastPathSchedule(constantSchedule(100, 3), 0)], [0, 0, 0]);
    assert.deepEqual([...coastPathSchedule(constantSchedule(100, 3), 99)], [100, 100, 100]);
  });
  it("does not mutate its input", () => {
    const schedule = constantSchedule(100, 4);
    coastPathSchedule(schedule, 1);
    assert.deepEqual([...schedule], [100, 100, 100, 100]);
  });
});

describe("buildSeries coastPath", () => {
  const params = { ...base, endAge: 70 };
  it("is null without a coast month", () => {
    assert.equal(buildSeries(params).coastPath, null);
  });
  it("matches the contribution line until the coast month, then grows without contributions", () => {
    const coastMonth = 120; // age 40
    const s = buildSeries({ ...params, coastMonth });
    assert.equal(s.coastPath.length, s.ages.length);
    close(s.coastPath[10], s.withContrib[10]);
    close(s.coastPath[20], s.coastPath[10] * Math.pow(1.07, 10));
  });
  it("reaches the FIRE number at the retirement age when coasting from the coast age", () => {
    const coastAge = findCoastAge(base);
    const s = buildSeries({ ...params, coastMonth: Math.round((coastAge - 30) * 12) });
    const atRetirement = s.coastPath[s.ages.indexOf(65)];
    assert.ok(atRetirement >= base.fire * (1 - 1e-3));
  });
  it("equals the no-contribution line when coasting from month 0", () => {
    const s = buildSeries({ ...params, coastMonth: 0 });
    s.coastPath.forEach((v, k) => close(v, s.noContrib[k]));
  });
});
