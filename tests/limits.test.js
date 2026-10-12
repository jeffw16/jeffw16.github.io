import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { IRS_LIMITS, deferralLimit, firstAgeOverLimit } from "../coastfire-calculator/limits.js";

const monthly = (amount, months) => Array.from({ length: months }, () => amount);

describe("IRS_LIMITS", () => {
  it("is frozen and holds the 2026 figures", () => {
    assert.ok(Object.isFrozen(IRS_LIMITS));
    assert.deepEqual({ ...IRS_LIMITS }, { year: 2026, deferral: 24_500, catchUp50: 8_000, catchUp60to63: 11_250 });
  });
});

describe("deferralLimit", () => {
  it("is the base limit below 50", () => {
    assert.equal(deferralLimit(30), 24_500);
    assert.equal(deferralLimit(49), 24_500);
    assert.equal(deferralLimit(49.9), 24_500);
  });
  it("adds the catch-up from 50 to 59", () => {
    assert.equal(deferralLimit(50), 32_500);
    assert.equal(deferralLimit(59), 32_500);
  });
  it("uses the super catch-up (replacing, not stacking) from 60 to 63", () => {
    assert.equal(deferralLimit(60), 35_750);
    assert.equal(deferralLimit(63), 35_750);
    assert.equal(deferralLimit(63.9), 35_750);
  });
  it("returns to the standard catch-up from 64", () => {
    assert.equal(deferralLimit(64), 32_500);
    assert.equal(deferralLimit(80), 32_500);
  });
  it("accepts custom limits", () => {
    assert.equal(deferralLimit(30, { deferral: 10, catchUp50: 1, catchUp60to63: 2 }), 10);
  });
});

describe("firstAgeOverLimit", () => {
  it("is null when contributions stay within the limit", () => {
    assert.equal(firstAgeOverLimit({ age: 30, employeeSchedule: monthly(2_000, 120) }), null); // 24,000/yr
  });
  it("is null for an empty schedule", () => {
    assert.equal(firstAgeOverLimit({ age: 30, employeeSchedule: [] }), null);
  });
  it("flags the first window over the base limit", () => {
    const result = firstAgeOverLimit({ age: 30, employeeSchedule: monthly(2_100, 24) }); // 25,200/yr
    assert.deepEqual(result, { age: 30, annual: 25_200, limit: 24_500 });
  });
  it("is not flagged exactly at the limit", () => {
    assert.equal(firstAgeOverLimit({ age: 30, employeeSchedule: monthly(24_500 / 12, 12) }), null);
  });
  it("raises the limit at 50: 2,600/mo is fine at 50 but not at 49", () => {
    const schedule = monthly(2_600, 24); // 31,200/yr
    assert.equal(firstAgeOverLimit({ age: 50, employeeSchedule: schedule }), null);
    assert.equal(firstAgeOverLimit({ age: 49, employeeSchedule: schedule }).age, 49);
  });
  it("applies the 60-63 limit and drops back at 64", () => {
    const schedule = monthly(2_900, 12 * 6); // 34,800/yr: over 32,500 but under 35,750
    assert.deepEqual(firstAgeOverLimit({ age: 60, employeeSchedule: schedule }), { age: 64, annual: 34_800, limit: 32_500 });
    assert.equal(firstAgeOverLimit({ age: 59, employeeSchedule: schedule }).age, 59);
  });
  it("finds a later window when raises push contributions over", () => {
    const schedule = Array.from({ length: 120 }, (_, n) => 1_900 * Math.pow(1.05, Math.floor(n / 12)));
    const hit = firstAgeOverLimit({ age: 30, employeeSchedule: schedule });
    assert.ok(hit.age > 30);
    assert.ok(hit.annual > hit.limit);
  });
  it("does not mutate a frozen schedule", () => {
    assert.doesNotThrow(() => firstAgeOverLimit({ age: 30, employeeSchedule: Object.freeze(monthly(100, 24)) }));
  });
});
