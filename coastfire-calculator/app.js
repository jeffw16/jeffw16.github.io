// UI wiring for the CoastFIRE calculator. All math lives in calc.js.
import {
  PORTFOLIOS,
  DEFAULT_PORTFOLIO_ID,
  DEFAULT_MAX_AGE,
  resolveReturn,
  resolveVolatility,
  convertContribution,
  DEFAULT_CONTRIBUTION,
  chartEndAge,
  buildSeries,
  splitAge,
} from "./calc.js?v=8c0d1dc4d1";
import {
  requiredBalance,
  spendingFromRequired,
  benefitCoversSpending,
  earlyAccessGuidance,
} from "./retirement.js?v=8c0d1dc4d1";
import { IRS_LIMITS } from "./limits.js?v=8c0d1dc4d1";
import { computeScenario, sensitivity } from "./scenario.js?v=8c0d1dc4d1";
import { createRiskRunner, describeRisk, riskTitle } from "./risk.js?v=8c0d1dc4d1";
import { SS_YEAR, EARLIEST_AGE, LATEST_AGE, COUNTED_YEARS, MIN_YEARS, estimateBenefit } from "./socialsecurity.js?v=8c0d1dc4d1";
import { TAX_YEAR, FILING_STATUSES, estimateRate } from "./tax.js?v=8c0d1dc4d1";
import { parseAmount, groupDigits, formatWithCaret, deleteAcrossComma, formatAge, formatAgeParts, formatAgeOrNote, contributionLabel } from "./format.js?v=8c0d1dc4d1";
import { STORAGE_KEY, serializeState, parseSavedState, isDefaultState, savedKeys, encodeQuery, decodeQuery } from "./persist.js?v=8c0d1dc4d1";

const $ = (id) => document.getElementById(id);
const form = $("inputs");

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const moneyCompact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });
const pct = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });
const moneyCompact2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 });
const amountFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

let chart = null;
// Saved inputs are only overwritten once the user edits something, so opening a
// shared link doesn't replace the viewer's own remembered numbers.
let persist = true;

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
const FIRE_DRIVERS = ["spending", "swr", "taxRate", "benefit", "benefitAge", "retirementAge", "portfolio", "returnModel", "customReturn", "customVolatility"];
for (const id of FIRE_DRIVERS) {
  $(id).addEventListener("input", syncFire);
  $(id).addEventListener("change", syncFire);
}
$("fire").addEventListener("input", () => {
  const spending = spendingFromRequired({ ...needAt(num("retirementAge")), required: num("fire") });
  if (Number.isFinite(spending)) setAmount("spending", spending);
});

// Switching $ <-> % converts the amounts using salary (or falls back to a typical value;
// 0 for the Mega Backdoor Roth amount).
let lastUnit = form.elements.contributionUnit.value;
for (const radio of form.elements.contributionUnit) {
  radio.addEventListener("change", () => {
    const to = form.elements.contributionUnit.value;
    const convert = (id, fallback) => {
      const converted = convertContribution({ amount: num(id), from: lastUnit, to, salary: num("salary") });
      const amount = Number.isFinite(converted) ? converted : fallback;
      $(id).value = groupDigits(String(to === "usd" ? Math.round(amount) : Math.round(amount * 100) / 100));
    };
    convert("contribution", DEFAULT_CONTRIBUTION[to]);
    convert("megaContribution", 0);
    lastUnit = to;
  });
}

$("reset").addEventListener("click", () => {
  applyFormValues(DEFAULTS);
  persist = true;
  update();
});

const onEdit = () => { persist = true; update(); };
form.addEventListener("input", onEdit);
form.addEventListener("change", onEdit);
form.addEventListener("submit", (e) => e.preventDefault());
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { chart?.destroy(); chart = null; update(); });


// ---------- Saved values ----------

// Form fields remembered in localStorage, by name.
const FIELDS = ["mode", "age", "balance", "contribution", "targetAge", "retirementAge", "salary", "contributionUnit", "matchRate", "matchCap", "raise", "spending", "swr", "taxRate", "benefit", "benefitAge", "fire", "portfolio", "returnModel", "customReturn", "customVolatility", "filingStatus", "stateTax", "rothShare", "ssEarnings", "ssStartAge", "megaBackdoor", "megaContribution"];
const ALLOWED = { mode: ["contribution", "target"], contributionUnit: ["usd", "pct"], megaBackdoor: ["off", "on"], returnModel: ["fixed", "montecarlo", "historical"], filingStatus: FILING_STATUSES.map((s) => s.id), portfolio: [...PORTFOLIOS.map((p) => p.id), "custom"] };

// Checkboxes are saved as "on" / "off".
const isCheckbox = (name) => form.elements[name].type === "checkbox";

function defaultValueOf(name) {
  if (name === "mode" || name === "contributionUnit") return [...form.elements[name]].find((r) => r.defaultChecked).value;
  if (isCheckbox(name)) return form.elements[name].defaultChecked ? "on" : "off";
  if (name === "portfolio") return DEFAULT_PORTFOLIO_ID;
  if (form.elements[name] instanceof HTMLSelectElement) return [...form.elements[name].options].find((o) => o.defaultSelected).value;
  return form.elements[name].defaultValue;
}

const DEFAULTS = Object.freeze(Object.fromEntries(FIELDS.map((n) => [n, defaultValueOf(n)])));

// How each field's text is validated in a shared link.
const KINDS = Object.fromEntries([
  ...[...form.querySelectorAll("[data-amount]")].map((el) => [el.name, "amount"]),
  ...[...form.querySelectorAll('input[type="number"]')].map((el) => [el.name, "number"]),
]);

function readFormValues() {
  return Object.fromEntries(FIELDS.map((n) => [n, isCheckbox(n) ? (form.elements[n].checked ? "on" : "off") : form.elements[n].value]));
}

function applyFormValues(values) {
  for (const n of FIELDS) {
    if (isCheckbox(n)) form.elements[n].checked = values[n] === "on";
    else form.elements[n].value = values[n];
  }
  lastUnit = form.elements.contributionUnit.value;
}

// Storage can be unavailable (private mode, blocked site data); the page works without it.
function loadSaved() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

// Keep the address bar in step with the inputs (only fields that differ from the defaults).
let urlTimer = null;
function scheduleUrlSync(values) {
  clearTimeout(urlTimer);
  urlTimer = setTimeout(() => {
    try { history.replaceState(null, "", location.pathname + encodeQuery(values, DEFAULTS, KINDS) + location.hash); } catch { /* ignore */ }
  }, 300);
}

function shareUrl(values) {
  const url = new URL(location.href);
  url.search = encodeQuery(values, DEFAULTS, KINDS);
  url.hash = "";
  return url.href;
}

function legacyCopy(text) {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.cssText = "position:fixed;opacity:0";
  document.body.append(area);
  area.select();
  try { return document.execCommand("copy"); } catch { return false; } finally { area.remove(); }
}

let copyTimer = null;
$("copyLink").addEventListener("click", async () => {
  const url = shareUrl(readFormValues());
  let ok = true;
  try { await navigator.clipboard.writeText(url); } catch { ok = legacyCopy(url); }
  $("copyLink").textContent = ok ? "Copied ✓" : "Copy failed";
  $("copyStatus").textContent = ok ? "Link copied" : "Couldn't copy the link";
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => { $("copyLink").textContent = "Copy link"; $("copyStatus").textContent = ""; }, 2000);
});

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
const CONTRIBUTION_HINT = $("contributionHint").textContent;
const CONTRIBUTION_HINT_MEGA = "Your pre-tax or Roth 401(k) deferral, up to the IRS limit. Add after-tax money under Mega Backdoor Roth.";

function readInputs() {
  const portfolio = $("portfolio").value;
  return {
    mode: form.elements.mode.value,
    age: num("age"),
    balance: num("balance"),
    contribution: num("contribution"),
    contributionUnit: form.elements.contributionUnit.value,
    megaBackdoor: $("megaBackdoor").checked,
    megaContribution: num("megaContribution"),
    salary: num("salary"),
    matchRate: numOr0("matchRate") / 100,
    matchCap: numOr0("matchCap") / 100,
    raise: numOr0("raise") / 100,
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
    returnModel: $("returnModel").value,
    volatility: resolveVolatility(portfolio, num("customVolatility") / 100),
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
    check("contribution", Number.isFinite(i.contribution) && i.contribution >= 0, "Enter a contribution (0 or more).");
    $("targetAge").setAttribute("aria-invalid", "false");
  } else {
    check("targetAge", Number.isFinite(i.targetAge) && i.targetAge > i.age && i.targetAge <= DEFAULT_MAX_AGE,
      "Target retirement age must be after your current age and at most 100.");
    $("contribution").setAttribute("aria-invalid", "false");
  }
  check("megaContribution", !i.megaBackdoor || (Number.isFinite(i.megaContribution) && i.megaContribution >= 0),
    "Enter a Mega Backdoor Roth contribution (0 or more).");
  check("salary", i.contributionUnit !== "pct" || i.salary > 0, "Enter your annual salary to contribute a percentage of it.");
  check("matchRate", i.matchRate >= 0 && i.matchRate <= 1, "Enter an employer match from 0% to 100%.");
  check("matchCap", i.matchCap >= 0 && i.matchCap <= 1, "Enter a match limit from 0% to 100% of salary.");
  check("raise", i.raise >= -0.05 && i.raise <= 0.1, "Enter yearly raises from -5% to 10%.");
  check("spending", Number.isFinite(i.spending) && i.spending > 0, "Enter your expected annual spending in retirement.");
  check("swr", Number.isFinite(i.swr) && i.swr > 0, "Enter a withdrawal rate above 0%.");
  check("taxRate", Number.isFinite(i.taxRate) && i.taxRate >= 0 && i.taxRate < 1, "Enter a tax rate from 0% to 60%.");
  check("stateTax", Number.isFinite(num("stateTax")) && num("stateTax") >= 0 && num("stateTax") <= 20, "Enter a state tax rate from 0% to 20%.");
  check("rothShare", Number.isFinite(num("rothShare")) && num("rothShare") >= 0 && num("rothShare") <= 100, "Enter a tax-free share from 0% to 100%.");
  check("benefit", Number.isFinite(i.benefit) && i.benefit >= 0, "Enter a benefit of $0 or more per year.");
  check("benefitAge", Number.isFinite(i.benefitAge) && i.benefitAge >= 50 && i.benefitAge <= DEFAULT_MAX_AGE, "Benefit start age must be between 50 and 100.");
  const covered = benefitCoversSpending({ spending: i.spending, benefit: i.benefit, benefitAge: i.benefitAge, retireAge: i.retirementAge });
  setFireLock(covered, i.benefitAge);
  check("fire", Number.isFinite(i.fire) && (covered ? i.fire >= 0 : i.fire > 0), "Enter a FIRE number above $0.");
  check("customReturn", i.portfolio !== "custom" || (Number.isFinite(num("customReturn")) && num("customReturn") > -100),
    "Enter a custom annual return.");
  check("customVolatility", i.portfolio !== "custom" || (num("customVolatility") >= 0 && num("customVolatility") <= 60),
    "Enter a yearly volatility from 0% to 60%.");
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

// ---------- Tax estimate ----------

const STATUS_LABEL = Object.fromEntries(FILING_STATUSES.map((s) => [s.id, s.label]));
const ratePercent = (rate) => `${(rate * 100).toFixed(1)}%`;
let taxEstimate = null;

/** The estimated rate for the current retirement inputs, or null while they're incomplete. */
function currentTaxEstimate(i) {
  const stateRate = num("stateTax") / 100;
  const taxFreeShare = num("rothShare") / 100;
  if (!(i.spending > 0) || !Number.isFinite(i.benefit) || !(stateRate >= 0 && stateRate <= 0.2) || !(taxFreeShare >= 0 && taxFreeShare <= 1)) return null;
  // The long stretch of retirement is after the benefit starts, so estimate that year; 65+ deduction applies by then.
  const age = i.benefit > 0 ? Math.max(i.retirementAge, i.benefitAge) : i.retirementAge;
  const over65 = age >= 65;
  const status = $("filingStatus").value;
  return { ...estimateRate({ spending: i.spending, benefit: i.benefit, status, over65, stateRate, taxFreeShare }), status, over65, stateRate, taxFreeShare };
}

function renderTax(i) {
  taxEstimate = currentTaxEstimate(i);
  const text = $("taxEstimateText");
  const use = $("useTaxEstimate");
  const apply = $("applyTax");
  if (!taxEstimate) {
    text.textContent = "";
    use.hidden = true;
    apply.disabled = true;
    $("taxRows").replaceChildren();
    return;
  }
  const { rate, status, stateRate } = taxEstimate;
  const matches = Math.abs(rate * 100 - num("taxRate")) < 0.05;
  const where = stateRate > 0 ? ` plus ${(stateRate * 100).toFixed(1).replace(/\.0$/, "")}% state tax` : "";
  text.textContent = `Estimated ${ratePercent(rate)} for ${STATUS_LABEL[status].toLowerCase()}${where}, from your spending and ${TAX_YEAR} federal rules.`;
  use.hidden = matches;
  use.textContent = `Use ${ratePercent(rate)}`;
  apply.disabled = matches;
  apply.title = matches ? "This rate is already applied" : "";
  if ($("taxDialog").open) fillTaxRows(i);
}

function fillTaxRows(i) {
  const { breakdown: b, rate, over65, taxFreeShare } = taxEstimate;
  const rows = [
    ["Spending you want after tax", money.format(i.spending)],
    ...(i.benefit > 0 ? [["Social Security / pension", money.format(i.benefit)]] : []),
    ["401(k) withdrawal needed", money.format(b.withdrawal)],
    ...(taxFreeShare > 0 ? [["Taxable part of withdrawal", money.format(b.taxableWithdrawal)]] : []),
    ...(i.benefit > 0 ? [["Taxable Social Security", money.format(b.taxableBenefit)]] : []),
    [`Standard deduction${over65 ? " (incl. age 65+)" : ""}`, money.format(b.deduction)],
    ["Taxable income", money.format(b.taxableIncome)],
    ["Federal tax", money.format(b.federal)],
    ...(b.state > 0 ? [["State tax", money.format(b.state)]] : []),
    ["Effective rate on withdrawals", ratePercent(rate)],
  ];
  $("taxRows").replaceChildren(...rows.map(([label, value], k) => {
    const row = document.createElement("div");
    if (k === rows.length - 1) row.className = "total";
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    row.append(dt, dd);
    return row;
  }));
  $("taxModalIntro").textContent = `${TAX_YEAR} federal brackets and standard deduction, applied to the year after your benefit starts. Everything here is an estimate, not tax advice.`;
  $("taxModalNote").textContent = i.benefit > 0
    ? "Your benefit is treated as Social Security, so part of it can be taxable. A pension would be fully taxable."
    : "";
}

function applyTaxEstimate() {
  if (!taxEstimate) return;
  const field = $("taxRate");
  field.value = String(Math.round(taxEstimate.rate * 1000) / 10);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

$("useTaxEstimate").addEventListener("click", applyTaxEstimate);

/** Open `dialogId` from `openId`; `closeIds` close it, as do Escape and a click on the backdrop. Hides the opener without <dialog> support. */
function wireDialog(dialogId, openId, closeIds, onOpen) {
  const dialog = $(dialogId);
  if (typeof dialog.showModal !== "function") { $(openId).hidden = true; return dialog; }
  $(openId).addEventListener("click", () => { dialog.showModal(); onOpen(); });
  for (const id of closeIds) $(id).addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
  return dialog;
}

wireDialog("taxDialog", "openTaxModal", ["closeTax", "closeTaxX"], () => fillTaxRows(readInputs()));
$("applyTax").addEventListener("click", () => { applyTaxEstimate(); $("taxDialog").close(); });

// ---------- Social Security estimate ----------

let ssEstimate = null;

function renderSs(i) {
  const dialog = $("ssDialog");
  const earnings = Number.isFinite(num("ssEarnings")) && num("ssEarnings") > 0 ? num("ssEarnings") : num("salary");
  ssEstimate = estimateBenefit({ annualEarnings: earnings, startAge: num("ssStartAge"), retirementAge: i.retirementAge, claimAge: i.benefitAge });
  if (!dialog.open) return;
  $("applySs").disabled = !ssEstimate || !ssEstimate.eligible;
  $("ssIntro").textContent = `${SS_YEAR} Social Security formula for your own retirement benefit, in today's dollars. An estimate, not your actual record.`;
  const rows = [];
  let note = "";
  if (!ssEstimate) {
    note = !(i.benefitAge >= EARLIEST_AGE && i.benefitAge <= LATEST_AGE)
      ? `Social Security can start between ${EARLIEST_AGE} and ${LATEST_AGE}. Change "Benefit starts at age" to estimate it.`
      : "Enter your typical yearly earnings (or a salary under Contributions) and the age you started working.";
  } else {
    const e = ssEstimate;
    rows.push(
      [`Years of earnings (up to ${COUNTED_YEARS} count)`, String(e.years)],
      ["Yearly earnings counted", money.format(e.countedEarnings)],
      ["Average monthly earnings", money.format(e.aime)],
      ["Monthly benefit at full retirement age (67)", money.format(e.pia)],
      [`Adjustment for claiming at ${i.benefitAge}`, `${(e.factor * 100).toFixed(1)}%`],
      ["Monthly benefit", money.format(e.monthly)],
      ["Yearly benefit", money.format(e.annual)],
    );
    note = e.eligible
      ? e.years < COUNTED_YEARS ? `Only ${e.years} years of earnings are counted; the other ${COUNTED_YEARS - e.years} of the ${COUNTED_YEARS} averaged are zeros, which lowers the benefit.` : ""
      : `Social Security needs at least ${MIN_YEARS} years of earnings, so this plan wouldn't qualify.`;
  }
  $("ssRows").replaceChildren(...rows.map(([label, value], k) => {
    const row = document.createElement("div");
    if (k === rows.length - 1) row.className = "total";
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    row.append(dt, dd);
    return row;
  }));
  $("ssNote").textContent = note + (note ? " " : "") + "Assumes steady earnings and a birth year of 1960 or later. Your statement at ssa.gov/myaccount is more accurate.";
}

wireDialog("ssDialog", "openSsModal", ["closeSs", "closeSsX"], () => renderSs(readInputs()));
$("applySs").addEventListener("click", () => {
  if (!ssEstimate?.eligible) return;
  setAmount("benefit", ssEstimate.annual);
  $("benefit").dispatchEvent(new Event("input", { bubbles: true }));
  $("ssDialog").close();
});

// ---------- Update ----------

function update() {
  const values = readFormValues();
  if (persist) saveValues(values);
  scheduleUrlSync(values);
  $("reset").disabled = isDefaultState(values, DEFAULTS);

  const i = readInputs();
  renderTax(i);
  renderSs(i);
  const isTarget = i.mode === "target";

  document.querySelectorAll("[data-mode]").forEach((el) => { el.hidden = el.dataset.mode !== i.mode; });
  const simulated = i.returnModel !== "fixed";
  $("customReturnField").hidden = i.portfolio !== "custom";
  $("customVolatilityField").hidden = !(i.returnModel === "montecarlo" && i.portfolio === "custom");
  $("cardRisk").hidden = !simulated;
  $("riskTitle").textContent = riskTitle(i.returnModel);
  $("portfolioNote").textContent = PORTFOLIOS.find((p) => p.id === i.portfolio)?.note ?? "Enter your own expected real (after-inflation) return.";

  const pctUnit = i.contributionUnit === "pct";
  const mega = i.megaBackdoor;
  $("contributionLabel").textContent = contributionLabel({ mega, pctUnit });
  $("contributionHint").textContent = mega ? CONTRIBUTION_HINT_MEGA : CONTRIBUTION_HINT;
  $("megaField").hidden = !mega;
  $("megaLabel").textContent = pctUnit ? "Mega Backdoor Roth (after-tax, % of salary)" : "Mega Backdoor Roth (after-tax) per month";
  for (const id of ["contributionAffix", "megaAffix"]) {
    const affix = $(id);
    if (pctUnit) { delete affix.dataset.prefix; affix.dataset.suffix = "%"; }
    else { delete affix.dataset.suffix; affix.dataset.prefix = "$"; }
  }
  $("matchHint").hidden = !((i.matchRate > 0 || i.matchCap > 0) && !(i.salary > 0));

  const problems = validate(i);
  $("error").hidden = problems.length === 0;
  $("error").textContent = problems[0] ?? "";
  if (problems.length) { cancelRisk(); return; }

  const scenario = computeScenario(i);
  if (scenario.unreachable) {
    $("error").hidden = false;
    $("error").textContent = "That target can't be reached with these assumptions.";
    cancelRisk();
    return;
  }
  const { fire, requiredAt, coastNow, alreadyCoast, amount, schedule, monthlyContribution, matchMonthly, megaMonthly, params, coastAge, fireAge, coastMonth, over, megaRoom, overAdditions, rothShare } = scenario;
  const amountText = (value, monthly) => (pctUnit
    ? `${amountFormat.format(value)}% of salary (${money.format(monthly)}/mo)`
    : `${money.format(monthly)}/mo`);
  const megaText = amountText(i.megaContribution, megaMonthly);
  const hasMega = megaMonthly > 0;
  const contributionText = hasMega
    ? `${amountText(amount, monthlyContribution)} basic + ${megaText} Mega Backdoor Roth`
    : amountText(amount, monthlyContribution);

  $("limitWarning").hidden = !over;
  if (over) {
    $("limitWarning").textContent = `Your ${mega ? "basic " : ""}contributions reach ${money.format(over.annual)}/yr at age ${over.age}, above the ${IRS_LIMITS.year} 401(k) limit of ${money.format(over.limit)}/yr for that age. Consider ${mega ? "moving the rest to Mega Backdoor Roth contributions, " : ""}an IRA or taxable account for the rest.`;
  }
  $("megaWarning").hidden = !overAdditions;
  if (overAdditions) {
    $("megaWarning").textContent = `Your Mega Backdoor Roth contributions reach ${money.format(overAdditions.afterTax)}/yr at age ${overAdditions.age}, above the ${money.format(overAdditions.room)}/yr left that year under the ${IRS_LIMITS.year} limit of ${money.format(overAdditions.limit)}/yr on total contributions (basic, match and after-tax).`;
  }
  $("megaHint").textContent = megaRoom === null ? "" : megaRoom > 0
    ? `Room this year: ${money.format(megaRoom)}/yr (${money.format(megaRoom / 12)}/mo) under the ${IRS_LIMITS.year} ${money.format(IRS_LIMITS.annualAdditions)} limit, after your basic contribution and match. Not matched by your employer.`
    : `No room this year: your basic contribution and match already use the ${IRS_LIMITS.year} ${money.format(IRS_LIMITS.annualAdditions)} limit.`;

  const coastCard = alreadyCoast
    ? { label: "CoastFIRE", value: "Reached ✓", good: true, sub: `You could stop contributing today and still retire at ${i.retirementAge}.` }
    : coastAge !== null
      ? { label: "CoastFIRE age", ...cardAge(coastAge), sub: `Then stop contributing and coast to ${i.retirementAge}.` }
      : { label: "CoastFIRE age", value: `Not by ${i.retirementAge}`, sub: "Contributions aren't enough to coast before retirement." };

  if (isTarget) {
    setCard("cardPrimary", {
      label: contributionLabel({ mega, pctUnit, needed: true }),
      value: pctUnit ? `${amountFormat.format(amount)}%` : money.format(amount),
      unit: pctUnit ? "of salary" : "/ mo",
      good: amount === 0,
      sub: amount === 0
        ? `Your current balance${hasMega ? " and Mega Backdoor Roth" : ""} alone reach${hasMega ? "" : "es"} your FIRE number by ${i.targetAge}${fireAge < i.targetAge - 1e-9 ? ` (on track for ${formatAge(fireAge)})` : ""}.`
        : [`To fully retire at ${i.targetAge}.`,
            pctUnit ? `That's ${money.format(monthlyContribution)}/mo to start.` : "",
            matchMonthly > 0 ? `Plus ${money.format(matchMonthly)}/mo employer match.` : "",
            hasMega ? `Plus your ${megaText} Mega Backdoor Roth.` : "",
            i.raise !== 0 ? `Grows ${pct.format(i.raise)}/yr.` : ""].filter(Boolean).join(" "),
    });
  } else {
    setCard("cardPrimary", fireAge !== null
      ? { label: "Full retirement age", ...cardAge(fireAge), good: fireAge === i.age,
          sub: fireAge === i.age ? "You've already hit your FIRE number." : `If you keep contributing ${contributionText}${matchMonthly > 0 ? ` plus ${money.format(matchMonthly)}/mo match` : ""}.` }
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

  $("summary").innerHTML = summaryHtml({ ...i, contributionText, fire, coastAge, fireAge, alreadyCoast, rothShare });

  const endAge = chartEndAge({ age: i.age, retirementAge: i.retirementAge, fireAge });
  const series = buildSeries({ ...params, endAge, coastMonth, afterTax: hasMega ? schedule.afterTax : null });
  const milestones = [];
  if (!alreadyCoast && coastAge !== null) milestones.push({ x: coastAge, label: "Coast" });
  if (fireAge !== null) milestones.push({ x: fireAge, label: "FIRE" });
  chartContext = { series, milestones, scenario, inputs: i };
  drawChart(series, milestones, simulated ? lastBand : null);
  fillTable(series);
  fillSensitivity(i, sensitivity(i));
  if (simulated) requestRisk(i);
  else cancelRisk();
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
      ? `Contributing ${b(s.contributionText)}, you hit CoastFIRE at ${b(formatAge(s.coastAge))} and could stop contributing and still reach ${b(moneyCompact2.format(s.fire))} by ${b(s.retirementAge)}.`
      : `At ${b(s.contributionText)}, you won't reach CoastFIRE before ${b(s.retirementAge)}.`;
  const full = s.fireAge === null
    ? ` You wouldn't reach your full FIRE number of ${b(money.format(s.fire))} by ${DEFAULT_MAX_AGE}.`
    : s.fireAge === s.age
      ? ` You can already fully retire.`
      : ` Keep contributing and you can fully retire at ${b(formatAge(s.fireAge))}.`;
  const roth = s.rothShare > 0
    ? ` About ${b(pct.format(s.rothShare))} of your balance by then would be Mega Backdoor Roth money, tax-free in retirement (count it in the tax-free share under Fine-tune).`
    : "";
  return coast + full + roth;
}

// ---------- Simulated ups and downs ----------

// The simulation runs in a worker (about 50-100 ms of work), debounced while the
// user types. If workers aren't available it runs on the main thread instead.
let chartContext = null;   // what the chart was last drawn from
let lastBand = null;       // last percentile band, kept while a new one computes
let riskSeq = 0;
let riskTimer = null;
let riskWorker = null;
let workerFailed = false;
let syncRunner = null;

function cancelRisk() {
  clearTimeout(riskTimer);
  riskSeq++;
  lastBand = null;
  $("cardRisk").classList.remove("is-busy");
}

function requestRisk(inputs) {
  clearTimeout(riskTimer);
  const id = ++riskSeq;
  $("cardRisk").classList.add("is-busy");
  riskTimer = setTimeout(() => dispatchRisk(id, inputs), 150);
}

function dispatchRisk(id, inputs) {
  const worker = getWorker(id, inputs);
  if (worker) {
    worker.postMessage({ id, inputs });
    return;
  }
  syncRunner ??= createRiskRunner();
  applyRisk(id, syncRunner(inputs), inputs);
}

function getWorker(id, inputs) {
  if (workerFailed) return null;
  if (riskWorker) return riskWorker;
  try {
    riskWorker = new Worker(new URL("./mc-worker.js?v=8c0d1dc4d1", import.meta.url), { type: "module" });
    riskWorker.onmessage = (event) => applyRisk(event.data.id, event.data.risk, chartContext?.inputs);
    riskWorker.onerror = () => {
      workerFailed = true;
      riskWorker = null;
      dispatchRisk(riskSeq, chartContext?.inputs ?? inputs);
    };
  } catch {
    workerFailed = true;
    return null;
  }
  return riskWorker;
}

function applyRisk(id, risk, inputs) {
  if (id !== riskSeq || !chartContext || risk.unreachable) return; // a newer request superseded this one
  $("cardRisk").classList.remove("is-busy");
  const { rows, hint } = describeRisk(inputs, chartContext.scenario, risk);
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  $("riskList").innerHTML = rows
    .map((r) => `<div><dt>${esc(r.label)}</dt><dd>${esc(r.value)}</dd>${r.note ? `<p class="risk-note">${esc(r.note)}</p>` : ""}</div>`)
    .join("");
  $("riskHint").textContent = hint;
  lastBand = risk.band;
  drawChart(chartContext.series, chartContext.milestones, lastBand);
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

// Legend order (dataset order differs: see the comment in drawChart).
const LEGEND_ORDER = [
  "With monthly contributions",
  "With contributions (median)",
  "Current balance only",
  "Contribute until coast, then stop",
  "Mega Backdoor Roth part",
  "CoastFIRE target",
  "Likely range (10th–90th percentile)",
];

function drawChart(series, milestones, band = null) {
  $("chartError").hidden = !!window.Chart;
  document.querySelector(".chart-wrap").hidden = !window.Chart;
  if (!window.Chart) return;
  const toPoints = (ys) => series.ages.map((x, k) => ({ x, y: ys[k] }));
  const hasPath = Boolean(series.coastPath);
  const n = series.ages.length;
  // With simulated returns the contribution line is the median path, with a band around it.
  const contribLine = band ? band.p50.slice(0, n) : series.withContrib;
  // Chart.js draws the first dataset on top, so the coast path comes before the
  // current-balance line (they coincide once you've already coasted); the
  // legend sort below puts it after.
  const datasets = [
    { label: band ? "With contributions (median)" : "With monthly contributions", data: toPoints(contribLine), borderColor: cssVar("--series-contrib") },
    { label: "Contribute until coast, then stop", data: hasPath ? toPoints(series.coastPath) : [], borderColor: cssVar("--series-coastpath"), borderDash: [2, 4], borderWidth: 3, borderCapStyle: "round" },
    { label: "Current balance only", data: toPoints(series.noContrib), borderColor: cssVar("--series-current") },
    { label: "CoastFIRE target", data: toPoints(series.coastTarget), borderColor: cssVar("--series-coast"), borderDash: [6, 4] },
    { label: "Mega Backdoor Roth part", data: series.afterTaxPart ? toPoints(series.afterTaxPart) : [], borderColor: cssVar("--series-mega") },
    // Band: the 90th percentile fills down to the 10th (the next dataset). Drawn last, so under the lines.
    { label: "Likely range (10th–90th percentile)", tooltipLabel: "90th percentile", data: band ? toPoints(band.p90.slice(0, n)) : [], borderColor: "transparent", backgroundColor: cssVar("--band"), fill: "+1", borderWidth: 0 },
    { label: "10th percentile", tooltipLabel: "10th percentile", data: band ? toPoints(band.p10.slice(0, n)) : [], borderColor: "transparent", backgroundColor: "transparent", fill: false, borderWidth: 0 },
  ].map((d) => ({ borderWidth: 2, backgroundColor: d.borderColor, pointRadius: 0, pointHoverRadius: 5, pointHoverBorderWidth: 2, pointHoverBorderColor: cssVar("--surface"), tension: 0, ...d }));

  // The 90th percentile can dwarf everything else; cap the axis near the main lines (the band is clipped).
  const yMax = band ? 1.6 * Math.max(...contribLine, ...series.coastTarget, ...series.noContrib) : undefined;

  if (chart) {
    chart.options.scales.y.max = yMax;
    chart.data.datasets.forEach((d, k) => { d.data = datasets[k].data; d.label = datasets[k].label; });
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
          max: yMax,
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
          labels: {
            color: cssVar("--text"), usePointStyle: true, pointStyle: "line", boxWidth: 24, padding: 16,
            // Hide entries with no data (no coast path, no band) and the band's lower edge.
            filter: (item, data) => data.datasets[item.datasetIndex].data.length > 0 && item.text !== "10th percentile",
            sort: (a, b) => LEGEND_ORDER.indexOf(a.text) - LEGEND_ORDER.indexOf(b.text),
          },
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
            label: (item) => ` ${item.dataset.tooltipLabel ?? item.dataset.label}: ${money.format(item.parsed.y)}`,
            labelPointStyle: () => ({ pointStyle: "line", rotation: 0 }),
          },
        },
      },
    },
  });
}

function fillTable(series) {
  const cell = (v) => (v === undefined ? "—" : money.format(v));
  $("megaColumn").hidden = !series.afterTaxPart;
  const megaCell = (k) => (series.afterTaxPart ? `<td>${cell(series.afterTaxPart[k])}</td>` : "");
  const rows = series.ages.map((a, k) =>
    `<tr><td>${a}</td><td>${cell(series.noContrib[k])}</td><td>${cell(series.withContrib[k])}</td><td>${cell(series.coastPath?.[k])}</td><td>${cell(series.coastTarget[k])}</td>${megaCell(k)}</tr>`);
  $("dataTable").tBodies[0].innerHTML = rows.join("");
}

// "If returns are different": the key results at the chosen return ±1%.
function fillSensitivity(i, rows) {
  const isTarget = i.mode === "target";
  const header = rows.map((r, k) => `<th scope="col">${k === 1 ? "As chosen" : `${pct.format(Math.abs(r.delta))} ${r.delta < 0 ? "lower" : "higher"}`} (${pct.format(r.rate)})</th>`).join("");
  $("sensitivity").tHead.innerHTML = `<tr><td></td>${header}</tr>`;
  const row = (label, cellOf) => `<tr><th scope="row">${label}</th>${rows.map((r) => `<td>${r.unreachable ? "—" : cellOf(r)}</td>`).join("")}</tr>`;
  const body = isTarget
    ? [row(contributionLabel({ mega: i.megaBackdoor, pctUnit: i.contributionUnit === "pct", needed: true }),
        (r) => (i.contributionUnit === "pct" ? `${amountFormat.format(r.amount)}% of salary` : `${money.format(r.amount)}/mo`))]
    : [
        row("CoastFIRE age", (r) => (r.alreadyCoast ? "Reached ✓" : formatAgeOrNote(r.coastAge, `Not by ${i.retirementAge}`))),
        row("Full retirement age", (r) => formatAgeOrNote(r.fireAge, `Not by ${DEFAULT_MAX_AGE}`)),
      ];
  $("sensitivity").tBodies[0].innerHTML = body.join("");
}

// ---------- Start ----------

// A link with parameters defines the whole scenario; otherwise use saved inputs, then defaults.
const fromLink = decodeQuery(location.search, DEFAULTS, ALLOWED, KINDS);
if (fromLink) {
  persist = false;
  applyFormValues(fromLink);
  if (!new URLSearchParams(location.search).has("fire")) syncFire();
} else {
  const saved = loadSaved();
  applyFormValues(parseSavedState(saved, DEFAULTS, ALLOWED));
  // Data saved before taxes/benefits existed holds a FIRE number that ignores them; re-derive it.
  if (saved !== null && !savedKeys(saved).includes("taxRate")) syncFire();
}
if (window.Chart) update();
else window.addEventListener("load", update, { once: true });
