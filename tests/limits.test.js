import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  IRS_LIMITS,
  deferralLimit,
  annualTotals,
  firstAgeOverLimit,
  afterTaxRoom,
  firstAgeOverAdditionsLimit,
} from "../coastfire-calculator/limits.js";

const monthly = (amount, months) => Array.from({ length: months }, () => amount);

describe("IRS_LIMITS", () => {
  it("is frozen and holds the 2026 figures", () => {
    assert.ok(Object.isFrozen(IRS_LIMITS));
    assert.deepEqual({ ...IRS_LIMITS }, { year: 2026, deferral: 24_500, catchUp50: 8_000, catchUp60to63: 11_250, annualAdditions: 72_000 });
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

describe("annualTotals", () => {
  it("sums consecutive 12-month windows", () => {
    assert.deepEqual(annualTotals(monthly(100, 24)), [1_200, 1_200]);
  });
  it("sums a shorter final window as-is", () => {
    assert.deepEqual(annualTotals(monthly(100, 18)), [1_200, 600]);
  });
  it("is empty for an empty schedule", () => {
    assert.deepEqual(annualTotals([]), []);
  });
  it("works on typed arrays", () => {
    assert.deepEqual(annualTotals(Float64Array.from(monthly(1, 12))), [12]);
  });
});

describe("afterTaxRoom", () => {
  it("is the annual-additions limit less basic deferrals and match", () => {
    assert.equal(afterTaxRoom({ employee: 24_500, match: 7_500 }), 40_000);
    assert.equal(afterTaxRoom({ employee: 10_000, match: 0 }), 62_000);
  });
  it("is the full limit with nothing else contributed", () => {
    assert.equal(afterTaxRoom({ employee: 0, match: 0 }), 72_000);
  });
  it("ignores catch-up deferrals above the base limit", () => {
    // 32,500 at 50+ is 24,500 regular + 8,000 catch-up; only the 24,500 counts.
    assert.equal(afterTaxRoom({ employee: 32_500, match: 0 }), 47_500);
    assert.equal(afterTaxRoom({ employee: 35_750, match: 0 }), 47_500);
  });
  it("is never negative", () => {
    assert.equal(afterTaxRoom({ employee: 24_500, match: 60_000 }), 0);
  });
  it("accepts custom limits", () => {
    assert.equal(afterTaxRoom({ employee: 50, match: 10, limits: { deferral: 40, annualAdditions: 100 } }), 50);
  });
});

describe("firstAgeOverAdditionsLimit", () => {
  const employee = monthly(24_500 / 12, 120);
  const match = monthly(500, 120); // 6,000/yr
  it("is null when after-tax money fits in the room", () => {
    // Room: 72,000 - 24,500 - 6,000 = 41,500/yr.
    assert.equal(firstAgeOverAdditionsLimit({ age: 30, employeeSchedule: employee, matchSchedule: match, afterTaxSchedule: monthly(3_000, 120) }), null);
  });
  it("is not flagged exactly at the room", () => {
    assert.equal(firstAgeOverAdditionsLimit({ age: 30, employeeSchedule: employee, matchSchedule: match, afterTaxSchedule: monthly(41_500 / 12, 24) }), null);
  });
  it("flags the first window over the room", () => {
    const hit = firstAgeOverAdditionsLimit({ age: 30, employeeSchedule: employee, matchSchedule: match, afterTaxSchedule: monthly(3_500, 120) });
    assert.deepEqual(hit, { age: 30, afterTax: 42_000, room: 41_500, limit: 72_000 });
  });
  it("finds a later window when raises push contributions over", () => {
    const grow = (amount) => Array.from({ length: 120 }, (_, n) => amount * Math.pow(1.05, Math.floor(n / 12)));
    const hit = firstAgeOverAdditionsLimit({ age: 30.5, employeeSchedule: grow(1_000), matchSchedule: grow(0), afterTaxSchedule: grow(3_000) });
    // Year w: (12,000 + 36,000) * 1.05^w > 72,000 first at w = 9 (1.05^9 = 1.551).
    assert.equal(hit.age, 39);
    assert.ok(hit.afterTax > hit.room);
  });
  it("leaves the catch-up out of the limit from 50", () => {
    const catchUp = monthly(32_500 / 12, 12);
    const room = 72_000 - 24_500;
    const args = { age: 50, employeeSchedule: catchUp, matchSchedule: monthly(0, 12) };
    assert.equal(firstAgeOverAdditionsLimit({ ...args, afterTaxSchedule: monthly(room / 12, 12) }), null);
    assert.equal(firstAgeOverAdditionsLimit({ ...args, afterTaxSchedule: monthly(room / 12 + 1, 12) }).room, room);
  });
  it("reads only the after-tax schedule's length of the other schedules", () => {
    // Year 2 would have no room, but only 12 months of after-tax money are checked.
    const employee2 = [...monthly(1_000, 12), ...monthly(6_000, 12)];
    assert.equal(firstAgeOverAdditionsLimit({ age: 30, employeeSchedule: employee2, matchSchedule: monthly(3_000, 24), afterTaxSchedule: monthly(1_000, 12) }), null);
  });
  it("treats missing employee or match months as zero", () => {
    const hit = firstAgeOverAdditionsLimit({ age: 30, employeeSchedule: [], matchSchedule: [], afterTaxSchedule: monthly(6_001, 12) });
    assert.deepEqual(hit, { age: 30, afterTax: 72_012, room: 72_000, limit: 72_000 });
  });
  it("is null for an empty after-tax schedule", () => {
    assert.equal(firstAgeOverAdditionsLimit({ age: 30, employeeSchedule: employee, matchSchedule: match, afterTaxSchedule: [] }), null);
  });
  it("accepts custom limits", () => {
    const limits = { ...IRS_LIMITS, deferral: 1_000, annualAdditions: 2_000 };
    const hit = firstAgeOverAdditionsLimit({ age: 40, employeeSchedule: monthly(100, 12), matchSchedule: monthly(0, 12), afterTaxSchedule: monthly(100, 12), limits });
    assert.deepEqual(hit, { age: 40, afterTax: 1_200, room: 1_000, limit: 2_000 });
  });
  it("does not mutate frozen schedules", () => {
    const f = (a) => Object.freeze(monthly(a, 24));
    assert.doesNotThrow(() => firstAgeOverAdditionsLimit({ age: 30, employeeSchedule: f(1), matchSchedule: f(1), afterTaxSchedule: f(1) }));
  });
});
