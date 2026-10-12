import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BRACKETS, STANDARD_DEDUCTION, FILING_STATUSES, TAX_YEAR,
  federalTax, standardDeduction, taxableSocialSecurity, taxBreakdown, estimateRate,
} from "../coastfire-calculator/tax.js";

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

describe("tax tables", () => {
  it("are for 2025 and cover every filing status with 7 ascending brackets", () => {
    assert.equal(TAX_YEAR, 2025);
    for (const { id } of FILING_STATUSES) {
      const tops = BRACKETS[id].map(([top]) => top);
      assert.equal(tops.length, 7);
      assert.deepEqual([...tops].sort((a, b) => a - b), tops);
      assert.equal(tops.at(-1), Infinity);
      assert.deepEqual(BRACKETS[id].map(([, rate]) => rate), [0.1, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37]);
    }
  });
  it("match the published figures", () => {
    assert.deepEqual(BRACKETS.single[0], [11925, 0.1]);
    assert.deepEqual(BRACKETS.married[1], [96950, 0.12]);
    assert.deepEqual(BRACKETS.head[4], [250500, 0.32]);
    assert.deepEqual({ ...STANDARD_DEDUCTION }, { single: 15750, married: 31500, head: 23625 });
  });
});

describe("federalTax", () => {
  it("is 0 for no or negative taxable income", () => {
    assert.equal(federalTax(0, "single"), 0);
    assert.equal(federalTax(-5, "single"), 0);
    assert.equal(federalTax(NaN, "single"), 0);
  });
  it("taxes each bracket's slice at its rate", () => {
    near(federalTax(11925, "single"), 1192.5);
    near(federalTax(48475, "single"), 1192.5 + 0.12 * 36550);
    near(federalTax(60000, "single"), 1192.5 + 0.12 * 36550 + 0.22 * 11525);
    near(federalTax(23850, "married"), 2385);
    near(federalTax(17000, "head"), 1700);
  });
  it("reaches the top bracket", () => {
    const top = 626350;
    near(federalTax(top, "single") - federalTax(top - 1000, "single"), 350);
    near(federalTax(top + 1000, "single") - federalTax(top, "single"), 370);
    near(federalTax(top + 100_000, "single") - federalTax(top + 99_000, "single"), 370);
  });
  it("falls back to single for an unknown status", () => {
    assert.equal(federalTax(50000, "nonsense"), federalTax(50000, "single"));
  });
});

describe("standardDeduction", () => {
  it("is the Table 10-1 amount", () => {
    assert.equal(standardDeduction("single"), 15750);
    assert.equal(standardDeduction("married"), 31500);
    assert.equal(standardDeduction("head"), 23625);
  });
  it("adds the Table 10-2 extra for 65+", () => {
    assert.equal(standardDeduction("single", true), 17750);
    assert.equal(standardDeduction("married", true), 34700); // both spouses
    assert.equal(standardDeduction("head", true), 25625);
  });
});

describe("taxableSocialSecurity", () => {
  it("is 0 with no benefit or low provisional income", () => {
    assert.equal(taxableSocialSecurity({ benefit: 0, otherIncome: 100000, status: "single" }), 0);
    assert.equal(taxableSocialSecurity({ benefit: 24000, otherIncome: 0, status: "single" }), 0);
  });
  it("taxes up to half between the thresholds", () => {
    // provisional = 20,000 + 10,000 = 30,000; half of the 5,000 over 25,000
    near(taxableSocialSecurity({ benefit: 20000, otherIncome: 20000, status: "single" }), 2500);
    // joint: provisional = 20,000 + 15,000 = 35,000; half of the 3,000 over 32,000
    near(taxableSocialSecurity({ benefit: 30000, otherIncome: 20000, status: "married" }), 1500);
  });
  it("taxes 85% of income above the second threshold plus the first tier", () => {
    // provisional = 40,000 + 15,000 = 55,000: 0.85 * 21,000 + 0.5 * 9,000
    near(taxableSocialSecurity({ benefit: 30000, otherIncome: 40000, status: "single" }), 17850 + 4500);
  });
  it("never exceeds 85% of the benefit", () => {
    near(taxableSocialSecurity({ benefit: 10000, otherIncome: 100000, status: "single" }), 8500);
  });
});

describe("taxBreakdown", () => {
  it("applies the deduction, brackets and flat state tax", () => {
    const b = taxBreakdown({ withdrawal: 60000, status: "single", stateRate: 0.05 });
    near(b.deduction, 15750);
    near(b.taxableIncome, 44250);
    near(b.federal, 1192.5 + 0.12 * (44250 - 11925));
    near(b.state, 3000);
    near(b.total, b.federal + b.state);
  });
  it("leaves the tax-free share out of income and state tax", () => {
    const b = taxBreakdown({ withdrawal: 60000, status: "single", stateRate: 0.05, taxFreeShare: 0.5 });
    near(b.taxableWithdrawal, 30000);
    near(b.state, 1500);
    near(b.taxableIncome, 14250);
  });
  it("adds taxable Social Security to income", () => {
    const b = taxBreakdown({ withdrawal: 40000, benefit: 30000, status: "single" });
    near(b.taxableBenefit, 17850 + 4500);
    near(b.income, 40000 + 22350);
  });
  it("is zero tax when everything is under the deduction", () => {
    assert.equal(taxBreakdown({ withdrawal: 10000 }).total, 0);
  });
});

describe("estimateRate", () => {
  const net = (e) => e.withdrawal + e.breakdown.benefit - e.breakdown.total;
  it("recovers a known withdrawal exactly", () => {
    const e = estimateRate({ spending: 54928.5, status: "single" }); // 60,000 less 5,071.50 of tax
    near(e.withdrawal, 60000, 1e-4);
    near(e.rate, 5071.5 / 60000, 1e-8);
  });
  it("nets exactly the target spending", () => {
    for (const status of ["single", "married", "head"]) {
      for (const spending of [25000, 40000, 100000, 250000]) {
        const e = estimateRate({ spending, benefit: 12000, status, stateRate: 0.04, taxFreeShare: 0.2 });
        near(net(e), spending, 1e-3);
        assert.ok(e.rate >= 0 && e.rate < 0.6);
      }
    }
  });
  it("is low at $40k and higher at $100k for a single filer", () => {
    const low = estimateRate({ spending: 40000 }).rate;
    const high = estimateRate({ spending: 100000 }).rate;
    assert.ok(low > 0.05 && low < 0.09, `${low}`);
    assert.ok(high > 0.12 && high < 0.17, `${high}`);
  });
  it("is lower for a married couple than a single filer", () => {
    assert.ok(estimateRate({ spending: 100000, status: "married" }).rate < estimateRate({ spending: 100000, status: "single" }).rate);
  });
  it("rises with state tax and falls with a tax-free share", () => {
    const base = estimateRate({ spending: 80000 }).rate;
    assert.ok(estimateRate({ spending: 80000, stateRate: 0.05 }).rate > base);
    assert.ok(estimateRate({ spending: 80000, taxFreeShare: 0.5 }).rate < base);
    assert.equal(estimateRate({ spending: 40000, taxFreeShare: 1 }).rate, 0);
  });
  it("is lower with the 65+ deduction", () => {
    assert.ok(estimateRate({ spending: 60000, over65: true }).rate < estimateRate({ spending: 60000 }).rate);
  });
  it("is 0 when the benefit covers spending", () => {
    assert.deepEqual(
      (({ rate, withdrawal }) => ({ rate, withdrawal }))(estimateRate({ spending: 30000, benefit: 30000 })),
      { rate: 0, withdrawal: 0 },
    );
    assert.equal(estimateRate({ spending: 20000, benefit: 30000 }).rate, 0);
  });
  it("is 0 below the standard deduction", () => {
    assert.equal(estimateRate({ spending: 12000 }).rate, 0);
  });
});
