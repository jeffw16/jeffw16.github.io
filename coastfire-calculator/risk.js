// "With market ups and downs": what the Monte Carlo paths say about a scenario.
// computeRisk is pure; createRiskRunner adds a small cache of the (expensive)
// random paths so editing contributions doesn't regenerate them.
import { DEFAULT_MAX_AGE, contributionSchedule, coastPathSchedule } from "./calc.js?v=b8cc2a8e5f";
import { computeScenario, scheduleOptions } from "./scenario.js?v=b8cc2a8e5f";
import {
  monthlyReturnPaths,
  balancePaths,
  percentilesByYear,
  successRate,
  fireAgeDistribution,
  coastSuccessRate,
  coastConfidenceAge,
  contributionForConfidence,
} from "./montecarlo.js?v=b8cc2a8e5f";
import { formatAge, formatAgeOrNote } from "./format.js?v=b8cc2a8e5f";
import { HISTORY, seriesFor, historicalPaths } from "./history.js?v=b8cc2a8e5f";

export const PATHS = 1000;
export const SEED = 1;
export const CONFIDENCE = 0.9;

/**
 * Risk results for a scenario over the given monthly-return paths (each at
 * least as long as the schedule). Contribution mode: the FIRE-age spread, the
 * chance that stopping at the coast age still works, and the earliest stop age
 * with `confidence`. Target mode: the contribution for `confidence` and the
 * chance the deterministic contribution works. `band` is the yearly 10/50/90th
 * percentile of the contributed balance, from the current age. With `startYears`
 * (one per path, for historical replays) it also names the `worstStartYear`: the
 * path with the lowest balance at the retirement (or target) age.
 */
export function computeRisk(i, scenario, returnPaths, { confidence = CONFIDENCE, startYears = null } = {}) {
  const { schedule, requiredAt, fire, isTarget, coastMonth } = scenario;
  const paths = balancePaths({ returnPaths, balance: i.balance, contributions: schedule.total });
  const [p10, p50, p90] = percentilesByYear(paths, [0.1, 0.5, 0.9]);
  const result = { confidence, band: { p10, p50, p90 }, fireAges: fireAgeDistribution(paths, requiredAt, i.age) };
  if (startYears) {
    const horizon = Math.round(((isTarget ? i.targetAge : i.retirementAge) - i.age) * 12);
    let worst = 0;
    paths.forEach((path, k) => {
      if (path[Math.min(horizon, path.length - 1)] < paths[worst][Math.min(horizon, paths[worst].length - 1)]) worst = k;
    });
    result.worstStartYear = startYears[worst];
  }

  if (isTarget) {
    const months = Math.round((i.targetAge - i.age) * 12);
    const target = requiredAt(i.targetAge);
    result.chanceAtSolved = successRate(paths, months, target);
    result.amountForConfidence = contributionForConfidence({
      returnPaths, balance: i.balance, months, target, confidence,
      scheduleFor: (amount) => contributionSchedule({ ...scheduleOptions(i), months, amount }).total,
    });
  } else {
    const common = { returnPaths, balance: i.balance, contributions: schedule.total, age: i.age, retirementAge: i.retirementAge, fire };
    result.coastChance = coastMonth === null ? null : coastSuccessRate({ ...common, stopMonth: coastMonth });
    result.coastConfidenceAge = coastConfidenceAge({ ...common, confidence });
  }
  return result;
}

/**
 * A function (inputs) => risk results (or { unreachable: true }) that keeps the
 * last set of paths (random, or replayed history) for reuse while the return
 * assumptions are unchanged.
 */
export function createRiskRunner() {
  let key = null;
  let returnPaths = null;
  let startYears = null;
  return (i) => {
    const scenario = computeScenario(i);
    if (scenario.unreachable) return { unreachable: true };
    const months = Math.round((DEFAULT_MAX_AGE - i.age) * 12);
    const historical = i.returnModel === "historical";
    const nextKey = historical
      ? ["historical", i.portfolio, i.portfolio === "custom" ? i.annualReturn : "", months].join("|")
      : ["montecarlo", i.annualReturn, i.volatility, months].join("|");
    if (nextKey !== key) {
      if (historical) {
        ({ paths: returnPaths, startYears } = historicalPaths({ series: seriesFor(i.portfolio, i.annualReturn), months }));
      } else {
        returnPaths = monthlyReturnPaths({ paths: PATHS, seed: SEED, months, annualReturn: i.annualReturn, volatility: i.volatility });
        startYears = null;
      }
      key = nextKey;
    }
    return computeRisk(i, scenario, returnPaths, { startYears });
  };
}

/** Years covered by the historical data, e.g. { firstYear: 1928, lastYear: 2025 }. */
export const HISTORY_SPAN = Object.freeze({ firstYear: HISTORY[0].year, lastYear: HISTORY[HISTORY.length - 1].year });

/** Heading for the risk card. */
export function riskTitle(returnModel) {
  return returnModel === "historical"
    ? `Across historical markets (${HISTORY_SPAN.firstYear}\u2013${HISTORY_SPAN.lastYear})`
    : "With market ups and downs";
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const percent = (x) => `${Math.round(x * 100)}%`;

/**
 * Text for the "With market ups and downs" card: { rows: [{ label, value, note? }], hint }.
 * `i` is the form inputs (with `volatility`), `scenario` the deterministic result.
 */
export function describeRisk(i, scenario, risk) {
  const confidence = percent(risk.confidence);
  const amountText = (amount) => (i.contributionUnit === "pct" ? `${decimal.format(amount)}% of salary` : `${usd.format(amount)}/mo`);
  const historical = i.returnModel === "historical";
  const volatilityNote = historical
    ? `Replays real returns starting in each of the ${HISTORY.length} years from ${HISTORY_SPAN.firstYear}; later years wrap around to ${HISTORY_SPAN.firstYear}. ` +
      `The worst start year for you was ${risk.worstStartYear}.`
    : `Based on ${PATHS.toLocaleString("en-US")} simulated markets with ${percent(i.volatility)} yearly volatility.`;
  const edgeNote = " Coasting exactly on the line works only about half the time — markets don't move in straight lines.";

  if (scenario.isTarget) {
    // Mega Backdoor Roth and IRA/HSA amounts are held fixed; only the basic contribution is solved.
    const mega = scenario.megaMonthly > 0;
    const megaNote = (mega ? `, plus ${amountText(i.megaContribution)} Mega Backdoor Roth` : "")
      + (scenario.otherMonthly > 0 ? `, plus ${amountText(i.otherContribution)} IRA/HSA` : "");
    return {
      rows: [
        {
          label: `${mega ? "Basic contribution" : "Contribution"} for ${confidence} confidence`,
          value: risk.amountForConfidence === null ? "Not reachable" : amountText(risk.amountForConfidence),
          note: `vs ${amountText(scenario.amount)} if returns were steady${megaNote}`,
        },
        { label: `Chance of reaching your FIRE number by ${i.targetAge} with ${amountText(scenario.amount)}`, value: percent(risk.chanceAtSolved) },
      ],
      hint: historical ? volatilityNote : `${volatilityNote} The steady-returns answer works only about half the time — markets don't move in straight lines.`,
    };
  }

  const { p10, p50, p90 } = risk.fireAges;
  const after = `after ${DEFAULT_MAX_AGE}`;
  const rows = [{
    label: "Full retirement age (80% of outcomes)",
    value: `${p10 === null ? after : formatAge(p10)} to ${p90 === null ? after : formatAge(p90)}`,
    note: `Median ${p50 === null ? after : formatAge(p50)}`,
  }];
  if (risk.coastChance !== null) {
    rows.push({
      label: scenario.alreadyCoast
        ? `Chance that stopping today still reaches your FIRE number by ${i.retirementAge}`
        : `Chance that stopping at ${formatAge(scenario.coastAge)} still reaches it by ${i.retirementAge}`,
      value: percent(risk.coastChance),
    });
  }
  rows.push({ label: `Stop contributing with ${confidence} confidence`, value: formatAgeOrNote(risk.coastConfidenceAge, `Not by ${i.retirementAge}`) });
  const edge = !historical && !scenario.alreadyCoast && scenario.coastAge !== null ? edgeNote : "";
  return { rows, hint: volatilityNote + edge };
}
