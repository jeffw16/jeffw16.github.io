// Historical US market data and helpers for replaying it ("what if you retired into
// every year from 1928?"). All functions are pure.
//
// Sources (retrieved October 2026):
//   Stocks and bonds: Aswath Damodaran, NYU Stern, "Historical Returns on Stocks,
//     Bonds and Bills: 1928-2025" (https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/histretSP.html),
//     columns "S&P 500 (includes dividends)" and "US T. Bond (10-year)", nominal annual returns.
//   Inflation: US Bureau of Labor Statistics CPI-U, all items, not seasonally adjusted,
//     via FRED series CPIAUCNS (https://fred.stlouisfed.org/series/CPIAUCNS), December-to-December
//     change in the index to match the calendar-year returns. (Oct 2025 has no CPI release, which
//     December-to-December avoids.)
// Rows are [year, stocks %, bonds %, inflation %] as published, rounded to two decimals.
import { monthlyRate } from "./calc.js?v=1125c57851";

const ROWS = [
  [1928, 43.81, 0.84, -1.16],
  [1929, -8.3, 4.2, 0.58],
  [1930, -25.12, 4.54, -6.4],
  [1931, -43.84, -2.56, -9.32],
  [1932, -8.64, 8.79, -10.27],
  [1933, 49.98, 1.86, 0.76],
  [1934, -1.19, 7.96, 1.52],
  [1935, 46.74, 4.47, 2.99],
  [1936, 31.94, 5.02, 1.45],
  [1937, -35.34, 1.38, 2.86],
  [1938, 29.28, 4.21, -2.78],
  [1939, -1.1, 4.41, 0.0],
  [1940, -10.67, 5.4, 0.71],
  [1941, -12.77, -2.02, 9.93],
  [1942, 19.17, 2.29, 9.03],
  [1943, 25.06, 2.49, 2.96],
  [1944, 19.03, 2.58, 2.3],
  [1945, 35.82, 3.8, 2.25],
  [1946, -8.43, 3.13, 18.13],
  [1947, 5.2, 0.92, 8.84],
  [1948, 5.7, 1.95, 2.99],
  [1949, 18.3, 4.66, -2.07],
  [1950, 30.81, 0.43, 5.93],
  [1951, 23.68, -0.3, 6.0],
  [1952, 18.15, 2.27, 0.75],
  [1953, -1.21, 4.14, 0.75],
  [1954, 52.56, 3.29, -0.74],
  [1955, 32.6, -1.34, 0.37],
  [1956, 7.44, -2.26, 2.99],
  [1957, -10.46, 6.8, 2.9],
  [1958, 43.72, -2.1, 1.76],
  [1959, 12.06, -2.65, 1.73],
  [1960, 0.34, 11.64, 1.36],
  [1961, 26.64, 2.06, 0.67],
  [1962, -8.81, 5.69, 1.33],
  [1963, 22.61, 1.68, 1.64],
  [1964, 16.42, 3.73, 0.97],
  [1965, 12.4, 0.72, 1.92],
  [1966, -9.97, 2.91, 3.46],
  [1967, 23.8, -1.58, 3.04],
  [1968, 10.81, 3.27, 4.72],
  [1969, -8.24, -5.01, 6.2],
  [1970, 3.56, 16.75, 5.57],
  [1971, 14.22, 9.79, 3.27],
  [1972, 18.76, 2.82, 3.41],
  [1973, -14.31, 3.66, 8.71],
  [1974, -25.9, 1.99, 12.34],
  [1975, 37.0, 3.61, 6.94],
  [1976, 23.83, 15.98, 4.86],
  [1977, -6.98, 1.29, 6.7],
  [1978, 6.51, -0.78, 9.02],
  [1979, 18.52, 0.67, 13.29],
  [1980, 31.74, -2.99, 12.52],
  [1981, -4.7, 8.2, 8.92],
  [1982, 20.42, 32.81, 3.83],
  [1983, 22.34, 3.2, 3.79],
  [1984, 6.15, 13.73, 3.95],
  [1985, 31.24, 25.71, 3.8],
  [1986, 18.49, 24.28, 1.1],
  [1987, 5.81, -4.96, 4.43],
  [1988, 16.54, 8.22, 4.42],
  [1989, 31.48, 17.69, 4.65],
  [1990, -3.06, 6.24, 6.11],
  [1991, 30.23, 15.0, 3.06],
  [1992, 7.49, 9.36, 2.9],
  [1993, 9.97, 14.21, 2.75],
  [1994, 1.33, -8.04, 2.67],
  [1995, 37.2, 23.48, 2.54],
  [1996, 22.68, 1.43, 3.32],
  [1997, 33.1, 9.94, 1.7],
  [1998, 28.34, 14.92, 1.61],
  [1999, 20.89, -8.25, 2.68],
  [2000, -9.03, 16.66, 3.39],
  [2001, -11.85, 5.57, 1.55],
  [2002, -21.97, 15.12, 2.38],
  [2003, 28.36, 0.38, 1.88],
  [2004, 10.74, 4.49, 3.26],
  [2005, 4.83, 2.87, 3.42],
  [2006, 15.61, 1.96, 2.54],
  [2007, 5.48, 10.21, 4.08],
  [2008, -36.55, 20.1, 0.09],
  [2009, 25.94, -11.12, 2.72],
  [2010, 14.82, 8.46, 1.5],
  [2011, 2.1, 16.04, 2.96],
  [2012, 15.89, 2.97, 1.74],
  [2013, 32.15, -9.1, 1.5],
  [2014, 13.52, 10.75, 0.76],
  [2015, 1.38, 1.28, 0.73],
  [2016, 11.77, 0.69, 2.07],
  [2017, 21.61, 2.8, 2.11],
  [2018, -4.23, -0.02, 1.91],
  [2019, 31.21, 9.64, 2.29],
  [2020, 18.02, 11.33, 1.36],
  [2021, 28.47, -4.42, 7.04],
  [2022, -18.04, -17.83, 6.45],
  [2023, 26.06, 3.88, 3.35],
  [2024, 24.88, -1.64, 2.89],
  [2025, 17.78, 7.8, 2.68],
];

/** Yearly nominal returns and inflation as fractions: [{ year, stocks, bonds, cpi }]. */
export const HISTORY = Object.freeze(
  ROWS.map(([year, stocks, bonds, cpi]) => Object.freeze({ year, stocks: stocks / 100, bonds: bonds / 100, cpi: cpi / 100 })),
);

/** Share of the portfolio in stocks (the rest is 10-year Treasuries) for each preset. */
export const STOCK_SHARE = Object.freeze({
  sp500: 1,
  "total-market": 1,
  "global-80-20": 0.8,
  "target-date": 0.7, // simplification: a mid-life target-date fund
  "balanced-60-40": 0.6,
  "conservative-40-60": 0.4,
});

/** Real (after-inflation) return from a nominal return and inflation. */
export function realReturn(nominal, inflation) {
  return (1 + nominal) / (1 + inflation) - 1;
}

/**
 * Real yearly returns of a portfolio holding `stockShare` in stocks and the rest in
 * bonds, rebalanced every January: [{ year, real }].
 */
export function realSeries(rows, stockShare) {
  return rows.map((row) => ({
    year: row.year,
    real: realReturn(stockShare * row.stocks + (1 - stockShare) * row.bonds, row.cpi),
  }));
}

/** Compound (geometric mean) annual return of a series. */
export function geometricMean(series) {
  if (series.length === 0) return NaN;
  const logSum = series.reduce((sum, row) => sum + Math.log(1 + row.real), 0);
  return Math.exp(logSum / series.length) - 1;
}

/**
 * The same series moved so its compound annual return is exactly `rate`: every
 * year's growth factor is scaled by the same amount, keeping the shape of the ups and downs.
 */
export function shiftToRate(series, rate) {
  const scale = (1 + rate) / (1 + geometricMean(series));
  return series.map((row) => ({ year: row.year, real: (1 + row.real) * scale - 1 }));
}

/** The real series to replay for a portfolio id; "custom" shifts the all-stock series to `customReturn`. */
export function seriesFor(portfolioId, customReturn, rows = HISTORY) {
  if (portfolioId === "custom") return shiftToRate(realSeries(rows, 1), customReturn);
  const share = STOCK_SHARE[portfolioId];
  return realSeries(rows, share === undefined ? 1 : share);
}

/**
 * One monthly-return path per starting year: the path for start year k replays
 * series[k], series[k+1], ... wrapping around to the first year after the last.
 * Each year's return is spread evenly over its 12 months.
 * Returns { paths: Float64Array[], startYears: number[] }.
 */
export function historicalPaths({ series, months }) {
  const monthly = series.map((row) => monthlyRate(row.real));
  const paths = series.map((_, start) => {
    const path = new Float64Array(months);
    for (let n = 0; n < months; n++) path[n] = monthly[(start + Math.floor(n / 12)) % series.length];
    return path;
  });
  return { paths, startYears: series.map((row) => row.year) };
}
