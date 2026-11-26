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
  earlyAccessNeed,
  EARLY_ACCESS_AGE,
  bridgeRate,
  DEFAULT_BRIDGE_RETURN,
  suggestedWithdrawalRate,
  SWR_GUIDELINES,
  PLAN_TO_AGE,
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
  it("does not depend on retirement age without a benefit", () => {
    assert.equal(requiredBalance({ ...need, retireAge: 50 }), requiredBalance({ ...need, retireAge: 70 }));
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

describe("bridgeRate", () => {
  it("is the bridge return when it is below the portfolio return", () => {
    assert.equal(bridgeRate(0.07, 0.02), 0.02);
  });
  it("never exceeds the portfolio return", () => {
    assert.equal(bridgeRate(0.04, 0.06), 0.04);
  });
  it("falls back to the portfolio return without a bridge return", () => {
    assert.equal(bridgeRate(0.07, undefined), 0.07);
    assert.equal(bridgeRate(0.07, NaN), 0.07);
  });
  it("defaults to about a TIPS ladder's real yield", () => {
    assert.equal(DEFAULT_BRIDGE_RETURN, 0.02);
  });
});

describe("requiredBalance: bridge return", () => {
  const withBridge = { ...need, taxRate: 0, benefit: 20_000, benefitAge: 67, retireAge: 45 };
  it("prices the bridge years at the bridge return", () => {
    close(requiredBalance({ ...withBridge, bridgeReturn: 0.02 }), 20_000 / 0.04 + 20_000 * annuityFactor(0.02, 22 * 12));
  });
  it("needs more at a safe bridge return than at the portfolio return", () => {
    // Regression: the bridge used to be priced at the full expected return (7%),
    // understating the need by about 13% for retiring at 45 with a benefit at 67.
    const safe = requiredBalance({ ...withBridge, taxRate: 0.1, bridgeReturn: 0.03 });
    const risky = requiredBalance({ ...withBridge, taxRate: 0.1 });
    assert.ok(safe > risky);
    close(risky, 809_151, 1e-6);
    assert.ok(safe / risky > 1.12 && safe / risky < 1.14);
  });
  it("ignores the bridge return when there are no bridge years", () => {
    const started = { ...withBridge, benefitAge: 62, retireAge: 65 };
    assert.equal(requiredBalance({ ...started, bridgeReturn: 0 }), requiredBalance(started));
    assert.equal(requiredBalance({ ...need, bridgeReturn: 0 }), requiredBalance(need));
  });
  it("uses the portfolio return when the bridge return is higher", () => {
    assert.equal(requiredBalance({ ...withBridge, bridgeReturn: 0.1 }), requiredBalance(withBridge));
  });
});

describe("requiredBalance: bridge tax rate", () => {
  const withBridge = { ...need, benefit: 20_000, benefitAge: 67, retireAge: 45, bridgeReturn: 0.02 };
  it("grosses bridge withdrawals up at the bridge rate and later ones at the main rate", () => {
    const r = requiredBalance({ ...withBridge, taxRate: 0.027, bridgeTaxRate: 0.071 });
    const post = 20_000 / (1 - 0.027);
    const pre = 40_000 / (1 - 0.071);
    close(r, post / 0.04 + (pre - post) * annuityFactor(0.02, 22 * 12));
  });
  it("defaults the bridge rate to the main rate", () => {
    assert.equal(requiredBalance({ ...withBridge, bridgeTaxRate: 0.1 }), requiredBalance(withBridge));
  });
  it("ignores the bridge rate when there are no bridge years", () => {
    assert.equal(requiredBalance({ ...need, bridgeTaxRate: 0.5 }), requiredBalance(need));
  });
  it("never lets the bridge lower the need below the post-benefit amount", () => {
    // A tiny benefit taxed more heavily later: the safe-withdrawal draw already covers the bridge.
    const r = requiredBalance({ ...need, benefit: 1_000, benefitAge: 67, retireAge: 60, taxRate: 0.3, bridgeTaxRate: 0 });
    close(r, 39_000 / 0.7 / 0.04);
  });
  it("is NaN for a bad bridge rate when there are bridge years", () => {
    assert.ok(Number.isNaN(requiredBalance({ ...withBridge, bridgeTaxRate: 1 })));
  });
});

describe("spendingFromRequired", () => {
  it("inverts requiredBalance with a bridge return and a separate bridge tax rate", () => {
    for (const [taxRate, bridgeTaxRate] of [[0.03, 0.07], [0.16, 0.13], [0.1, 0.1]]) {
      for (const bridgeReturn of [0, 0.02, 0.05]) {
        for (const retireAge of [40, 55, 66]) {
          for (const spending of [25_000, 60_000, 120_000]) {
            const p = { spending, taxRate, bridgeTaxRate, swr: 0.035, benefit: 20_000, benefitAge: 67, retireAge, annualReturn: 0.07, bridgeReturn };
            const { spending: _, ...rest } = p;
            close(spendingFromRequired({ ...rest, required: requiredBalance(p) }), spending, 1e-7);
          }
        }
      }
    }
  });
  it("is NaN for a bad bridge tax rate", () => {
    assert.ok(Number.isNaN(spendingFromRequired({ ...need, bridgeTaxRate: 1, required: 1 })));
  });
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
  it("is constant across ages without a benefit", () => {
    const f = requiredBalanceFn(need, 65, 1_500_000);
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

describe("suggestedWithdrawalRate", () => {
  it("is 4% for retirements of 30 years or less", () => {
    assert.equal(suggestedWithdrawalRate(PLAN_TO_AGE - 30), 0.04);
    assert.equal(suggestedWithdrawalRate(70), 0.04);
  });
  it("matches each guideline row", () => {
    for (const [years, rate] of SWR_GUIDELINES) assert.equal(suggestedWithdrawalRate(PLAN_TO_AGE - years), rate);
  });
  it("interpolates between rows, to 0.1 point", () => {
    assert.equal(suggestedWithdrawalRate(PLAN_TO_AGE - 35), 0.039); // halfway from 4.0% to 3.7%, rounded
    assert.equal(suggestedWithdrawalRate(PLAN_TO_AGE - 45), 0.036);
  });
  it("holds the last row beyond it", () => {
    assert.equal(suggestedWithdrawalRate(25), SWR_GUIDELINES.at(-1)[1]);
  });
  it("falls as retirement starts earlier", () => {
    for (let age = 30; age < 70; age++) assert.ok(suggestedWithdrawalRate(age) <= suggestedWithdrawalRate(age + 1));
  });
  it("takes a different planning age", () => {
    assert.equal(suggestedWithdrawalRate(60, 100), 0.037);
  });
  it("is NaN for a missing age", () => {
    assert.ok(Number.isNaN(suggestedWithdrawalRate(NaN)));
  });
});

describe("earlyAccessGuidance", () => {
  it("is none at 59.5 and later", () => {
    assert.equal(earlyAccessGuidance(EARLY_ACCESS_AGE), "none");
    assert.equal(earlyAccessGuidance(65), "none");
  });
  it("is rule-of-55 from 55 up to 59.5", () => {
    assert.equal(earlyAccessGuidance(55), "rule-of-55");
    assert.equal(earlyAccessGuidance(59.4), "rule-of-55");
  });
  it("is before-55 below 55", () => {
    assert.equal(earlyAccessGuidance(54.9), "before-55");
    assert.equal(earlyAccessGuidance(40), "before-55");
  });
});

describe("earlyAccessNeed", () => {
  const p = { spending: 40_000, taxRate: 0.1, swr: 0.04, retireAge: 45, annualReturn: 0.068, bridgeReturn: 0.02, age: 30 };
  it("is zero from 59½ on", () => {
    for (const retireAge of [59.5, 62, 70]) {
      const e = earlyAccessNeed({ ...p, retireAge, accessible: 10_000 });
      assert.equal(e.months, 0);
      assert.equal(e.needed, 0);
      assert.equal(e.shortfall, 0);
    }
  });
  it("funds the gross spending until 59½ at the bridge rate", () => {
    const e = earlyAccessNeed(p);
    assert.equal(e.months, 174);
    close(e.needed, (40_000 / 0.9) * annuityFactor(0.02, 174));
  });
  it("uses the bridge tax rate before a benefit and the main rate after it", () => {
    // A pension from 55: full spending at the bridge rate until then, the shortfall afterward.
    const e = earlyAccessNeed({ ...p, benefit: 15_000, benefitAge: 55, bridgeTaxRate: 0.05 });
    const before = annuityFactor(0.02, 120);
    close(e.needed, (40_000 / 0.95) * before + (25_000 / 0.9) * (annuityFactor(0.02, 174) - before));
  });
  it("ignores a Social Security benefit that starts after 59½", () => {
    close(earlyAccessNeed({ ...p, benefit: 20_000, benefitAge: 67, bridgeTaxRate: 0.1 }).needed, earlyAccessNeed(p).needed);
  });
  it("grows the accessible savings at the portfolio return and reports the shortfall", () => {
    const e = earlyAccessNeed({ ...p, accessible: 50_000 });
    close(e.accessibleAtRetirement, 50_000 * 1.068 ** 15);
    close(e.shortfall, e.needed - e.accessibleAtRetirement);
  });
  it("has no shortfall when accessible savings cover the need", () => {
    const e = earlyAccessNeed({ ...p, accessible: 400_000 });
    assert.ok(e.accessibleAtRetirement > e.needed);
    assert.equal(e.shortfall, 0);
  });
  it("defaults the portfolio return when there is no bridge return", () => {
    const { bridgeReturn, ...noBridge } = p;
    close(earlyAccessNeed(noBridge).needed, (40_000 / 0.9) * annuityFactor(0.068, 174));
  });
});
