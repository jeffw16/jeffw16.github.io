import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mulberry32,
  normalPair,
  lognormalMonthlyReturns,
  monthlyReturnPaths,
  balancePaths,
  percentile,
  percentilesByYear,
  successRate,
  fireAgeDistribution,
  coastSuccessRate,
  coastConfidenceAge,
  contributionForConfidence,
} from "../coastfire-calculator/montecarlo.js";
import { constantSchedule, simulate, monthlyRate, findCoastAge, solveEmployeeAmount } from "../coastfire-calculator/calc.js";

const close = (actual, expected, tol = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tol * Math.max(1, Math.abs(expected)), `${actual} ≉ ${expected}`);

describe("mulberry32", () => {
  it("gives the same sequence for the same seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let k = 0; k < 20; k++) assert.equal(a(), b());
  });
  it("gives different sequences for different seeds", () => {
    assert.notEqual(mulberry32(1)(), mulberry32(2)());
  });
  it("stays in [0, 1) and averages about 0.5", () => {
    const rand = mulberry32(7);
    let sum = 0;
    for (let k = 0; k < 20_000; k++) {
      const v = rand();
      assert.ok(v >= 0 && v < 1);
      sum += v;
    }
    assert.ok(Math.abs(sum / 20_000 - 0.5) < 0.01);
  });
});

describe("normalPair", () => {
  it("has mean about 0 and variance about 1", () => {
    const rand = mulberry32(3);
    const xs = [];
    for (let k = 0; k < 10_000; k++) xs.push(...normalPair(rand));
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
    assert.ok(Math.abs(mean) < 0.03);
    assert.ok(Math.abs(variance - 1) < 0.05);
  });
  it("skips a zero uniform instead of returning infinity", () => {
    const seq = [0, 0.5, 0.25];
    const [a, b] = normalPair(() => seq.shift());
    assert.ok(Number.isFinite(a) && Number.isFinite(b));
  });
});

describe("lognormalMonthlyReturns", () => {
  it("returns one value per month, including an odd count", () => {
    const rand = mulberry32(1);
    assert.equal(lognormalMonthlyReturns({ annualReturn: 0.07, volatility: 0.1, months: 7, rand }).length, 7);
    assert.equal(lognormalMonthlyReturns({ annualReturn: 0.07, volatility: 0.1, months: 0, rand }).length, 0);
  });
  it("is exactly the deterministic monthly rate at zero volatility", () => {
    const out = lognormalMonthlyReturns({ annualReturn: 0.07, volatility: 0, months: 24, rand: mulberry32(1) });
    for (const r of out) close(r, monthlyRate(0.07));
  });
  it("has a median 30-year growth within 3% of the stated rate", () => {
    const paths = monthlyReturnPaths({ paths: 5000, seed: 11, months: 360, annualReturn: 0.07, volatility: 0.17 });
    const finals = paths.map((r) => r.reduce((acc, x) => acc * (1 + x), 1)).sort((a, b) => a - b);
    const median = finals[finals.length >> 1];
    assert.ok(Math.abs(median / Math.pow(1.07, 30) - 1) < 0.03, `${median} vs ${Math.pow(1.07, 30)}`);
  });
  it("has the requested annual volatility", () => {
    const rand = mulberry32(5);
    const logs = [];
    for (let k = 0; k < 4000; k++) {
      const year = lognormalMonthlyReturns({ annualReturn: 0.07, volatility: 0.17, months: 12, rand });
      logs.push(Math.log(year.reduce((acc, x) => acc * (1 + x), 1)));
    }
    const mean = logs.reduce((a, b) => a + b, 0) / logs.length;
    const sd = Math.sqrt(logs.reduce((a, b) => a + (b - mean) ** 2, 0) / logs.length);
    assert.ok(Math.abs(sd - 0.17) < 0.01, `sd ${sd}`);
  });
});

describe("monthlyReturnPaths", () => {
  const args = { paths: 50, seed: 9, months: 36, annualReturn: 0.07, volatility: 0.15 };
  it("returns the requested number of paths of the requested length", () => {
    const paths = monthlyReturnPaths(args);
    assert.equal(paths.length, 50);
    assert.ok(paths.every((p) => p.length === 36));
  });
  it("is reproducible from the seed and differs across seeds", () => {
    assert.deepEqual(monthlyReturnPaths(args).map((p) => [...p]), monthlyReturnPaths(args).map((p) => [...p]));
    assert.notDeepEqual([...monthlyReturnPaths(args)[0]], [...monthlyReturnPaths({ ...args, seed: 10 })[0]]);
  });
  it("gives paths that differ from one another", () => {
    const [a, b] = monthlyReturnPaths(args);
    assert.notDeepEqual([...a], [...b]);
  });
  it("defaults to 1000 paths", () => {
    assert.equal(monthlyReturnPaths({ months: 2, annualReturn: 0.05, volatility: 0.1 }).length, 1000);
  });
});

describe("balancePaths", () => {
  const flat = monthlyReturnPaths({ paths: 5, months: 120, annualReturn: 0.07, volatility: 0 });
  it("equals the deterministic simulation at zero volatility", () => {
    const contributions = constantSchedule(500, 120);
    const expected = simulate({ balance: 50_000, contributions, monthlyReturns: monthlyRate(0.07) });
    for (const path of balancePaths({ returnPaths: flat, balance: 50_000, contributions })) {
      assert.equal(path.length, 121);
      close(path[120], expected[120], 1e-12);
    }
  });
  it("uses only as many contribution months as the return path has", () => {
    const [path] = balancePaths({ returnPaths: flat, balance: 0, contributions: constantSchedule(1, 500) });
    assert.equal(path.length, 121);
  });
  it("does not mutate its inputs", () => {
    const contributions = Object.freeze(Array.from({ length: 120 }, () => 10));
    assert.doesNotThrow(() => balancePaths({ returnPaths: flat, balance: 1, contributions }));
  });
});

describe("percentile", () => {
  it("interpolates between neighbours", () => {
    assert.equal(percentile([10, 20, 30, 40], 0), 10);
    assert.equal(percentile([10, 20, 30, 40], 1), 40);
    assert.equal(percentile([10, 20, 30, 40], 0.5), 25);
    assert.equal(percentile([10, 20, 30], 0.5), 20);
  });
  it("clamps p and handles one value or none", () => {
    assert.equal(percentile([5], 0.9), 5);
    assert.equal(percentile([1, 2], -1), 1);
    assert.equal(percentile([1, 2], 2), 2);
    assert.ok(Number.isNaN(percentile([], 0.5)));
  });
});

describe("percentilesByYear", () => {
  const returns = monthlyReturnPaths({ paths: 200, seed: 4, months: 240, annualReturn: 0.07, volatility: 0.17 });
  const paths = balancePaths({ returnPaths: returns, balance: 50_000, contributions: constantSchedule(500, 240) });
  const [p10, p50, p90] = percentilesByYear(paths, [0.1, 0.5, 0.9]);
  it("has one value per year including year 0", () => {
    assert.equal(p50.length, 21);
  });
  it("starts every percentile at the starting balance", () => {
    assert.deepEqual([p10[0], p50[0], p90[0]], [50_000, 50_000, 50_000]);
  });
  it("orders the percentiles", () => {
    for (let t = 1; t <= 20; t++) assert.ok(p10[t] <= p50[t] && p50[t] <= p90[t]);
    assert.ok(p90[20] > p10[20]);
  });
  it("accepts a shorter year count", () => {
    assert.equal(percentilesByYear(paths, [0.5], 5)[0].length, 6);
  });
});

describe("successRate", () => {
  const paths = [[0, 10], [0, 20], [0, 30], [0, 40]];
  it("is the share of paths at or above the target", () => {
    assert.equal(successRate(paths, 1, 25), 0.5);
    assert.equal(successRate(paths, 1, 10), 1);
    assert.equal(successRate(paths, 1, 41), 0);
  });
  it("clamps a month beyond the path and handles no paths", () => {
    assert.equal(successRate(paths, 99, 30), 0.5);
    assert.equal(successRate([], 1, 1), 0);
  });
  it("only falls as the target rises", () => {
    let last = 1;
    for (let t = 0; t <= 50; t += 5) {
      const rate = successRate(paths, 1, t);
      assert.ok(rate <= last);
      last = rate;
    }
  });
});

describe("fireAgeDistribution", () => {
  it("reports where in the paths the target is first reached", () => {
    const paths = [[0, 5, 10, 10], [0, 0, 0, 10], [0, 0, 0, 0], [0, 10, 10, 10]];
    const d = fireAgeDistribution(paths, () => 10, 30);
    assert.equal(d.p10, 30 + 1 / 12);
    assert.equal(d.p50, 30 + 3 / 12);
    assert.equal(d.p90, null); // one path never gets there... p90 falls on it
  });
  it("is a single age when every path is identical", () => {
    const flat = monthlyReturnPaths({ paths: 20, months: 120, annualReturn: 0.07, volatility: 0 });
    const paths = balancePaths({ returnPaths: flat, balance: 0, contributions: constantSchedule(1000, 120) });
    const d = fireAgeDistribution(paths, () => 50_000, 30);
    assert.equal(d.p10, d.p50);
    assert.equal(d.p50, d.p90);
    assert.ok(d.p50 > 30 && d.p50 < 40);
  });
  it("uses a per-age requirement", () => {
    const paths = [[0, 5, 10, 15]];
    assert.equal(fireAgeDistribution(paths, (a) => (a >= 30 + 2 / 12 ? 100 : 5), 30).p50, 30 + 1 / 12);
  });
});

describe("coast confidence", () => {
  const args = { balance: 50_000, contributions: constantSchedule(500, 420), age: 30, retirementAge: 65, fire: 1_111_111 };
  const flat = monthlyReturnPaths({ paths: 50, months: 420, annualReturn: 0.07, volatility: 0 });
  const noisy = monthlyReturnPaths({ paths: 1000, seed: 1, months: 420, annualReturn: 0.07, volatility: 0.17 });

  it("coastSuccessRate is all-or-nothing without volatility", () => {
    assert.equal(coastSuccessRate({ ...args, returnPaths: flat, stopMonth: 168 }), 1);
    assert.equal(coastSuccessRate({ ...args, returnPaths: flat, stopMonth: 167 }), 0);
  });
  it("coastSuccessRate rises with more months of contributions", () => {
    let last = 0;
    for (const stopMonth of [0, 60, 120, 180, 240, 420]) {
      const rate = coastSuccessRate({ ...args, returnPaths: noisy, stopMonth });
      assert.ok(rate >= last);
      last = rate;
    }
  });
  it("coastConfidenceAge equals the deterministic coast age without volatility", () => {
    const det = findCoastAge({ age: 30, balance: 50_000, monthlyContribution: 500, annualReturn: 0.07, fire: 1_111_111, retirementAge: 65 });
    close(coastConfidenceAge({ ...args, returnPaths: flat }), det, 1e-9);
  });
  it("needs more contributing with 90% confidence than the deterministic path (or can't be done)", () => {
    const age = coastConfidenceAge({ ...args, returnPaths: noisy });
    const det = findCoastAge({ age: 30, balance: 50_000, monthlyContribution: 500, annualReturn: 0.07, fire: 1_111_111, retirementAge: 65 });
    assert.ok(age === null || age >= det);
  });
  it("is the current age when you've already coasted with confidence", () => {
    assert.equal(coastConfidenceAge({ ...args, balance: 5_000_000, returnPaths: noisy }), 30);
  });
  it("is null when even contributing until retirement isn't enough", () => {
    assert.equal(coastConfidenceAge({ ...args, balance: 0, contributions: constantSchedule(10, 420), returnPaths: noisy }), null);
  });
  it("a lower confidence bar allows coasting no later", () => {
    const a90 = coastConfidenceAge({ ...args, returnPaths: noisy, confidence: 0.9 });
    const a50 = coastConfidenceAge({ ...args, returnPaths: noisy, confidence: 0.5 });
    assert.ok(a50 <= (a90 ?? Infinity));
  });
});

describe("contributionForConfidence", () => {
  const months = 300;
  const flat = monthlyReturnPaths({ paths: 30, months, annualReturn: 0.07, volatility: 0 });
  const noisy = monthlyReturnPaths({ paths: 1000, seed: 1, months, annualReturn: 0.07, volatility: 0.17 });
  const base = { balance: 50_000, months, target: 1_111_111, scheduleFor: (a) => constantSchedule(a, months) };

  it("matches the deterministic solver without volatility", () => {
    const solved = solveEmployeeAmount({ balance: 50_000, annualReturn: 0.07, months, target: 1_111_111, unit: "usd" });
    close(contributionForConfidence({ ...base, returnPaths: flat }), solved, 1e-4);
  });
  it("asks for more at higher confidence", () => {
    const c50 = contributionForConfidence({ ...base, returnPaths: noisy, confidence: 0.5 });
    const c90 = contributionForConfidence({ ...base, returnPaths: noisy, confidence: 0.9 });
    assert.ok(c90 > c50);
  });
  it("is stable across calls", () => {
    assert.equal(contributionForConfidence({ ...base, returnPaths: noisy }), contributionForConfidence({ ...base, returnPaths: noisy }));
  });
  it("success rate does not fall as the contribution rises", () => {
    const rates = [0, 500, 1000, 2000, 4000].map((amount) =>
      successRate(balancePaths({ returnPaths: noisy, balance: 50_000, contributions: constantSchedule(amount, months) }), months, 1_111_111));
    for (let k = 1; k < rates.length; k++) assert.ok(rates[k] >= rates[k - 1]);
  });
  it("is 0 when the balance already reaches the target in enough paths", () => {
    assert.equal(contributionForConfidence({ ...base, balance: 50_000_000, returnPaths: noisy }), 0);
  });
});
