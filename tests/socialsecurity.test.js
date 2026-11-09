import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BEND_POINTS, TAXABLE_MAX, claimingFactor, primaryInsuranceAmount, estimateBenefit,
  wageGrowthFactor, DEFAULT_REAL_WAGE_GROWTH, TRUST_FUND,
} from "../coastfire-calculator/socialsecurity.js";

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
const pct1 = (x) => Math.round(x * 1000) / 10; // one decimal, like SSA's table

describe("SSA 2026 figures", () => {
  it("match the published table", () => {
    assert.deepEqual([...BEND_POINTS], [1286, 7749]);
    assert.equal(TAXABLE_MAX, 184500);
  });
});

describe("claimingFactor", () => {
  it("matches SSA's reduction table for people born in 1960 or later", () => {
    const table = [[62, 70.0], [62 + 1 / 12, 70.4], [63, 75.0], [63.5, 77.5], [64, 80.0], [64.5, 83.3], [65, 86.7], [65.5, 90.0], [66, 93.3], [66 + 11 / 12, 99.4], [67, 100.0]];
    for (const [age, expected] of table) assert.equal(pct1(claimingFactor(age)), expected, `age ${age}`);
  });
  it("adds two-thirds of a percent a month after 67, up to 70", () => {
    near(claimingFactor(68), 1.08);
    near(claimingFactor(70), 1.24);
    near(claimingFactor(72), 1.24);
  });
  it("doesn't go below the age-62 reduction", () => {
    near(claimingFactor(60), 0.7);
  });
});

describe("primaryInsuranceAmount", () => {
  it("is 0 for no earnings", () => {
    assert.equal(primaryInsuranceAmount(0), 0);
    assert.equal(primaryInsuranceAmount(-5), 0);
  });
  it("is 90% below the first bend point", () => {
    assert.equal(primaryInsuranceAmount(1000), 900);
  });
  it("adds 32% between the bend points and 15% above, rounded down to the dime", () => {
    assert.equal(primaryInsuranceAmount(5000), 2345.8); // 1,157.40 + 1,188.48 = 2,345.88
    near(primaryInsuranceAmount(10000), Math.floor((1157.4 + 0.32 * (7749 - 1286) + 0.15 * (10000 - 7749)) * 10) / 10);
  });
  it("is continuous across the bend points", () => {
    assert.ok(Math.abs(primaryInsuranceAmount(1287) - primaryInsuranceAmount(1286)) < 1);
    assert.ok(Math.abs(primaryInsuranceAmount(7750) - primaryInsuranceAmount(7749)) < 1);
  });
});

describe("estimateBenefit", () => {
  const base = { annualEarnings: 60000, startAge: 22, retirementAge: 65, claimAge: 67 };
  it("returns null for unusable inputs", () => {
    assert.equal(estimateBenefit({ ...base, annualEarnings: 0 }), null);
    assert.equal(estimateBenefit({ ...base, annualEarnings: NaN }), null);
    assert.equal(estimateBenefit({ ...base, claimAge: 61 }), null);
    assert.equal(estimateBenefit({ ...base, claimAge: 71 }), null);
    assert.equal(estimateBenefit({ ...base, startAge: NaN }), null);
  });
  it("uses a full 35-year record: $60,000 a year gives AIME 5,000", () => {
    const e = estimateBenefit(base);
    assert.equal(e.years, 43);
    assert.equal(e.aime, 5000);
    assert.equal(e.pia, 2345.8);
    assert.equal(e.factor, 1);
    assert.equal(e.monthly, 2345);
    assert.equal(e.annual, 28140);
    assert.ok(e.eligible);
  });
  it("counts zero years when retiring early", () => {
    const e = estimateBenefit({ ...base, retirementAge: 47 }); // 25 years of earnings
    assert.equal(e.years, 25);
    assert.equal(e.aime, Math.floor((60000 * 25) / 35 / 12));
    assert.ok(e.annual < estimateBenefit(base).annual);
  });
  it("applies the claiming adjustment", () => {
    const full = estimateBenefit(base);
    near(estimateBenefit({ ...base, claimAge: 62 }).monthly, Math.floor(full.pia * 0.7));
    near(estimateBenefit({ ...base, claimAge: 70 }).monthly, Math.floor(full.pia * 1.24));
  });
  it("caps earnings at the taxable maximum", () => {
    const high = estimateBenefit({ ...base, annualEarnings: 500000 });
    assert.equal(high.countedEarnings, 184500);
    assert.equal(high.annual, estimateBenefit({ ...base, annualEarnings: 184500 }).annual);
  });
  it("pays nothing with under 10 years of earnings", () => {
    const e = estimateBenefit({ ...base, startAge: 25, retirementAge: 34 });
    assert.equal(e.years, 9);
    assert.equal(e.eligible, false);
    assert.equal(e.annual, 0);
    assert.equal(estimateBenefit({ ...base, startAge: 25, retirementAge: 35 }).eligible, true);
  });
  it("is 0 years when retirement is before starting work", () => {
    assert.equal(estimateBenefit({ ...base, retirementAge: 20 }).years, 0);
  });
});

describe("wageGrowthFactor", () => {
  it("compounds real wage growth until 62", () => {
    near(wageGrowthFactor(30, 0.01), 1.01 ** 32);
    near(wageGrowthFactor(61.5, 0.01), 1.01 ** 0.5);
  });
  it("is 1 at or after 62, or without inputs", () => {
    assert.equal(wageGrowthFactor(62, 0.01), 1);
    assert.equal(wageGrowthFactor(70, 0.01), 1);
    assert.equal(wageGrowthFactor(NaN, 0.01), 1);
    assert.equal(wageGrowthFactor(30, NaN), 1);
  });
  it("defaults to about the Trustees' real-wage differential", () => {
    assert.equal(DEFAULT_REAL_WAGE_GROWTH, 0.01);
  });
});

describe("estimateBenefit: real wage growth and the trust fund", () => {
  const base = { annualEarnings: 60000, startAge: 22, retirementAge: 65, claimAge: 67 };
  it("is unchanged without a current age or growth (today's formula)", () => {
    const e = estimateBenefit(base);
    assert.equal(e.todayPia, e.pia);
    assert.equal(e.wageFactor, 1);
    assert.equal(estimateBenefit({ ...base, currentAge: 30 }).monthly, e.monthly);
  });
  it("grows a 30-year-old's benefit about 37% at 1% real wage growth (regression: held at today's formula)", () => {
    const today = estimateBenefit(base);
    const grown = estimateBenefit({ ...base, currentAge: 30, realWageGrowth: 0.01 });
    assert.equal(grown.todayPia, today.pia);
    assert.equal(grown.pia, Math.floor(today.pia * 1.01 ** 32 * 10) / 10);
    assert.equal(grown.monthly, Math.floor(grown.pia));
    assert.ok(grown.annual / today.annual > 1.36 && grown.annual / today.annual < 1.39);
  });
  it("doesn't grow the benefit of someone already 62", () => {
    assert.equal(estimateBenefit({ ...base, currentAge: 64, claimAge: 67, realWageGrowth: 0.01 }).monthly, estimateBenefit(base).monthly);
  });
  it("applies the payable share for a trust-fund shortfall", () => {
    const e = estimateBenefit({ ...base, payableShare: TRUST_FUND.payableShare });
    assert.equal(e.fullMonthly, 2345);
    assert.equal(e.monthly, Math.floor(2345.8 * 0.77));
    assert.equal(e.annual, e.monthly * 12);
  });
  it("combines wage growth, the claiming adjustment and the cut", () => {
    const e = estimateBenefit({ ...base, claimAge: 62, currentAge: 40, realWageGrowth: 0.01, payableShare: 0.77 });
    assert.equal(e.monthly, Math.floor(e.pia * 0.7 * 0.77));
    assert.equal(e.fullMonthly, Math.floor(e.pia * 0.7));
  });
  it("ignores a payable share outside 0-1", () => {
    assert.equal(estimateBenefit({ ...base, payableShare: 1.5 }).monthly, estimateBenefit(base).monthly);
  });
  it("uses the 2025 Trustees Report's projection", () => {
    assert.deepEqual({ ...TRUST_FUND }, { depletionYear: 2033, payableShare: 0.77 });
  });
});
