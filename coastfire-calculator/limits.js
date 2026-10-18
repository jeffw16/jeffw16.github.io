// IRS workplace-plan limits (401(k), 403(b), 457(b), TSP) and checks of a contribution schedule against them.
// Pure: no DOM, no globals.

// 2026 limits (IRS Notice 2025-67, as reported by several retirement-plan sources):
//   $24,500 elective deferral; +$8,000 catch-up from age 50; ages 60-63 get a
//   $11,250 "super" catch-up that REPLACES the $8,000 one. $72,000 section 415(c)
//   limit on annual additions: deferrals (not catch-up), employer contributions
//   and after-tax (Mega Backdoor Roth) contributions together. Limits are indexed
//   to inflation, so they are treated as constant in today's dollars.
export const IRS_LIMITS = Object.freeze({ year: 2026, deferral: 24_500, catchUp50: 8_000, catchUp60to63: 11_250, annualAdditions: 72_000 });

/** Annual employee-deferral limit at an age (whole years). */
export function deferralLimit(age, limits = IRS_LIMITS) {
  const years = Math.floor(age);
  if (years < 50) return limits.deferral;
  if (years >= 60 && years <= 63) return limits.deferral + limits.catchUp60to63;
  return limits.deferral + limits.catchUp50;
}

/**
 * Sums of a monthly schedule over consecutive 12-month windows from month 0.
 * A shorter final window is summed as-is.
 */
export function annualTotals(schedule) {
  const totals = [];
  for (let start = 0; start < schedule.length; start += 12) {
    let annual = 0;
    for (let n = start; n < Math.min(schedule.length, start + 12); n++) annual += schedule[n];
    totals.push(annual);
  }
  return totals;
}

/**
 * First 12-month window of the employee's own contributions (a monthly
 * schedule starting at `age`) that exceeds the limit for that age, as
 * { age, annual, limit }, or null if none does. Employer match and after-tax
 * contributions don't count toward the limit, so pass the employee's pre-tax /
 * Roth deferrals only. A shorter final window is checked as-is.
 */
export function firstAgeOverLimit({ age, employeeSchedule, limits = IRS_LIMITS }) {
  const totals = annualTotals(employeeSchedule);
  for (let w = 0; w < totals.length; w++) {
    const windowAge = Math.floor(age + w);
    const limit = deferralLimit(windowAge, limits);
    if (totals[w] > limit + 1e-6) return { age: windowAge, annual: totals[w], limit };
  }
  return null;
}

/**
 * After-tax (Mega Backdoor Roth) room left in a year: the annual-additions
 * limit less the deferrals that count toward it and the employer match.
 * Catch-up deferrals (anything above the base deferral limit) don't count, so
 * deferrals are capped at `limits.deferral`. Never negative.
 */
export function afterTaxRoom({ employee, match, limits = IRS_LIMITS }) {
  return Math.max(0, limits.annualAdditions - Math.min(employee, limits.deferral) - match);
}

/**
 * First 12-month window whose after-tax contributions exceed the room left
 * under the annual-additions limit, as { age, afterTax, room, limit }, or null
 * if none does. The three schedules are monthly, start at `age` and are read
 * over the after-tax schedule's length.
 */
export function firstAgeOverAdditionsLimit({ age, employeeSchedule, matchSchedule, afterTaxSchedule, limits = IRS_LIMITS }) {
  const months = afterTaxSchedule.length;
  const employee = annualTotals(employeeSchedule.slice(0, months));
  const match = annualTotals(matchSchedule.slice(0, months));
  const afterTax = annualTotals(afterTaxSchedule);
  for (let w = 0; w < afterTax.length; w++) {
    const room = afterTaxRoom({ employee: employee[w] ?? 0, match: match[w] ?? 0, limits });
    if (afterTax[w] > room + 1e-6) return { age: Math.floor(age + w), afterTax: afterTax[w], room, limit: limits.annualAdditions };
  }
  return null;
}
