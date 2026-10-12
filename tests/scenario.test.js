import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeScenario, sensitivity } from "../coastfire-calculator/scenario.js";
import { requiredBalance } from "../coastfire-calculator/retirement.js";

const need = { spending: 40_000, taxRate: 0.1, swr: 0.04, benefit: 0, benefitAge: 67, annualReturn: 0.07 };
const fire = Math.round(requiredBalance({ ...need, retireAge: 65 })); // 1,111,111

const base = Object.freeze({
  mode: "contribution", age: 30, balance: 50_000, retirementAge: 65, targetAge: 55,
  contribution: 500, contributionUnit: "usd", salary: NaN, raise: 0, matchRate: 0, matchCap: 0,
  ...need, fire,
});

describe("computeScenario (contribution mode)", () => {
  const s = computeScenario(base);
  it("matches the pinned default results", () => {
    assert.equal(s.unreachable, false);
    assert.equal(Math.round(s.coastNow), 104_070);
    assert.equal(s.alreadyCoast, false);
    assert.ok(Math.abs(s.coastAge - (30 + 168 / 12)) < 1e-9);
    assert.ok(Math.abs(s.fireAge - (30 + 383 / 12)) < 1e-9);
    assert.equal(s.coastMonth, 168);
  });
  it("uses the entered contribution and no match by default", () => {
    assert.equal(s.amount, 500);
    assert.equal(s.monthlyContribution, 500);
    assert.equal(s.matchMonthly, 0);
    assert.equal(s.over, null);
  });
  it("reports already-coast with the current age and month 0", () => {
    const rich = computeScenario({ ...base, balance: 500_000 });
    assert.equal(rich.alreadyCoast, true);
    assert.equal(rich.coastAge, 30);
    assert.equal(rich.coastMonth, 0);
  });
  it("has a null coast age and month when coasting is out of reach", () => {
    const poor = computeScenario({ ...base, balance: 0, contribution: 0 });
    assert.equal(poor.coastAge, null);
    assert.equal(poor.coastMonth, null);
    assert.equal(poor.fireAge, null);
  });
  it("flags contributions above the IRS limit", () => {
    assert.equal(computeScenario({ ...base, contribution: 3_000 }).over.age, 30);
  });
  it("adds the employer match", () => {
    const m = computeScenario({ ...base, salary: 120_000, matchRate: 1, matchCap: 0.05 });
    assert.equal(m.matchMonthly, 500);
    assert.ok(m.fireAge < s.fireAge);
  });
  it("does not mutate a frozen input", () => {
    assert.doesNotThrow(() => computeScenario(Object.freeze({ ...base })));
  });
});

describe("computeScenario (target mode)", () => {
  const s = computeScenario({ ...base, mode: "target" });
  it("solves the contribution to retire at the target age", () => {
    assert.ok(Math.abs(s.amount - 1_072.41) < 0.01);
    assert.ok(Math.abs(s.fireAge - 55) < 1 / 12 + 1e-9);
  });
  it("falls back to the target age when the FIRE age can't be found", () => {
    const tiny = computeScenario({ ...base, mode: "target", balance: 1_000_000 });
    assert.equal(tiny.amount, 0);
  });
  it("is unreachable when a percent contribution is requested without a salary", () => {
    assert.equal(computeScenario({ ...base, mode: "target", contributionUnit: "pct" }).unreachable, true);
  });
});

describe("sensitivity", () => {
  it("returns a row per delta with the shifted rate", () => {
    const rows = sensitivity(base);
    assert.deepEqual(rows.map((r) => r.delta), [-0.01, 0, 0.01]);
    assert.deepEqual(rows.map((r) => Math.round(r.rate * 100)), [6, 7, 8]);
  });
  it("the middle row equals the scenario itself", () => {
    const s = computeScenario(base);
    const mid = sensitivity(base)[1];
    assert.equal(mid.coastAge, s.coastAge);
    assert.equal(mid.fireAge, s.fireAge);
  });
  it("ages get earlier as returns rise", () => {
    const [low, mid, high] = sensitivity(base);
    const age = (a) => a ?? Infinity; // null: not reached in time
    assert.equal(low.coastAge, null); // at 6% you don't coast before 65
    assert.ok(age(low.coastAge) > age(mid.coastAge) && age(mid.coastAge) > age(high.coastAge));
    assert.ok(low.fireAge > mid.fireAge && mid.fireAge > high.fireAge);
  });
  it("in target mode the needed contribution falls as returns rise", () => {
    const [low, mid, high] = sensitivity({ ...base, mode: "target" });
    assert.ok(low.amount > mid.amount && mid.amount > high.amount);
  });
  it("accepts custom deltas", () => {
    assert.equal(sensitivity(base, [0.02]).length, 1);
  });
});
