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
  simulate,
  monthlyRate,
} from "./calc.js?v=b8cc2a8e5f";
import { requiredBalanceFn } from "./retirement.js?v=b8cc2a8e5f";
import { firstAgeOverLimit, firstAgeOverAdditionsLimit, afterTaxRoom, annualTotals } from "./limits.js?v=b8cc2a8e5f";

/** After-tax (Mega Backdoor Roth) contribution in the schedule's unit: 0 unless the option is on. */
export function afterTaxAmountOf(i) {
  return i.megaBackdoor && i.megaContribution > 0 ? i.megaContribution : 0;
}

/** Contribution to IRAs, HSAs and other accounts outside the workplace plan, in the schedule's unit (0 if missing). */
export function otherAmountOf(i) {
  return i.otherContribution > 0 ? i.otherContribution : 0;
}

/** The contributionSchedule options shared by every schedule of a scenario, except `months` and `amount`. */
export function scheduleOptions(i) {
  return {
    unit: i.contributionUnit, afterTaxAmount: afterTaxAmountOf(i), otherAmount: otherAmountOf(i), salary: i.salary, raise: i.raise,
    matchRate: i.matchRate, matchCap: i.matchCap, employerRate: i.employerRate > 0 ? i.employerRate : 0,
  };
}

/**
 * Share of the balance after `months` months that comes from after-tax
 * (Mega Backdoor Roth) contributions and their growth, so is Roth money.
 * 0 with no after-tax contributions or no balance.
 */
export function rothShareAt({ balance, schedule, annualReturn, months }) {
  const m = Math.max(0, Math.round(months));
  const rm = monthlyRate(annualReturn);
  const roth = simulate({ balance: 0, contributions: schedule.afterTax.subarray(0, m), monthlyReturns: rm }).at(-1);
  const all = simulate({ balance, contributions: schedule.total.subarray(0, m), monthlyReturns: rm }).at(-1);
  return roth > 0 && all > 0 ? roth / all : 0;
}

/**
 * Everything the page shows for one set of inputs. `i` has the shape of the
 * form's parsed values: mode, age, balance, retirementAge, targetAge,
 * contribution (to the workplace plan), contributionUnit, salary, raise,
 * matchRate, matchCap, employerRate (an employer contribution as a fraction of
 * salary), otherContribution (IRAs, HSAs: same unit, not matched and outside
 * the workplace-plan limits), the optional Mega Backdoor Roth fields
 * (megaBackdoor, megaContribution: an after-tax contribution in the same
 * unit; it and otherContribution are held fixed in target mode), the
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
  const options = scheduleOptions(i);
  const scheduleOf = (amount) => contributionSchedule({ ...options, months: Math.round((DEFAULT_MAX_AGE - i.age) * 12), amount });
  const amount = isTarget
    ? solveEmployeeAmount({
        ...options, balance: i.balance, annualReturn: i.annualReturn, months: Math.round((i.targetAge - i.age) * 12),
        target: requiredAt(i.targetAge),
      })
    : i.contribution;
  if (amount === null) return { unreachable: true };

  const schedule = scheduleOf(amount);
  const monthlyContribution = schedule.employee[0];
  const params = { ...i, monthlyContribution, contributions: schedule.total, fire, requiredAt };
  const coastAge = alreadyCoast ? i.age : findCoastAge(params);
  const fireAge = isTarget ? findFireAge(params) ?? i.targetAge : findFireAge(params);

  // Employer money and IRA/HSA money don't count toward the deferral limit; check your
  // own workplace-plan contributions for the years you'd be contributing.
  const contributingUntil = isTarget ? i.targetAge : fireAge ?? i.retirementAge;
  const contributingMonths = Math.max(0, Math.round((contributingUntil - i.age) * 12));
  const over = firstAgeOverLimit({ age: i.age, employeeSchedule: schedule.employee.subarray(0, contributingMonths) });

  // Mega Backdoor Roth: after-tax money must fit under the annual-additions limit
  // with the basic deferrals and all employer money. Room is shown for the first year.
  const mega = options.afterTaxAmount > 0;
  const firstYear = (s) => annualTotals(s.subarray(0, 12))[0] ?? 0;
  const employerSchedule = schedule.match.map((m, n) => m + schedule.nonelective[n]);
  const megaRoom = i.megaBackdoor
    ? afterTaxRoom({ employee: firstYear(schedule.employee), match: firstYear(employerSchedule) })
    : null;
  const overAdditions = mega
    ? firstAgeOverAdditionsLimit({
        age: i.age,
        employeeSchedule: schedule.employee,
        matchSchedule: employerSchedule,
        afterTaxSchedule: schedule.afterTax.subarray(0, contributingMonths),
      })
    : null;
  const rothShare = mega
    ? rothShareAt({ balance: i.balance, schedule, annualReturn: i.annualReturn, months: contributingMonths })
    : 0;

  return {
    unreachable: false,
    isTarget, fire, requiredAt, coastNow, alreadyCoast, amount, schedule, monthlyContribution,
    matchMonthly: schedule.match[0] ?? 0,
    employerMonthly: schedule.nonelective[0] ?? 0,
    megaMonthly: schedule.afterTax[0] ?? 0,
    otherMonthly: schedule.other[0] ?? 0,
    params, coastAge, fireAge,
    coastMonth: coastAge === null ? null : Math.round((coastAge - i.age) * 12),
    over, megaRoom, overAdditions, rothShare,
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
