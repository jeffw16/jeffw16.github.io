import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  grossWithdrawal,
  annuityFactor,
  requiredBalance,
  spendingFromRequired,
  benefitCoversSpending,
  requiredBalanceFn,
  earlyAccessGuidance,
  earlyPenaltyCost,
  penaltyFreeAge,
  EARLY_ACCESS_AGE,
  EARLY_PENALTY_RATE,
} from "../coastfire-calculator/retirement.js";
import { balanceWithContrib } from "../coastfire-calculator/calc.js";

const close = (actual, expected, tol = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tol * Math.max(1, Math.abs(expected)), `${actual} ≉ ${expected}`);

const need = Object.freeze({ spending: 40_000, taxRate: 0.1, swr: 0.04, benefit: 0, benefitAge: 67, retireAge: 65, annualReturn: 0.07 });

describe("grossWithdrawal", () => {
  it("grosses spending up for tax", () => {
    close(grossWithdrawal(40_000, 0.1), 40_000 / 0.9);
    assert.equal(grossWithdrawal(40_000, 0), 40_000);
  });
  it("is NaN for a tax rate outside [0, 1)", () => {
    assert.ok(Number.isNaN(grossWithdrawal(40_000, 1)));
    assert.ok(Number.isNaN(grossWithdrawal(40_000, -0.1)));
    assert.ok(Number.isNaN(grossWithdrawal(40_000, NaN)));
  });
});

describe("annuityFactor", () => {
  it("is 0 for no months", () => {
    assert.equal(annuityFactor(0.07, 0), 0);
    assert.equal(annuityFactor(0.07, -5), 0);
  });
  it("is months/12 at a zero return", () => {
    assert.equal(annuityFactor(0, 24), 2);
  });
  it("funds $1/yr paid monthly: the PV grows into exactly the payments", () => {
    // PV of 24 monthly payments of 1/12, grown at the monthly rate and drawn down, ends at 0.
    const rm = Math.pow(1.07, 1 / 12) - 1;
    const pv = annuityFactor(0.07, 24);
    close(balanceWithContrib(pv, -1 / 12, 0.07, 24), 0, 1e-9);
    assert.ok(pv > 0 && pv < 2 && rm > 0);
  });
  it("is smaller at higher returns", () => {
    assert.ok(annuityFactor(0.08, 120) < annuityFactor(0.04, 120));
  });
});

describe("requiredBalance", () => {
  it("is spending / (1 - tax) / swr without a benefit", () => {
    close(requiredBalance(need), 40_000 / 0.9 / 0.04);
  });
  it("matches spending / swr at zero tax", () => {
    assert.equal(requiredBalance({ ...need, taxRate: 0 }), 1_000_000);
  });
  it("does not depend on retirement age without a benefit or penalty", () => {
    const n = { ...need, earlyAccess: "none" };
    assert.equal(requiredBalance({ ...n, retireAge: 50 }), requiredBalance({ ...n, retireAge: 70 }));
  });
  it("a benefit that has started lowers the need to the shortfall", () => {
    const r = requiredBalance({ ...need, taxRate: 0, benefit: 15_000, benefitAge: 62, retireAge: 65 });
    close(r, 25_000 / 0.04);
  });
  it("a benefit starting at retirement counts as started", () => {
    close(requiredBalance({ ...need, taxRate: 0, benefit: 15_000, benefitAge: 65, retireAge: 65 }), 25_000 / 0.04);
  });
  it("a later benefit adds the bridge years, more the earlier you retire", () => {
    const withBenefit = { ...need, taxRate: 0, benefit: 15_000, benefitAge: 67 };
    const at65 = requiredBalance({ ...withBenefit, retireAge: 65 });
    const at55 = requiredBalance({ ...withBenefit, retireAge: 55 });
    assert.ok(at65 > 25_000 / 0.04);
    assert.ok(at55 > at65);
    close(at65, 25_000 / 0.04 + 15_000 * annuityFactor(0.07, 24));
  });
  it("is 0 when the benefit covers spending and has started", () => {
    assert.equal(requiredBalance({ ...need, benefit: 50_000, benefitAge: 60, retireAge: 65 }), 0);
  });
  it("a benefit larger than spending still needs the full bridge before it starts", () => {
    const r = requiredBalance({ ...need, taxRate: 0, benefit: 50_000, benefitAge: 67, retireAge: 65 });
    close(r, 40_000 * annuityFactor(0.07, 24));
  });
  it("is NaN for a non-positive withdrawal rate or bad tax", () => {
    assert.ok(Number.isNaN(requiredBalance({ ...need, swr: 0 })));
    assert.ok(Number.isNaN(requiredBalance({ ...need, taxRate: 1 })));
  });
  it("does not mutate a frozen input", () => {
    assert.doesNotThrow(() => requiredBalance(Object.freeze({ ...need })));
  });
});

describe("spendingFromRequired", () => {
  it("inverts requiredBalance on a grid", () => {
    for (const taxRate of [0, 0.1, 0.25]) {
      for (const swr of [0.03, 0.04]) {
        for (const [benefit, benefitAge] of [[0, 67], [15_000, 67], [15_000, 62], [30_000, 70]]) {
          for (const retireAge of [50, 55, 65, 70]) {
            for (const spending of [20_000, 40_000, 80_000]) {
              const p = { spending, taxRate, swr, benefit, benefitAge, retireAge, annualReturn: 0.07 };
              const required = requiredBalance(p);
              const back = spendingFromRequired({ required, taxRate, swr, benefit, benefitAge, retireAge, annualReturn: 0.07 });
              // Spending below a fully-covering benefit before it starts is still invertible via the bridge only when needed > 0.
              if (benefit >= spending && benefitAge <= retireAge) continue;
              close(back, spending, 1e-7);
            }
          }
        }
      }
    }
  });
  it("is the plain inverse without a benefit", () => {
    close(spendingFromRequired({ ...need, required: 1_111_111.11 }), 40_000, 1e-6);
  });
  it("is NaN for invalid inputs", () => {
    assert.ok(Number.isNaN(spendingFromRequired({ ...need, required: -1 })));
    assert.ok(Number.isNaN(spendingFromRequired({ ...need, swr: 0, required: 1 })));
    assert.ok(Number.isNaN(spendingFromRequired({ ...need, taxRate: 1, required: 1 })));
  });
});

describe("benefitCoversSpending", () => {
  const p = { spending: 40_000, benefit: 40_000, benefitAge: 65, retireAge: 65 };
  it("is true when the started benefit covers spending", () => {
    assert.equal(benefitCoversSpending(p), true);
    assert.equal(benefitCoversSpending({ ...p, benefit: 60_000, benefitAge: 60 }), true);
  });
  it("is false when the benefit is smaller, absent, or starts after retirement", () => {
    assert.equal(benefitCoversSpending({ ...p, benefit: 39_999 }), false);
    assert.equal(benefitCoversSpending({ ...p, benefit: 0 }), false);
    assert.equal(benefitCoversSpending({ ...p, benefitAge: 66 }), false);
  });
  it("is false with zero spending and zero benefit", () => {
    assert.equal(benefitCoversSpending({ spending: 0, benefit: 0, benefitAge: 60, retireAge: 65 }), false);
  });
});

describe("requiredBalanceFn", () => {
  it("equals the anchor value at the anchor age", () => {
    const f = requiredBalanceFn(need, 65, 1_500_000);
    close(f(65), 1_500_000);
  });
  it("is constant across ages without a benefit or penalty", () => {
    const f = requiredBalanceFn({ ...need, earlyAccess: "none" }, 65, 1_500_000);
    close(f(50), 1_500_000);
    close(f(80), 1_500_000);
  });
  it("keeps the benefit bridge shape at other ages", () => {
    const n = { ...need, taxRate: 0, benefit: 15_000, benefitAge: 67 };
    const f = requiredBalanceFn(n, 65, requiredBalance({ ...n, retireAge: 65 }));
    close(f(55), requiredBalance({ ...n, retireAge: 55 }));
  });
  it("does not scale when the anchor need is 0", () => {
    const n = { ...need, benefit: 50_000, benefitAge: 60 };
    const f = requiredBalanceFn(n, 65, 0);
    assert.equal(f(65), 0);
  });
  it("falls back to scale 1 for a non-finite anchor value", () => {
    close(requiredBalanceFn(need, 65, NaN)(65), requiredBalance(need));
  });
});

describe("penaltyFreeAge", () => {
  it("is 59.5 with the penalty, or the retirement age if later", () => {
    assert.equal(penaltyFreeAge(45, "penalty"), 59.5);
    assert.equal(penaltyFreeAge(62, "penalty"), 62);
  });
  it("is the retirement age under the Rule of 55 from 55, else 59.5", () => {
    assert.equal(penaltyFreeAge(55, "rule55"), 55);
    assert.equal(penaltyFreeAge(57, "rule55"), 57);
    assert.equal(penaltyFreeAge(54.9, "rule55"), 59.5);
  });
  it("uses age 50 for public-safety workers", () => {
    assert.equal(penaltyFreeAge(50, "rule50"), 50);
    assert.equal(penaltyFreeAge(49, "rule50"), 59.5);
  });
  it("is the retirement age when early access is penalty-free", () => {
    assert.equal(penaltyFreeAge(40, "none"), 40);
  });
  it("defaults to paying the penalty", () => {
    assert.equal(penaltyFreeAge(50), 59.5);
  });
});

describe("requiredBalance with the early-withdrawal penalty", () => {
  const n = { ...need, taxRate: 0.2, annualReturn: 0 };
  it("adds the penalty on withdrawals until 59.5", () => {
    // At a 0% return the bridge is just the sum of the extra withdrawals: 9.5 years.
    const extra = 40_000 / (1 - 0.2 - EARLY_PENALTY_RATE) - 40_000 / 0.8;
    close(requiredBalance({ ...n, retireAge: 50 }), 40_000 / 0.8 / 0.04 + extra * 9.5);
    close(earlyPenaltyCost({ ...n, retireAge: 50 }), extra * 9.5);
  });
  it("is unchanged from 59.5 on", () => {
    assert.equal(earlyPenaltyCost({ ...n, retireAge: 59.5 }), 0);
    assert.equal(earlyPenaltyCost({ ...n, retireAge: 65 }), 0);
  });
  it("costs more the earlier you retire", () => {
    assert.ok(earlyPenaltyCost({ ...need, retireAge: 45 }) > earlyPenaltyCost({ ...need, retireAge: 55 }));
  });
  it("the Rule of 55 waives it from 55, not before", () => {
    assert.equal(earlyPenaltyCost({ ...need, retireAge: 55, earlyAccess: "rule55" }), 0);
    close(earlyPenaltyCost({ ...need, retireAge: 54, earlyAccess: "rule55" }), earlyPenaltyCost({ ...need, retireAge: 54 }));
  });
  it("only penalizes the shortfall once a benefit has started", () => {
    const b = { ...n, benefit: 30_000, benefitAge: 50, retireAge: 50 };
    const extra = 10_000 / (1 - 0.2 - EARLY_PENALTY_RATE) - 10_000 / 0.8;
    close(earlyPenaltyCost(b), extra * 9.5);
  });
  it("penalizes full spending before a benefit and the shortfall after it starts", () => {
    const b = { ...n, benefit: 30_000, benefitAge: 55, retireAge: 50 };
    const d = 1 / (1 - 0.2 - EARLY_PENALTY_RATE) - 1 / 0.8;
    close(earlyPenaltyCost(b), d * (40_000 * 5 + 10_000 * 4.5));
  });
  it("is NaN when tax plus penalty leaves nothing", () => {
    assert.ok(Number.isNaN(requiredBalance({ ...need, taxRate: 0.95, retireAge: 50 })));
  });
});

describe("spendingFromRequired with the early-withdrawal penalty", () => {
  for (const extra of [{}, { benefit: 15_000, benefitAge: 67 }, { benefit: 15_000, benefitAge: 52 }, { benefit: 60_000, benefitAge: 62 }]) {
    it(`inverts requiredBalance (${JSON.stringify(extra)})`, () => {
      const n = { ...need, ...extra, retireAge: 50 };
      close(spendingFromRequired({ ...n, required: requiredBalance(n) }), n.spending, 1e-9);
    });
  }
});

describe("earlyAccessGuidance", () => {
  it("is none at 59.5 and later, or with no retirement age", () => {
    assert.equal(earlyAccessGuidance(EARLY_ACCESS_AGE, "penalty"), "none");
    assert.equal(earlyAccessGuidance(65, "rule55"), "none");
    assert.equal(earlyAccessGuidance(Infinity), "none");
  });
  it("is penalty before 59.5 by default", () => {
    assert.equal(earlyAccessGuidance(59.4), "penalty");
    assert.equal(earlyAccessGuidance(40, "penalty"), "penalty");
  });
  it("is rule-of-55 when the rule applies, rule-too-early when retiring before its age", () => {
    assert.equal(earlyAccessGuidance(55, "rule55"), "rule-of-55");
    assert.equal(earlyAccessGuidance(54.9, "rule55"), "rule-too-early");
    assert.equal(earlyAccessGuidance(52, "rule50"), "rule-of-55");
    assert.equal(earlyAccessGuidance(48, "rule50"), "rule-too-early");
  });
  it("is penalty-free when early access is counted as penalty-free", () => {
    assert.equal(earlyAccessGuidance(45, "none"), "penalty-free");
  });
});
