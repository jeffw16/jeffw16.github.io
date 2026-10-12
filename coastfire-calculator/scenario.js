// The calculator's model as one pure function: form inputs in, results out.
// app.js only reads the form, calls this, and renders. No DOM, no globals.
import {
  DEFAULT_MAX_AGE,
  coastTarget,
  isCoastReached,
  contributionSchedule,
  solveEmployeeAmount,
  findCoastAge,
  findFireAge,
} from "./calc.js?v=f4edf72528";
import { requiredBalanceFn } from "./retirement.js?v=f4edf72528";
import { firstAgeOverLimit } from "./limits.js?v=f4edf72528";

/**
 * Everything the page shows for one set of inputs. `i` has the shape of the
 * form's parsed values: mode, age, balance, retirementAge, targetAge,
 * contribution, contributionUnit, salary, raise, matchRate, matchCap, the
 * retirement-need fields (spending, taxRate, swr, benefit, benefitAge),
 * annualReturn and fire. Returns { unreachable: true } when target mode has
 * no solution.
 */
export function computeScenario(i) {
  const isTarget = i.mode === "target";
  const fire = i.fire;
  const requiredAt = requiredBalanceFn(i, i.retirementAge, fire);
  const coastNow = coastTarget({ fire, annualReturn: i.annualReturn, age: i.age, retirementAge: i.retirementAge });
  const alreadyCoast = isCoastReached(i.balance, coastNow);
  const scheduleOf = (amount) => contributionSchedule({
    months: Math.round((DEFAULT_MAX_AGE - i.age) * 12),
    unit: i.contributionUnit, amount, salary: i.salary, raise: i.raise, matchRate: i.matchRate, matchCap: i.matchCap,
  });
  const amount = isTarget
    ? solveEmployeeAmount({
        balance: i.balance, annualReturn: i.annualReturn, months: Math.round((i.targetAge - i.age) * 12),
        target: requiredAt(i.targetAge), unit: i.contributionUnit, salary: i.salary, raise: i.raise,
        matchRate: i.matchRate, matchCap: i.matchCap,
      })
    : i.contribution;
  if (amount === null) return { unreachable: true };

  const schedule = scheduleOf(amount);
  const monthlyContribution = schedule.employee[0];
  const params = { ...i, monthlyContribution, contributions: schedule.total, fire, requiredAt };
  const coastAge = alreadyCoast ? i.age : findCoastAge(params);
  const fireAge = isTarget ? findFireAge(params) ?? i.targetAge : findFireAge(params);

  // The employer match doesn't count toward the IRS limit; check your own contributions
  // for the years you'd be contributing.
  const contributingUntil = isTarget ? i.targetAge : fireAge ?? i.retirementAge;
  const over = firstAgeOverLimit({
    age: i.age,
    employeeSchedule: schedule.employee.subarray(0, Math.max(0, Math.round((contributingUntil - i.age) * 12))),
  });

  return {
    unreachable: false,
    isTarget, fire, requiredAt, coastNow, alreadyCoast, amount, schedule, monthlyContribution,
    matchMonthly: schedule.total[0] - schedule.employee[0],
    params, coastAge, fireAge,
    coastMonth: coastAge === null ? null : Math.round((coastAge - i.age) * 12),
    over,
  };
}

/**
 * The scenario's key results at shifted real returns. One row per delta:
 * { delta, rate, alreadyCoast, coastAge, fireAge, amount }.
 */
export function sensitivity(i, deltas = [-0.01, 0, 0.01]) {
  return deltas.map((delta) => {
    const rate = i.annualReturn + delta;
    const s = computeScenario({ ...i, annualReturn: rate });
    return s.unreachable
      ? { delta, rate, unreachable: true }
      : { delta, rate, unreachable: false, alreadyCoast: s.alreadyCoast, coastAge: s.coastAge, fireAge: s.fireAge, amount: s.amount };
  });
}
