import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PORTFOLIOS,
  DEFAULT_PORTFOLIO_ID,
  resolveReturn,
  monthlyRate,
  fireNumber,
  spendingFromFire,
  coastTarget,
  balanceNoContrib,
  balanceWithContrib,
  isCoastReached,
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
