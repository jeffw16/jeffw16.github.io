import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  HISTORY, STOCK_SHARE, realReturn, realSeries, geometricMean, shiftToRate, seriesFor, historicalPaths,
} from "../coastfire-calculator/history.js";
import { PORTFOLIOS, monthlyRate } from "../coastfire-calculator/calc.js";

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
const byYear = (year) => HISTORY.find((row) => row.year === year);

describe("HISTORY data", () => {
  it("covers 1928 through 2025 with no gaps", () => {
    assert.equal(HISTORY.length, 98);
    HISTORY.forEach((row, k) => assert.equal(row.year, 1928 + k));
  });
  it("holds fractions, not percents, and is frozen", () => {
    assert.ok(Object.isFrozen(HISTORY));
    for (const row of HISTORY) {
      assert.ok(row.stocks > -0.6 && row.stocks < 0.7, `${row.year} stocks`);
      assert.ok(row.bonds > -0.25 && row.bonds < 0.35, `${row.year} bonds`);
      assert.ok(row.cpi > -0.15 && row.cpi < 0.2, `${row.year} cpi`);
    }
  });
  it("matches published figures for spot-checked years", () => {
    // Damodaran/NYU: S&P 500 incl. dividends and 10-year T-bond; CPI-U December-to-December.
    assert.deepEqual(byYear(1931), { year: 1931, stocks: -0.4384, bonds: -0.0256, cpi: -0.0932 });
    assert.deepEqual(byYear(1974), { year: 1974, stocks: -0.259, bonds: 0.0199, cpi: 0.1234 });
    assert.deepEqual(byYear(2022), { year: 2022, stocks: -0.1804, bonds: -0.1783, cpi: 0.0645 });
    assert.equal(byYear(2025).stocks, 0.1778);
    assert.equal(byYear(1946).cpi, 0.1813);
  });
  it("compounds stocks to the published $100-in-1928 values within rounding", () => {
    const grown = HISTORY.reduce((value, row) => value * (1 + row.stocks), 100);
    assert.ok(Math.abs(grown / 1_157_598.95 - 1) < 0.01, `${grown}`);
  });
});

describe("STOCK_SHARE", () => {
  it("has a share between 0 and 1 for every preset portfolio", () => {
    for (const p of PORTFOLIOS) assert.ok(STOCK_SHARE[p.id] >= 0 && STOCK_SHARE[p.id] <= 1, p.id);
  });
});

describe("realReturn", () => {
  it("removes inflation exactly", () => {
    near(realReturn(0.1, 0.1), 0);
    near(realReturn(0.0812, 0.02), 0.06);
    near(realReturn(-0.4384, -0.0932), 0.5616 / 0.9068 - 1);
  });
  it("turns a gain into a loss when inflation is higher", () => {
    assert.ok(realReturn(0.05, 0.1) < 0);
  });
});

describe("realSeries", () => {
  const rows = Object.freeze([
    Object.freeze({ year: 1, stocks: 0.2, bonds: 0.0, cpi: 0.1 }),
    Object.freeze({ year: 2, stocks: -0.1, bonds: 0.1, cpi: 0.0 }),
  ]);
  it("is all stocks at share 1 and all bonds at share 0", () => {
    near(realSeries(rows, 1)[0].real, 1.2 / 1.1 - 1);
    near(realSeries(rows, 0)[1].real, 0.1);
  });
  it("blends nominal returns by share before removing inflation", () => {
    near(realSeries(rows, 0.6)[0].real, 1.12 / 1.1 - 1);
    near(realSeries(rows, 0.6)[1].real, 0.6 * -0.1 + 0.4 * 0.1);
  });
  it("keeps years, one entry per row, and does not change its input", () => {
    const series = realSeries(rows, 0.5);
    assert.deepEqual(series.map((r) => r.year), [1, 2]);
  });
  it("gives a plausible long-run real return for the real data", () => {
    const stocks = geometricMean(realSeries(HISTORY, 1));
    const sixtyForty = geometricMean(realSeries(HISTORY, 0.6));
    assert.ok(stocks > 0.06 && stocks < 0.075, `${stocks}`);
    assert.ok(sixtyForty > 0.04 && sixtyForty < stocks, `${sixtyForty}`);
  });
});

describe("geometricMean", () => {
  it("is the compound annual rate", () => {
    near(geometricMean([{ real: 0.5 }, { real: -0.5 + 1 / 3 * 0 }]), Math.sqrt(1.5 * 0.5) - 1);
    near(geometricMean([{ real: 0.07 }, { real: 0.07 }]), 0.07);
  });
  it("is NaN for an empty series", () => {
    assert.ok(Number.isNaN(geometricMean([])));
  });
});

describe("shiftToRate", () => {
  const series = Object.freeze(realSeries(HISTORY, 1));
  it("makes the compound return exactly the requested rate", () => {
    for (const rate of [0, 0.03, 0.065, 0.1]) near(geometricMean(shiftToRate(series, rate)), rate);
  });
  it("keeps the order of good and bad years", () => {
    const shifted = shiftToRate(series, 0.04);
    const worst = (s) => s.reduce((w, r) => (r.real < w.real ? r : w)).year;
    assert.equal(worst(shifted), worst(series));
    assert.equal(shifted.length, series.length);
  });
  it("is unchanged when the rate already matches", () => {
    const same = shiftToRate(series, geometricMean(series));
    near(same[10].real, series[10].real);
  });
});

describe("seriesFor", () => {
  it("uses the preset's stock share", () => {
    assert.deepEqual(seriesFor("balanced-60-40", 0.05), realSeries(HISTORY, 0.6));
    assert.deepEqual(seriesFor("sp500", 0.05), realSeries(HISTORY, 1));
  });
  it("shifts the all-stock series for a custom return", () => {
    near(geometricMean(seriesFor("custom", 0.045)), 0.045);
  });
  it("falls back to all stocks for an unknown portfolio", () => {
    assert.deepEqual(seriesFor("nonsense", 0), realSeries(HISTORY, 1));
  });
});

describe("historicalPaths", () => {
  const series = [{ year: 2000, real: 0.1 }, { year: 2001, real: -0.2 }, { year: 2002, real: 0.3 }];
  const { paths, startYears } = historicalPaths({ series, months: 40 });
  it("makes one path per start year, each the requested length", () => {
    assert.equal(paths.length, 3);
    assert.deepEqual(startYears, [2000, 2001, 2002]);
    for (const path of paths) assert.equal(path.length, 40);
  });
  it("spreads each year's return evenly over its months", () => {
    for (let n = 0; n < 12; n++) near(paths[0][n], monthlyRate(0.1));
    const yearGrowth = paths[0].slice(12, 24).reduce((g, r) => g * (1 + r), 1);
    near(yearGrowth, 0.8);
  });
  it("wraps around to the first year after the last", () => {
    near(paths[1][12], monthlyRate(0.3)); // 2002 follows 2001
    near(paths[1][24], monthlyRate(0.1)); // wraps to 2000
    near(paths[2][12], monthlyRate(0.1));
    near(paths[2][36], monthlyRate(0.3)); // 2002 -> 2000 -> 2001 -> 2002
  });
  it("replays the full real history with every start year", () => {
    const real = historicalPaths({ series: realSeries(HISTORY, 0.6), months: 840 });
    assert.equal(real.paths.length, 98);
    const first = real.paths[0].slice(0, 12).reduce((g, r) => g * (1 + r), 1);
    near(first, 1 + realSeries(HISTORY, 0.6)[0].real);
  });
});
