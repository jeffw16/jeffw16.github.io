import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeRisk, createRiskRunner, describeRisk, riskTitle, HISTORY_SPAN, PATHS, SEED, CONFIDENCE } from "../coastfire-calculator/risk.js";
import { computeScenario } from "../coastfire-calculator/scenario.js";
import { monthlyReturnPaths } from "../coastfire-calculator/montecarlo.js";
import { requiredBalance } from "../coastfire-calculator/retirement.js";

const need = { spending: 40_000, taxRate: 0.1, swr: 0.04, benefit: 0, benefitAge: 67, annualReturn: 0.07 };
const fire = Math.round(requiredBalance({ ...need, retireAge: 65 }));
const base = Object.freeze({
  mode: "contribution", age: 30, balance: 50_000, retirementAge: 65, targetAge: 55,
  contribution: 500, contributionUnit: "usd", salary: NaN, raise: 0, matchRate: 0, matchCap: 0,
  ...need, fire, volatility: 0.17,
});
const months = 840;
const pathsFor = (volatility, paths = 300) => monthlyReturnPaths({ paths, seed: SEED, months, annualReturn: 0.07, volatility });

describe("constants", () => {
  it("uses 1,000 seeded paths and 90% confidence", () => {
    assert.deepEqual([PATHS, SEED, CONFIDENCE], [1000, 1, 0.9]);
  });
});

describe("computeRisk (contribution mode)", () => {
  const scenario = computeScenario(base);
  const risk = computeRisk(base, scenario, pathsFor(0.17));
  it("returns the percentile band by year from the current age", () => {
    assert.equal(risk.band.p50.length, 71);
    assert.equal(risk.band.p10[0], 50_000);
    for (let t = 1; t < 71; t++) assert.ok(risk.band.p10[t] <= risk.band.p50[t] && risk.band.p50[t] <= risk.band.p90[t]);
  });
  it("spreads the FIRE age around the deterministic one", () => {
    const { p10, p50, p90 } = risk.fireAges;
    assert.ok(p10 < p50 && p50 < (p90 ?? Infinity));
    assert.ok(Math.abs(p50 - scenario.fireAge) < 4);
  });
  it("gives roughly even odds when coasting exactly at the deterministic coast age", () => {
    assert.ok(risk.coastChance > 0.3 && risk.coastChance < 0.7, `${risk.coastChance}`);
  });
  it("needs a later coast age for 90% confidence, or can't do it", () => {
    assert.ok(risk.coastConfidenceAge === null || risk.coastConfidenceAge > scenario.coastAge);
  });
  it("collapses to the deterministic answers at zero volatility", () => {
    const flat = computeRisk(base, scenario, pathsFor(0));
    assert.equal(flat.coastChance, 1);
    assert.ok(Math.abs(flat.coastConfidenceAge - scenario.coastAge) < 1e-9);
    assert.equal(flat.fireAges.p10, flat.fireAges.p90);
    assert.ok(Math.abs(flat.fireAges.p50 - scenario.fireAge) < 1e-9);
  });
  it("has a null coast chance when coasting is out of reach", () => {
    const poor = { ...base, balance: 0, contribution: 0 };
    assert.equal(computeRisk(poor, computeScenario(poor), pathsFor(0.17, 50)).coastChance, null);
  });
  it("has a 100% chance of stopping today when already past CoastFIRE with no volatility", () => {
    const rich = { ...base, balance: 500_000 };
    assert.equal(computeRisk(rich, computeScenario(rich), pathsFor(0)).coastChance, 1);
  });
  it("does not mutate a frozen input", () => {
    assert.doesNotThrow(() => computeRisk(Object.freeze({ ...base }), scenario, pathsFor(0.17, 20)));
  });
});

describe("computeRisk (target mode)", () => {
  const input = { ...base, mode: "target" };
  const scenario = computeScenario(input);
  const risk = computeRisk(input, scenario, pathsFor(0.17));
  it("asks for more than the deterministic contribution for 90% confidence", () => {
    assert.ok(risk.amountForConfidence > scenario.amount);
  });
  it("the deterministic contribution works about half the time", () => {
    assert.ok(risk.chanceAtSolved > 0.3 && risk.chanceAtSolved < 0.7, `${risk.chanceAtSolved}`);
  });
  it("matches the deterministic amount at zero volatility", () => {
    const flat = computeRisk(input, scenario, pathsFor(0, 20));
    assert.ok(Math.abs(flat.amountForConfidence - scenario.amount) < 0.01);
    assert.equal(flat.chanceAtSolved, 1);
  });
  it("works in percent of salary", () => {
    const pctInput = { ...input, contributionUnit: "pct", salary: 120_000 };
    const r = computeRisk(pctInput, computeScenario(pctInput), pathsFor(0.17, 100));
    assert.ok(r.amountForConfidence > 0 && r.amountForConfidence < 100);
  });
});

describe("createRiskRunner", () => {
  it("is deterministic across calls and inputs share random paths", () => {
    const run = createRiskRunner();
    const a = run(base);
    const b = run(base);
    assert.deepEqual(a, b);
    const more = run({ ...base, contribution: 1_000 });
    assert.ok(more.band.p50.at(-1) > a.band.p50.at(-1));
  });
  it("matches a fresh runner (the cache doesn't change results)", () => {
    const run = createRiskRunner();
    run({ ...base, volatility: 0.1 });
    assert.deepEqual(run(base), createRiskRunner()(base));
  });
  it("reports an unreachable scenario", () => {
    assert.deepEqual(createRiskRunner()({ ...base, mode: "target", contributionUnit: "pct" }), { unreachable: true });
  });
});


describe("describeRisk", () => {
  const run = (input) => describeRisk(input, computeScenario(input), createRiskRunner()(input));

  it("describes contribution mode with a range, a coast chance and a confidence age", () => {
    const { rows, hint } = run(base);
    assert.equal(rows.length, 3);
    assert.match(rows[0].label, /Full retirement age/);
    assert.match(rows[0].value, /^\d+ years.* to (\d+ years.*|after 100)$/);
    assert.match(rows[0].note, /^Median /);
    assert.match(rows[1].label, /Chance that stopping at 44 years still reaches it by 65/);
    assert.match(rows[1].value, /^\d+%$/);
    assert.match(rows[2].label, /90% confidence/);
    assert.match(hint, /1,000 simulated markets with 17% yearly volatility/);
    assert.match(hint, /about half the time/);
  });
  it("says 'stopping today' and drops the half-the-time hint once already coasting", () => {
    const { rows, hint } = run({ ...base, balance: 500_000 });
    assert.match(rows[1].label, /stopping today/);
    assert.doesNotMatch(hint, /about half/);
  });
  it("leaves out the coast chance when coasting is out of reach", () => {
    const { rows } = run({ ...base, balance: 0, contribution: 0 });
    assert.equal(rows.length, 2);
    assert.equal(rows[1].value, "Not by 65");
  });
  it("describes target mode in dollars", () => {
    const { rows } = run({ ...base, mode: "target" });
    assert.equal(rows.length, 2);
    assert.match(rows[0].label, /Contribution for 90% confidence/);
    assert.match(rows[0].value, /^\$[\d,]+\/mo$/);
    assert.match(rows[0].note, /^vs \$1,072\/mo if returns were steady$/);
    assert.match(rows[1].label, /by 55 with \$1,072\/mo/);
  });
  it("describes target mode in percent of salary", () => {
    const { rows } = run({ ...base, mode: "target", contributionUnit: "pct", salary: 120_000 });
    assert.match(rows[0].value, /^[\d.]+% of salary$/);
  });
});

describe("historical replay", () => {
  const historical = { ...base, returnModel: "historical", portfolio: "sp500", annualReturn: 0.07 };
  const run = createRiskRunner();
  const risk = run(historical);
  it("uses one path per start year and names the worst one", () => {
    assert.ok(HISTORY_SPAN.firstYear === 1928 && HISTORY_SPAN.lastYear === 2025);
    assert.equal(risk.band.p50.length, 71);
    // Retiring at 65 after starting in 1928-1943 only; the worst start for a 35-year plan is a bad stretch.
    assert.ok(Number.isInteger(risk.worstStartYear) && risk.worstStartYear >= 1928 && risk.worstStartYear <= 2025);
    assert.ok(risk.band.p10[35] <= risk.band.p50[35] && risk.band.p50[35] <= risk.band.p90[35]);
  });
  it("is deterministic and reuses its paths across contribution changes", () => {
    assert.deepEqual(run(historical), risk);
    const more = run({ ...historical, contribution: 900 });
    assert.equal(more.worstStartYear, risk.worstStartYear);
    assert.ok(more.band.p50[35] > risk.band.p50[35]);
  });
  it("changes with the portfolio", () => {
    const bonds = run({ ...historical, portfolio: "conservative-40-60" });
    assert.ok(bonds.band.p90[35] < risk.band.p90[35]);
  });
  it("describes the historical card", () => {
    const scenario = computeScenario(historical);
    const { rows, hint } = describeRisk(historical, scenario, risk);
    assert.ok(rows.length >= 2);
    assert.match(hint, /from 1928/);
    assert.match(hint, new RegExp(`worst start year for you was ${risk.worstStartYear}`));
    assert.doesNotMatch(hint, /volatility/);
  });
  it("titles the card by model", () => {
    assert.equal(riskTitle("historical"), "Across historical markets (1928\u20132025)");
    assert.equal(riskTitle("montecarlo"), "With market ups and downs");
  });
  it("works in target mode too", () => {
    const target = run({ ...historical, mode: "target" });
    assert.ok(Number.isInteger(target.worstStartYear));
    assert.ok(target.amountForConfidence === null || target.amountForConfidence >= 0);
  });
});
