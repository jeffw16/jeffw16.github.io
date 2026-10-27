import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeScenario, sensitivity, afterTaxAmountOf, otherAmountOf, scheduleOptions, rothShareAt } from "../coastfire-calculator/scenario.js";
import { requiredBalance } from "../coastfire-calculator/retirement.js";
import { contributionSchedule, balanceWithContrib } from "../coastfire-calculator/calc.js";

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
  it("caps contributions at the IRS limit and says from when", () => {
    const capped = computeScenario({ ...base, contribution: 3_000 });
    assert.equal(capped.over, null);
    assert.deepEqual(capped.capped, { age: 30, annual: 36_000, limit: 24_500 });
    assert.ok(Math.abs(capped.monthlyContribution - 24_500 / 12) < 1e-9);
    assert.ok(Math.abs(capped.schedule.employee[20 * 12] - 32_500 / 12) < 1e-9); // catch-up from 50
    assert.ok(Math.abs(capped.schedule.employee[30 * 12] - 35_750 / 12) < 1e-9); // super catch-up at 60
    assert.equal(computeScenario({ ...base, contribution: 2_000 }).capped, null);
    assert.ok(capped.fireAge > computeScenario({ ...base, contribution: 3_000, megaBackdoor: true, megaContribution: 0 }).fireAge);
  });
  it("only warns about contributions above the IRS limit with a Mega Backdoor Roth", () => {
    const mega = computeScenario({ ...base, contribution: 3_000, megaBackdoor: true, megaContribution: 0 });
    assert.equal(mega.over.age, 30);
    assert.equal(mega.capped, null);
    assert.equal(mega.monthlyContribution, 3_000);
  });
  it("matches only the capped contribution", () => {
    const m = computeScenario({ ...base, contribution: 3_000, salary: 400_000, matchRate: 1, matchCap: 0.5 });
    assert.ok(Math.abs(m.matchMonthly - 24_500 / 12) < 1e-9);
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
  it("is unreachable within the deferral limit, and says so, when the target needs more", () => {
    const tight = { ...base, mode: "target", balance: 0, targetAge: 35 };
    assert.deepEqual(computeScenario(tight), { unreachable: true, capped: true });
    const mega = computeScenario({ ...tight, megaBackdoor: true, megaContribution: 0 });
    assert.equal(mega.unreachable, false);
    assert.equal(mega.over.age, 30);
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
  it("marks rows with no solution as unreachable", () => {
    const rows = sensitivity({ ...base, mode: "target", contributionUnit: "pct" });
    assert.deepEqual(rows.map((r) => r.unreachable), [true, true, true]);
  });
  it("accepts custom deltas", () => {
    assert.equal(sensitivity(base, [0.02]).length, 1);
  });
});

describe("afterTaxAmountOf", () => {
  it("is the Mega Backdoor Roth contribution when the option is on", () => {
    assert.equal(afterTaxAmountOf({ megaBackdoor: true, megaContribution: 1_500 }), 1_500);
  });
  it("is 0 when the option is off, whatever the amount", () => {
    assert.equal(afterTaxAmountOf({ megaBackdoor: false, megaContribution: 1_500 }), 0);
    assert.equal(afterTaxAmountOf({ megaContribution: 1_500 }), 0);
  });
  it("is 0 for a missing, blank or negative amount", () => {
    assert.equal(afterTaxAmountOf({ megaBackdoor: true }), 0);
    assert.equal(afterTaxAmountOf({ megaBackdoor: true, megaContribution: NaN }), 0);
    assert.equal(afterTaxAmountOf({ megaBackdoor: true, megaContribution: -5 }), 0);
  });
});

describe("scheduleOptions", () => {
  it("collects the schedule inputs, with the after-tax, other-account and employer amounts", () => {
    const i = { ...base, salary: 120_000, raise: 0.02, matchRate: 0.5, matchCap: 0.06, megaBackdoor: true, megaContribution: 800, otherContribution: 300, employerRate: 0.03 };
    assert.deepEqual(scheduleOptions(i), {
      unit: "usd", afterTaxAmount: 800, otherAmount: 300, salary: 120_000, raise: 0.02, matchRate: 0.5, matchCap: 0.06, employerRate: 0.03, employeeCapAt: null,
    });
  });
  it("caps the basic contribution at a twelfth of the deferral limit for each year's age, unless the Mega Backdoor Roth is on", () => {
    const cap = scheduleOptions({ ...base, age: 49 }).employeeCapAt;
    assert.equal(cap(0), 24_500 / 12);
    assert.equal(cap(11), 24_500 / 12);
    assert.equal(cap(12), 32_500 / 12);
    assert.equal(scheduleOptions({ ...base, megaBackdoor: true }).employeeCapAt, null);
  });
  it("has no after-tax, other-account or employer amount by default", () => {
    assert.equal(scheduleOptions(base).afterTaxAmount, 0);
    assert.equal(scheduleOptions(base).otherAmount, 0);
    assert.equal(scheduleOptions(base).employerRate, 0);
  });
});

describe("otherAmountOf", () => {
  it("is the IRA/HSA contribution", () => {
    assert.equal(otherAmountOf({ otherContribution: 250 }), 250);
  });
  it("is 0 for a missing, blank or negative amount", () => {
    assert.equal(otherAmountOf({}), 0);
    assert.equal(otherAmountOf({ otherContribution: NaN }), 0);
    assert.equal(otherAmountOf({ otherContribution: -5 }), 0);
  });
});

describe("rothShareAt", () => {
  const schedule = contributionSchedule({ months: 120, unit: "usd", amount: 1_000, afterTaxAmount: 1_000 });
  it("is the after-tax part of the balance, with growth", () => {
    const share = rothShareAt({ balance: 0, schedule, annualReturn: 0.07, months: 120 });
    assert.ok(Math.abs(share - 0.5) < 1e-12); // equal basic and after-tax money, no starting balance
  });
  it("counts the starting balance as not Roth", () => {
    const share = rothShareAt({ balance: 100_000, schedule, annualReturn: 0.07, months: 120 });
    const roth = balanceWithContrib(0, 1_000, 0.07, 120);
    const all = balanceWithContrib(100_000, 2_000, 0.07, 120);
    assert.ok(Math.abs(share - roth / all) < 1e-9);
  });
  it("is 0 with no after-tax contributions", () => {
    const plain = contributionSchedule({ months: 120, unit: "usd", amount: 1_000 });
    assert.equal(rothShareAt({ balance: 50_000, schedule: plain, annualReturn: 0.07, months: 120 }), 0);
  });
  it("is 0 for no months or no balance at all", () => {
    assert.equal(rothShareAt({ balance: 50_000, schedule, annualReturn: 0.07, months: 0 }), 0);
    assert.equal(rothShareAt({ balance: 50_000, schedule, annualReturn: 0.07, months: -3 }), 0);
    const empty = contributionSchedule({ months: 12, unit: "usd", amount: 0 });
    assert.equal(rothShareAt({ balance: 0, schedule: empty, annualReturn: 0.07, months: 12 }), 0);
  });
  it("is 1 when only after-tax money went in", () => {
    const onlyRoth = contributionSchedule({ months: 12, unit: "usd", amount: 0, afterTaxAmount: 500 });
    assert.equal(rothShareAt({ balance: 0, schedule: onlyRoth, annualReturn: 0.05, months: 12 }), 1);
  });
});

describe("computeScenario (Mega Backdoor Roth)", () => {
  const plain = computeScenario(base);
  const mega = { ...base, megaBackdoor: true, megaContribution: 1_000 };
  const s = computeScenario(mega);
  it("keeps the basic and Mega Backdoor Roth contributions apart", () => {
    assert.equal(s.monthlyContribution, 500);
    assert.equal(s.megaMonthly, 1_000);
    assert.equal(s.matchMonthly, 0);
    assert.equal(s.schedule.employee[0], 500);
    assert.equal(s.schedule.afterTax[0], 1_000);
    assert.equal(s.schedule.total[0], 1_500);
  });
  it("retires and coasts earlier than the basic contribution alone", () => {
    assert.ok(s.fireAge < plain.fireAge);
    assert.ok(s.coastAge < plain.coastAge);
  });
  it("reports the first year's after-tax room", () => {
    assert.equal(s.megaRoom, 72_000 - 6_000);
  });
  it("reports room even when the amount is still 0, and none with the option off", () => {
    assert.equal(computeScenario({ ...mega, megaContribution: 0 }).megaRoom, 66_000);
    assert.equal(plain.megaRoom, null);
  });
  it("leaves the match out of the Mega Backdoor Roth and the room includes it", () => {
    const m = computeScenario({ ...mega, salary: 120_000, matchRate: 1, matchCap: 0.05 });
    assert.equal(m.matchMonthly, 500);
    assert.equal(m.megaMonthly, 1_000);
    assert.equal(m.megaRoom, 72_000 - 6_000 - 6_000);
  });
  it("estimates the Roth share of the balance when you'd retire", () => {
    assert.ok(s.rothShare > 0 && s.rothShare < 1);
    const months = Math.round((s.fireAge - base.age) * 12);
    assert.equal(s.rothShare, rothShareAt({ balance: base.balance, schedule: s.schedule, annualReturn: base.annualReturn, months }));
    assert.equal(plain.rothShare, 0);
    assert.equal(computeScenario({ ...mega, megaContribution: 0 }).rothShare, 0);
  });
  it("uses the retirement age for the Roth share when FIRE isn't reached", () => {
    const slow = { ...mega, contribution: 0, megaContribution: 50, spending: 400_000, fire: 11_111_111 };
    const r = computeScenario(slow);
    assert.equal(r.fireAge, null);
    const months = (base.retirementAge - base.age) * 12;
    assert.equal(r.rothShare, rothShareAt({ balance: base.balance, schedule: r.schedule, annualReturn: base.annualReturn, months }));
  });
  it("is within the limits at a moderate after-tax amount", () => {
    assert.equal(s.overAdditions, null);
    assert.equal(s.over, null);
  });
  it("flags after-tax money above the room left under the annual-additions limit", () => {
    const big = computeScenario({ ...mega, contribution: 2_000, megaContribution: 4_500 });
    assert.deepEqual(big.overAdditions, { age: 30, afterTax: 54_000, room: 48_000, limit: 72_000 });
    assert.equal(big.over, null); // the basic $24,000/yr is within the deferral limit
  });
  it("does not count after-tax money toward the basic deferral limit", () => {
    assert.equal(computeScenario({ ...mega, megaContribution: 3_000 }).over, null);
  });
  it("has no additions check with the option off", () => {
    assert.equal(computeScenario({ ...base, megaContribution: 10_000 }).overAdditions, null);
  });
  it("uses percent of salary for both contributions", () => {
    const p = computeScenario({ ...mega, contributionUnit: "pct", contribution: 10, megaContribution: 20, salary: 120_000 });
    assert.ok(Math.abs(p.monthlyContribution - 1_000) < 1e-9);
    assert.ok(Math.abs(p.megaMonthly - 2_000) < 1e-9);
    assert.ok(Math.abs(p.megaRoom - (72_000 - 12_000)) < 1e-6);
  });
  it("in target mode holds the Mega Backdoor Roth fixed and solves a lower basic contribution", () => {
    const target = computeScenario({ ...mega, mode: "target", megaContribution: 300 });
    const plainTarget = computeScenario({ ...base, mode: "target" });
    assert.ok(Math.abs(target.amount - (plainTarget.amount - 300)) < 0.02);
    assert.equal(target.megaMonthly, 300);
    assert.ok(Math.abs(target.fireAge - 55) < 1 / 12 + 1e-9);
  });
  it("in target mode needs no basic contribution when the Mega Backdoor Roth is enough", () => {
    const target = computeScenario({ ...mega, mode: "target", megaContribution: 2_000 });
    assert.equal(target.amount, 0);
    assert.equal(target.monthlyContribution, 0);
    assert.equal(target.megaRoom, 72_000);
  });
  it("has zero monthly amounts and full room with no months left", () => {
    const end = computeScenario({ ...mega, age: 100, retirementAge: 100, targetAge: 100 });
    assert.deepEqual([end.matchMonthly, end.megaMonthly, end.megaRoom, end.rothShare], [0, 0, 72_000, 0]);
  });
  it("in sensitivity shifts the ages with the Mega Backdoor Roth included", () => {
    const [low, mid, high] = sensitivity(mega);
    assert.equal(mid.fireAge, s.fireAge);
    assert.ok(low.fireAge > mid.fireAge && mid.fireAge > high.fireAge);
  });
});

describe("computeScenario (IRA/HSA and other accounts)", () => {
  const plain = computeScenario(base);
  const withOther = { ...base, otherContribution: 300 };
  const s = computeScenario(withOther);
  it("adds the other-account money on top of the workplace contribution", () => {
    assert.equal(s.monthlyContribution, 500);
    assert.equal(s.otherMonthly, 300);
    assert.equal(s.schedule.other[0], 300);
    assert.equal(s.schedule.total[0], 800);
    assert.ok(s.fireAge < plain.fireAge);
  });
  it("is never matched", () => {
    const matched = { ...base, salary: 120_000, matchRate: 1, matchCap: 0.1 };
    assert.equal(computeScenario({ ...matched, otherContribution: 2_000 }).matchMonthly, computeScenario(matched).matchMonthly);
    assert.equal(computeScenario({ ...matched, contribution: 0, otherContribution: 2_000 }).matchMonthly, 0);
  });
  it("does not count toward the workplace deferral limit", () => {
    assert.equal(computeScenario({ ...base, contribution: 2_000, otherContribution: 1_000 }).capped, null);
    assert.notEqual(computeScenario({ ...base, contribution: 3_000 }).capped, null);
  });
  it("does not use up Mega Backdoor Roth room", () => {
    const mega = { ...base, megaBackdoor: true, megaContribution: 0 };
    assert.equal(computeScenario({ ...mega, otherContribution: 1_000 }).megaRoom, computeScenario(mega).megaRoom);
  });
  it("uses percent of salary like the other contributions", () => {
    const p = computeScenario({ ...base, contributionUnit: "pct", contribution: 5, otherContribution: 2, salary: 120_000 });
    assert.ok(Math.abs(p.otherMonthly - 200) < 1e-9);
  });
  it("in target mode is held fixed and lowers the workplace contribution needed", () => {
    const target = computeScenario({ ...withOther, mode: "target" });
    const plainTarget = computeScenario({ ...base, mode: "target" });
    assert.ok(Math.abs(target.amount - (plainTarget.amount - 300)) < 0.02);
    assert.equal(target.otherMonthly, 300);
  });
});

describe("computeScenario (employer contribution)", () => {
  const employer = { ...base, salary: 120_000, employerRate: 0.05 }; // $500/mo
  it("is paid without any employee contribution", () => {
    const s = computeScenario({ ...employer, contribution: 0 });
    assert.ok(Math.abs(s.employerMonthly - 500) < 1e-9);
    assert.equal(s.matchMonthly, 0);
    assert.ok(Math.abs(s.schedule.total[0] - 500) < 1e-9);
    const same = computeScenario({ ...base, contribution: 500 });
    assert.ok(Math.abs(s.fireAge - same.fireAge) < 1e-9);
  });
  it("adds to the match and your own contribution", () => {
    const s = computeScenario({ ...employer, matchRate: 0.5, matchCap: 0.06 });
    assert.ok(Math.abs(s.schedule.total[0] - (500 + 250 + 500)) < 1e-9);
  });
  it("needs a salary", () => {
    assert.equal(computeScenario({ ...employer, salary: NaN }).employerMonthly, 0);
  });
  it("does not count toward the deferral limit but uses Mega Backdoor Roth room", () => {
    const s = computeScenario({ ...employer, contribution: 2_000, megaBackdoor: true, megaContribution: 0 });
    assert.equal(s.over, null);
    assert.ok(Math.abs(s.megaRoom - (72_000 - 24_000 - 6_000)) < 1e-6);
    const big = computeScenario({ ...employer, contribution: 2_000, megaBackdoor: true, megaContribution: 3_600 });
    assert.ok(Math.abs(big.overAdditions.room - 42_000) < 1e-6);
  });
  it("in target mode lowers the contribution needed, to 0 when it is enough", () => {
    const plainTarget = computeScenario({ ...base, mode: "target" });
    assert.ok(computeScenario({ ...employer, mode: "target" }).amount < plainTarget.amount);
    assert.equal(computeScenario({ ...employer, mode: "target", employerRate: 0.5 }).amount, 0);
  });
});
