// IRS 401(k) employee-deferral limits and a check of a contribution schedule
// against them. Pure: no DOM, no globals.

// 2026 limits (IRS Notice 2025-67, as reported by several retirement-plan sources):
//   $24,500 elective deferral; +$8,000 catch-up from age 50; ages 60-63 get a
//   $11,250 "super" catch-up that REPLACES the $8,000 one. Limits are indexed
//   to inflation, so they are treated as constant in today's dollars.
export const IRS_LIMITS = Object.freeze({ year: 2026, deferral: 24_500, catchUp50: 8_000, catchUp60to63: 11_250 });

/** Annual employee-deferral limit at an age (whole years). */
export function deferralLimit(age, limits = IRS_LIMITS) {
  const years = Math.floor(age);
  if (years < 50) return limits.deferral;
  if (years >= 60 && years <= 63) return limits.deferral + limits.catchUp60to63;
  return limits.deferral + limits.catchUp50;
}

/**
 * First 12-month window of the employee's own contributions (a monthly
 * schedule starting at `age`) that exceeds the limit for that age, as
 * { age, annual, limit }, or null if none does. Employer match doesn't count
 * toward the limit, so pass the employee schedule only. A shorter final window
 * is checked as-is.
 */
export function firstAgeOverLimit({ age, employeeSchedule, limits = IRS_LIMITS }) {
  for (let start = 0, w = 0; start < employeeSchedule.length; start += 12, w++) {
    let annual = 0;
    for (let n = start; n < Math.min(employeeSchedule.length, start + 12); n++) annual += employeeSchedule[n];
    const windowAge = Math.floor(age + w);
    const limit = deferralLimit(windowAge, limits);
    if (annual > limit + 1e-6) return { age: windowAge, annual, limit };
  }
  return null;
}
