// UI wiring for the CoastFIRE calculator. All math lives in calc.js.
import {
  PORTFOLIOS,
  DEFAULT_PORTFOLIO_ID,
  DEFAULT_MAX_AGE,
  resolveReturn,
  fireNumber,
  spendingFromFire,
  coastTarget,
  isCoastReached,
  findCoastAge,
  findFireAge,
  requiredMonthlyContribution,
  chartEndAge,
  buildSeries,
  splitAge,
} from "./calc.js?v=53d25079a1";
import {
    requiredBalance,
  spendingFromRequired,
  benefitCoversSpending,
  requiredBalanceFn,
  earlyAccessGuidance,
} from "./retirement.js?v=53d25079a1";
import { parseAmount, groupDigits, formatWithCaret, deleteAcrossComma, formatAge, formatAgeParts } from "./format.js?v=53d25079a1";
import { STORAGE_KEY, serializeState, parseSavedState, isDefaultState, savedKeys } from "./persist.js?v=53d25079a1";

const $ = (id) => document.getElementById(id);
const form = $("inputs");

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const moneyCompact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });
const pct = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });

let chart = null;

// ---------- Setup ----------

for (const p of PORTFOLIOS) {
  $("portfolio").add(new Option(`${p.label} (${pct.format(p.rate)})`, p.id, false, p.id === DEFAULT_PORTFOLIO_ID));
}
$("portfolio").add(new Option("Custom…", "custom"));

// Comma-group dollar inputs as the user types, keeping the caret in place.
for (const el of form.querySelectorAll("[data-amount]")) {
  // Make Backspace/Delete next to a comma remove the neighbouring digit.
  el.addEventListener("beforeinput", (e) => {
    const direction = { deleteContentBackward: "backward", deleteContentForward: "forward" }[e.inputType];
    if (!direction || el.selectionStart !== el.selectionEnd) return;
    const edit = deleteAcrossComma(el.value, el.selectionStart, direction);
    if (!edit) return;
    e.preventDefault();
    el.value = edit.value;
    el.setSelectionRange(edit.caret, edit.caret);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  el.addEventListener("input", () => {
    const { value, caret } = formatWithCaret(el.value, el.selectionStart ?? el.value.length);
    if (value === el.value) return;
    el.value = value;
    el.setSelectionRange(caret, caret);
  });
  el.addEventListener("blur", () => { el.value = groupDigits(el.value).replace(/\.$/, ""); });
}

// Keep spending and the FIRE number in sync. The FIRE number is what the
// calculation uses; editing it directly back-fills spending. Everything that
// changes the amount needed at the traditional retirement age re-derives it.
const setAmount = (id, value) => { if (Number.isFinite(value)) $(id).value = groupDigits(String(Math.round(value))); };
const FIRE_DRIVERS = ["spending", "swr", "taxRate", "benefit", "benefitAge", "retirementAge", "portfolio", "customReturn"];
for (const id of FIRE_DRIVERS) {
  $(id).addEventListener("input", syncFire);
  $(id).addEventListener("change", syncFire);
}
$("fire").addEventListener("input", () => {
  const spending = spendingFromRequired({ ...needAt(num("retirementAge")), required: num("fire") });
  if (Number.isFinite(spending)) setAmount("spending", spending);
});

$("reset").addEventListener("click", () => {
  applyFormValues(DEFAULTS);
  update();
});

form.addEventListener("input", update);
form.addEventListener("change", update);
form.addEventListener("submit", (e) => e.preventDefault());
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { chart?.destroy(); chart = null; update(); });


// ---------- Saved values ----------

// Form fields remembered in localStorage, by name.
const FIELDS = ["mode", "age", "balance", "contribution", "targetAge", "retirementAge", "spending", "swr", "taxRate", "benefit", "benefitAge", "fire", "portfolio", "customReturn"];
const ALLOWED = { mode: ["contribution", "target"], portfolio: [...PORTFOLIOS.map((p) => p.id), "custom"] };

function defaultValueOf(name) {
  if (name === "mode") return [...form.elements.mode].find((r) => r.defaultChecked).value;
  if (name === "portfolio") return DEFAULT_PORTFOLIO_ID;
  return form.elements[name].defaultValue;
}

const DEFAULTS = Object.freeze(Object.fromEntries(FIELDS.map((n) => [n, defaultValueOf(n)])));

function readFormValues() {
  return Object.fromEntries(FIELDS.map((n) => [n, form.elements[n].value]));
}

function applyFormValues(values) {
  for (const n of FIELDS) form.elements[n].value = values[n];
}

// Storage can be unavailable (private mode, blocked site data); the page works without it.
function loadSaved() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

function saveValues(values) {
  try {
    if (isDefaultState(values, DEFAULTS)) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, serializeState(values));
  } catch { /* ignore */ }
}

// ---------- Read inputs ----------

function num(id) {
  const el = $(id);
  if ("amount" in el.dataset) return parseAmount(el.value);
  return el.value.trim() === "" ? NaN : Number(el.value);
}

const numOr0 = (id) => { const v = num(id); return Number.isFinite(v) ? v : 0; };

// Inputs that determine the balance needed to retire at a given age.
function needAt(retireAge) {
  return {
    spending: num("spending"),
    taxRate: num("taxRate") / 100,
    swr: num("swr") / 100,
    benefit: numOr0("benefit"),
    benefitAge: num("benefitAge"),
    retireAge,
    annualReturn: resolveReturn($("portfolio").value, num("customReturn") / 100),
  };
}

/** Lock the FIRE number when a benefit that has started covers all spending. */
function setFireLock(covered, benefitAge) {
  $("fire").readOnly = covered;
  $("fireHint").textContent = covered
    ? `Your benefit covers your spending from age ${benefitAge}, so no 401(k) balance is needed.`
    : FIRE_HINT;
}

/** Recompute the FIRE number from spending and the other retirement inputs. */
function syncFire() {
  const need = needAt(num("retirementAge"));
  const covered = benefitCoversSpending(need);
  setFireLock(covered, need.benefitAge);
  const required = covered ? 0 : requiredBalance(need);
  if (Number.isFinite(required)) setAmount("fire", required);
}
const FIRE_HINT = $("fireHint").textContent;

function readInputs() {
  const portfolio = $("portfolio").value;
  return {
    mode: form.elements.mode.value,
    age: num("age"),
    balance: num("balance"),
    monthlyContribution: num("contribution"),
    retirementAge: num("retirementAge"),
    targetAge: num("targetAge"),
    spending: num("spending"),
    swr: num("swr") / 100,
    taxRate: num("taxRate") / 100,
    benefit: numOr0("benefit"),
    benefitAge: num("benefitAge"),
    fire: num("fire"),
    portfolio,
    annualReturn: resolveReturn(portfolio, num("customReturn") / 100),
  };
}

function validate(i) {
  const problems = [];
  const check = (id, ok, msg) => {
    $(id).setAttribute("aria-invalid", String(!ok));
    if (!ok) problems.push(msg);
  };
  check("age", Number.isFinite(i.age) && i.age >= 16 && i.age < DEFAULT_MAX_AGE, "Enter a current age between 16 and 99.");
  check("balance", Number.isFinite(i.balance) && i.balance >= 0, "Enter your current 401(k) balance (0 or more).");
  check("retirementAge", Number.isFinite(i.retirementAge) && i.retirementAge > i.age && i.retirementAge <= DEFAULT_MAX_AGE,
    "Retirement age must be after your current age and at most 100.");
  if (i.mode === "contribution") {
    check("contribution", Number.isFinite(i.monthlyContribution) && i.monthlyContribution >= 0, "Enter a monthly contribution (0 or more).");
    $("targetAge").setAttribute("aria-invalid", "false");
  } else {
    check("targetAge", Number.isFinite(i.targetAge) && i.targetAge > i.age && i.targetAge <= DEFAULT_MAX_AGE,
      "Target retirement age must be after your current age and at most 100.");
    $("contribution").setAttribute("aria-invalid", "false");
  }
  check("spending", Number.isFinite(i.spending) && i.spending > 0, "Enter your expected annual spending in retirement.");
  check("swr", Number.isFinite(i.swr) && i.swr > 0, "Enter a withdrawal rate above 0%.");
  check("taxRate", Number.isFinite(i.taxRate) && i.taxRate >= 0 && i.taxRate < 1, "Enter a tax rate from 0% to 60%.");
  check("benefit", Number.isFinite(i.benefit) && i.benefit >= 0, "Enter a benefit of $0 or more per year.");
  check("benefitAge", Number.isFinite(i.benefitAge) && i.benefitAge >= 50 && i.benefitAge <= DEFAULT_MAX_AGE, "Benefit start age must be between 50 and 100.");
  const covered = benefitCoversSpending({ spending: i.spending, benefit: i.benefit, benefitAge: i.benefitAge, retireAge: i.retirementAge });
  setFireLock(covered, i.benefitAge);
  check("fire", Number.isFinite(i.fire) && (covered ? i.fire >= 0 : i.fire > 0), "Enter a FIRE number above $0.");
  check("customReturn", i.portfolio !== "custom" || (Number.isFinite(num("customReturn")) && num("customReturn") > -100),
    "Enter a custom annual return.");
  return problems;
}

// ---------- Formatting ----------

function setCard(id, { label, value, unit = "", sub = "", good = false }) {
  const card = $(id);
  if (label !== undefined) card.querySelector(".card-label").textContent = label;
  const v = card.querySelector(".card-value");
  v.textContent = value;
  if (unit) {
    const u = document.createElement("span");
    u.className = "unit";
    u.textContent = unit;
    v.append(u);
  }
  v.classList.toggle("is-good", good);
  card.querySelector(".card-sub").textContent = sub;
}

const cardAge = (age) => {
  const { big, unit } = formatAgeParts(age);
  return { value: big, unit };
};

// ---------- Update ----------

function update() {
  const values = readFormValues();
  saveValues(values);
  $("reset").disabled = isDefaultState(values, DEFAULTS);

  const i = readInputs();
  const isTarget = i.mode === "target";

  document.querySelectorAll("[data-mode]").forEach((el) => { el.hidden = el.dataset.mode !== i.mode; });
  $("customReturnField").hidden = i.portfolio !== "custom";
  $("portfolioNote").textContent = PORTFOLIOS.find((p) => p.id === i.portfolio)?.note ?? "Enter your own expected real (after-inflation) return.";

  const problems = validate(i);
  $("error").hidden = problems.length === 0;
  $("error").textContent = problems[0] ?? "";
  if (problems.length) return;

  // Balance needed at a retirement age: the FIRE-number field at the traditional
  // retirement age, shaped by the Social Security bridge at other ages.
  const fire = i.fire;
  const requiredAt = requiredBalanceFn(i, i.retirementAge, fire);
  const coastNow = coastTarget({ fire, annualReturn: i.annualReturn, age: i.age, retirementAge: i.retirementAge });
  const alreadyCoast = isCoastReached(i.balance, coastNow);
  const monthlyContribution = isTarget
    ? requiredMonthlyContribution({ ...i, fire: requiredAt(i.targetAge), retirementAge: i.targetAge })
    : i.monthlyContribution;
  const params = { ...i, monthlyContribution, fire, requiredAt };
  const coastAge = alreadyCoast ? i.age : findCoastAge(params);
  const fireAge = isTarget ? findFireAge(params) ?? i.targetAge : findFireAge(params);

  const coastCard = alreadyCoast
    ? { label: "CoastFIRE", value: "Reached ✓", good: true, sub: `You could stop contributing today and still retire at ${i.retirementAge}.` }
    : coastAge !== null
      ? { label: "CoastFIRE age", ...cardAge(coastAge), sub: `Then stop contributing and coast to ${i.retirementAge}.` }
      : { label: "CoastFIRE age", value: `Not by ${i.retirementAge}`, sub: "Contributions aren't enough to coast before retirement." };

  if (isTarget) {
    setCard("cardPrimary", {
      label: "Monthly contribution needed",
      value: money.format(monthlyContribution),
      unit: "/ mo",
      good: monthlyContribution === 0,
      sub: monthlyContribution === 0
        ? `Your current balance alone reaches your FIRE number by ${i.targetAge}${fireAge < i.targetAge - 1e-9 ? ` (on track for ${formatAge(fireAge)})` : ""}.`
        : `To fully retire at ${i.targetAge}.`,
    });
  } else {
    setCard("cardPrimary", fireAge !== null
      ? { label: "Full retirement age", ...cardAge(fireAge), good: fireAge === i.age,
          sub: fireAge === i.age ? "You've already hit your FIRE number." : `If you keep contributing ${money.format(i.monthlyContribution)}/mo.` }
      : { label: "Full retirement age", value: `Not by ${DEFAULT_MAX_AGE}`, sub: "Try a higher contribution or lower spending." });
  }
  setCard("cardSecondary", coastCard);

  // The FIRE number depends on the retirement age only when a benefit starts later.
  const fireCardAge = isTarget ? i.targetAge : fireAge ?? i.retirementAge;
  const fireNeeded = requiredAt(fireCardAge);
  setCard("cardFire", {
    label: i.benefit > 0 ? `FIRE number (retire at ${splitAge(fireCardAge).years})` : "FIRE number",
    value: money.format(fireNeeded),
    sub: `${money.format(i.spending)}/yr spending at a ${pct.format(i.swr)} withdrawal rate`
      + (i.taxRate > 0 ? `, ${pct.format(i.taxRate)} tax` : "")
      + (i.benefit > 0 ? ` · ${money.format(i.benefit)}/yr benefit from ${i.benefitAge}` : "")
      + (isTarget && fireAge !== null ? ` · reached at ${formatAge(fireAge)}` : ""),
  });

  const guidance = earlyAccessGuidance(isTarget ? i.targetAge : fireAge ?? Infinity);
  $("earlyNote").hidden = guidance === "none";
  $("earlyNote").textContent = EARLY_NOTES[guidance] ?? "";
  setCard("cardCoast", {
    value: money.format(coastNow),
    good: alreadyCoast,
    sub: alreadyCoast
      ? `You're ${money.format(i.balance - coastNow)} ahead.`
      : `You're ${money.format(coastNow - i.balance)} short at ${pct.format(i.annualReturn)} real return.`,
  });

  $("summary").innerHTML = summaryHtml({ ...i, monthlyContribution, fire, coastAge, fireAge, alreadyCoast });

  const endAge = chartEndAge({ age: i.age, retirementAge: i.retirementAge, fireAge });
  const series = buildSeries({ ...params, endAge });
  const milestones = [];
  if (!alreadyCoast && coastAge !== null) milestones.push({ x: coastAge, label: "Coast" });
  if (fireAge !== null) milestones.push({ x: fireAge, label: "FIRE" });
  drawChart(series, milestones);
  fillTable(series);
}

const EARLY_NOTES = {
  "rule-of-55": "Retiring at 55–59½? The Rule of 55 lets you withdraw from the 401(k) of the employer you leave in or after the year you turn 55 without the 10% early-withdrawal penalty.",
  "before-55": "Retiring before 55 means bridging to 59½ — for example with 72(t) substantially equal payments, a Roth conversion ladder, or taxable savings. This calculator doesn't model early-withdrawal penalties.",
};

function summaryHtml(s) {
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const b = (t) => `<strong>${esc(t)}</strong>`;
  const coast = s.alreadyCoast
    ? `You've already reached ${b("CoastFIRE")}: even with no more contributions, your balance should grow to ${b(money.format(s.fire))} by ${b(s.retirementAge)}.`
    : s.coastAge !== null
      ? `Contributing ${b(money.format(s.monthlyContribution) + "/mo")}, you hit CoastFIRE at ${b(formatAge(s.coastAge))} and could stop contributing and still retire at ${b(s.retirementAge)}.`
      : `At ${b(money.format(s.monthlyContribution) + "/mo")}, you won't reach CoastFIRE before ${b(s.retirementAge)}.`;
  const full = s.fireAge === null
    ? ` You wouldn't reach your full FIRE number of ${b(money.format(s.fire))} by ${DEFAULT_MAX_AGE}.`
    : s.fireAge === s.age
      ? ` You can already fully retire.`
      : ` Keep contributing and you can fully retire at ${b(formatAge(s.fireAge))}.`;
  return coast + full;
}

// ---------- Chart ----------

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Draws dashed vertical lines at milestone ages (CoastFIRE, FIRE).
const milestonePlugin = {
  id: "milestones",
  afterDatasetsDraw(c, _args, opts) {
    const { ctx, chartArea: area, scales: { x } } = c;
    for (const m of opts.items ?? []) {
      if (m.x < x.min || m.x > x.max) continue;
      const px = x.getPixelForValue(m.x);
      ctx.save();
      ctx.strokeStyle = opts.color;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(px, area.top);
      ctx.lineTo(px, area.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = opts.textColor;
      ctx.font = `600 11px ${getComputedStyle(document.body).fontFamily}`;
      ctx.textAlign = px > area.right - 40 ? "right" : "left";
      ctx.fillText(`${m.label} · ${splitAge(m.x).years}`, px + (ctx.textAlign === "left" ? 4 : -4), area.top + 12);
      ctx.restore();
    }
  },
};

function drawChart(series, milestones) {
  $("chartError").hidden = !!window.Chart;
  document.querySelector(".chart-wrap").hidden = !window.Chart;
  if (!window.Chart) return;
  const toPoints = (ys) => series.ages.map((x, k) => ({ x, y: ys[k] }));
  const datasets = [
    { label: "With monthly contributions", data: toPoints(series.withContrib), borderColor: cssVar("--series-contrib") },
    { label: "Current balance only", data: toPoints(series.noContrib), borderColor: cssVar("--series-current") },
    { label: "CoastFIRE target", data: toPoints(series.coastTarget), borderColor: cssVar("--series-coast"), borderDash: [6, 4] },
  ].map((d) => ({ ...d, backgroundColor: d.borderColor, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, pointHoverBorderWidth: 2, pointHoverBorderColor: cssVar("--surface"), tension: 0 }));

  if (chart) {
    chart.data.datasets.forEach((d, k) => { d.data = datasets[k].data; });
    chart.options.scales.x.max = series.ages.at(-1);
    chart.options.scales.x.min = series.ages[0];
    chart.options.plugins.milestones.items = milestones;
    chart.update("none");
    return;
  }

  const text2 = cssVar("--text-2");
  const grid = cssVar("--grid");
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  chart = new Chart($("chart"), {
    type: "line",
    data: { datasets },
    plugins: [milestonePlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: {
          type: "linear",
          min: series.ages[0],
          max: series.ages.at(-1),
          title: { display: true, text: "Age", color: text2 },
          ticks: { color: text2, stepSize: 5, precision: 0 },
          grid: { display: false },
          border: { color: grid },
        },
        y: {
          beginAtZero: true,
          ticks: { color: text2, callback: (v) => moneyCompact.format(v), maxTicksLimit: 6 },
          grid: { color: grid },
          border: { display: false },
        },
      },
      plugins: {
        milestones: { items: milestones, color: cssVar("--text-3"), textColor: text2 },
        legend: {
          position: "top",
          align: "start",
          labels: { color: cssVar("--text"), usePointStyle: true, pointStyle: "line", boxWidth: 24, padding: 16 },
        },
        tooltip: {
          backgroundColor: cssVar("--surface"),
          titleColor: cssVar("--text"),
          bodyColor: cssVar("--text"),
          borderColor: cssVar("--border"),
          borderWidth: 1,
          padding: 10,
          usePointStyle: true,
          callbacks: {
            title: (items) => `Age ${items[0].parsed.x}`,
            label: (item) => ` ${item.dataset.label}: ${money.format(item.parsed.y)}`,
            labelPointStyle: () => ({ pointStyle: "line", rotation: 0 }),
          },
        },
      },
    },
  });
}

function fillTable(series) {
  const rows = series.ages.map((a, k) =>
    `<tr><td>${a}</td><td>${money.format(series.noContrib[k])}</td><td>${money.format(series.withContrib[k])}</td><td>${money.format(series.coastTarget[k])}</td></tr>`);
  $("dataTable").tBodies[0].innerHTML = rows.join("");
}

// ---------- Start ----------

const saved = loadSaved();
applyFormValues(parseSavedState(saved, DEFAULTS, ALLOWED));
// Data saved before taxes/benefits existed holds a FIRE number that ignores them; re-derive it.
if (saved !== null && !savedKeys(saved).includes("taxRate")) syncFire();
if (window.Chart) update();
else window.addEventListener("load", update, { once: true });
