import { test, expect, URL_PATH, CHART_JS } from "./fixtures.js";
import {
  coastTarget, findCoastAge, findFireAge, requiredMonthlyContribution,
} from "../coastfire-calculator/calc.js";
import { requiredBalance, requiredBalanceFn } from "../coastfire-calculator/retirement.js";
import { formatAge } from "../coastfire-calculator/format.js";

const base = { age: 30, balance: 50_000, annualReturn: 0.07, retirementAge: 65 };
// Default assumptions: $40k spending, 4% withdrawal, 10% tax, no benefit.
const need = { spending: 40_000, taxRate: 0.1, swr: 0.04, benefit: 0, benefitAge: 67, annualReturn: 0.07 };
const fire = Math.round(requiredBalance({ ...need, retireAge: 65 })); // 1,111,111
const requiredAt = requiredBalanceFn(need, 65, fire);
const money = (n) => `$${Math.round(n).toLocaleString("en-US")}`;

test.beforeEach(async ({ page }) => {
  await page.goto(URL_PATH);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator("#cardPrimary .card-value")).not.toBeEmpty();
});

// Cards render "60" and "years, 6 months" as separate spans (spaced by CSS), so
// the DOM text has no space after the number.
const ageText = (age) => new RegExp(formatAge(age).replace(/\s+/g, "\\s*"));
const card = (page, id) => page.locator(`#${id} .card-value`);

test("default load shows the model's results", async ({ page }) => {
  const coastAge = findCoastAge({ ...base, monthlyContribution: 500, fire });
  const fireAge = findFireAge({ ...base, monthlyContribution: 500, fire, requiredAt });
  await expect(page.locator("#cardPrimary .card-label")).toHaveText("Full retirement age");
  await expect(page.locator("#cardPrimary")).toContainText(ageText(fireAge));
  await expect(page.locator("#cardSecondary")).toContainText(ageText(coastAge));
  await expect(card(page, "cardFire")).toHaveText(money(fire));
  await expect(card(page, "cardCoast")).toHaveText(money(coastTarget({ fire, annualReturn: 0.07, age: 30, retirementAge: 65 })));
  // Pinned values for the default inputs.
  await expect(card(page, "cardFire")).toHaveText("$1,111,111");
  await expect(card(page, "cardCoast")).toHaveText("$104,070");
  await expect(page.locator("#cardPrimary")).toContainText(/61\s*years, 11 months/);
  await expect(page.locator("#cardSecondary")).toContainText(/44\s*years/);
});

test("target mode shows the contribution needed to retire at 55", async ({ page }) => {
  await page.locator('input[name="mode"][value="target"]').check();
  const needed = requiredMonthlyContribution({ ...base, fire, retirementAge: 55 });
  await expect(page.locator("#cardPrimary .card-label")).toHaveText("Monthly contribution needed");
  await expect(card(page, "cardPrimary")).toContainText(money(needed));
  await expect(card(page, "cardPrimary")).toContainText("$1,072");
  await expect(page.locator("#targetAge")).toBeVisible();
  await expect(page.locator("#contribution")).toBeHidden();
});

test.describe("comma-formatted dollar inputs", () => {
  test("typing digits adds commas", async ({ page }) => {
    const balance = page.locator("#balance");
    await balance.fill("");
    await balance.pressSequentially("1234567");
    await expect(balance).toHaveValue("1,234,567");
  });

  test("Backspace right after a comma deletes the digit before it", async ({ page }) => {
    const balance = page.locator("#balance"); // 50,000
    await balance.focus();
    await balance.evaluate((el) => el.setSelectionRange(3, 3)); // after the comma
    await page.keyboard.press("Backspace");
    await expect(balance).toHaveValue("5,000");
  });

  test("Delete right before a comma deletes the digit after it", async ({ page }) => {
    const balance = page.locator("#balance"); // 50,000
    await balance.focus();
    await balance.evaluate((el) => el.setSelectionRange(2, 2)); // before the comma
    await page.keyboard.press("Delete");
    await expect(balance).toHaveValue("5,000");
  });

  test("Backspace from the end never sticks on a comma", async ({ page }) => {
    const balance = page.locator("#balance");
    await balance.fill("1,234,567");
    await balance.focus();
    await page.keyboard.press("End");
    const seen = [];
    for (let k = 0; k < 7; k++) {
      await page.keyboard.press("Backspace");
      seen.push(await balance.inputValue());
    }
    expect(seen).toEqual(["123,456", "12,345", "1,234", "123", "12", "1", ""]);
  });

  test("typing in the middle keeps the caret after the typed digit", async ({ page }) => {
    const balance = page.locator("#balance"); // 50,000
    await balance.focus();
    await balance.evaluate((el) => el.setSelectionRange(1, 1));
    await page.keyboard.type("1");
    await expect(balance).toHaveValue("510,000");
    expect(await balance.evaluate((el) => el.selectionStart)).toBe(2);
  });
});

test("spending and FIRE number stay in sync", async ({ page }) => {
  await page.locator("#spending").fill("60,000");
  await expect(page.locator("#fire")).toHaveValue("1,666,667");
  await page.locator("#fire").fill("2,000,000");
  await expect(page.locator("#spending")).toHaveValue("72,000");
  await expect(card(page, "cardFire")).toHaveText("$2,000,000");
});

test("a benefit that covers spending locks the FIRE number at $0", async ({ page }) => {
  await page.locator("#benefit").fill("45,000");
  await page.locator("#benefitAge").fill("62");
  await expect(page.locator("#fire")).toHaveValue("0");
  await expect(page.locator("#fire")).toHaveJSProperty("readOnly", true);
  await expect(page.locator("#fireHint")).toContainText("Your benefit covers your spending");
  // Needed at 65 is $0, so CoastFIRE is reached; the FIRE card shows the larger
  // amount needed to retire earlier, before the benefit starts.
  await expect(card(page, "cardCoast")).toHaveText("$0");
  await expect(page.locator("#cardSecondary")).toContainText("Reached");
  await expect(page.locator("#cardFire .card-label")).toContainText("FIRE number (retire at");
  await page.locator("#benefit").fill("10,000");
  await expect(page.locator("#fire")).toHaveJSProperty("readOnly", false);
  await expect(page.locator("#fire")).not.toHaveValue("0");
});

test("a later benefit raises the FIRE number when retiring before it starts", async ({ page }) => {
  await page.locator("#benefit").fill("20,000");
  await page.locator("#benefitAge").fill("67");
  const expected = Math.round(requiredBalance({ ...need, benefit: 20_000, retireAge: 65 }));
  await expect(page.locator("#fire")).toHaveValue(expected.toLocaleString("en-US"));
  await expect(page.locator("#cardFire .card-label")).toContainText("FIRE number (retire at");
});

test("early-access notes follow the retirement age", async ({ page }) => {
  const note = page.locator("#earlyNote");
  await page.locator('input[name="mode"][value="target"]').check();
  await page.locator("#targetAge").fill("57");
  await expect(note).toContainText("Rule of 55");
  await page.locator("#targetAge").fill("50");
  await expect(note).toContainText("72(t)");
  await page.locator("#targetAge").fill("60");
  await expect(note).toBeHidden();
});

test("custom portfolio reveals the custom return field", async ({ page }) => {
  await expect(page.locator("#customReturnField")).toBeHidden();
  await page.locator("#portfolio").selectOption("custom");
  await expect(page.locator("#customReturnField")).toBeVisible();
});

test("reset restores the defaults and disables itself", async ({ page }) => {
  const reset = page.locator("#reset");
  await expect(reset).toBeDisabled();
  await page.locator("#age").fill("41");
  await page.locator("#balance").fill("123,456");
  await expect(reset).toBeEnabled();
  await reset.click();
  await expect(page.locator("#age")).toHaveValue("30");
  await expect(page.locator("#balance")).toHaveValue("50,000");
  await expect(reset).toBeDisabled();
});

test("inputs survive a reload", async ({ page }) => {
  await page.locator("#age").fill("41");
  await page.locator("#balance").fill("123,456");
  await page.reload();
  await expect(page.locator("#age")).toHaveValue("41");
  await expect(page.locator("#balance")).toHaveValue("123,456");
});

test("chart is drawn and the table view lists every series", async ({ page }) => {
  await expect(page.locator("#chart")).toBeVisible();
  await page.getByText("Show as table").click();
  await expect(page.locator("#dataTable thead th:visible")).toHaveCount(5);
  expect(await page.locator("#dataTable tbody tr").count()).toBeGreaterThan(10);
});

for (const scheme of ["light", "dark"]) {
  test(`renders in ${scheme} mode with no horizontal scroll on a phone`, async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: scheme, viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.route("https://cdn.jsdelivr.net/npm/chart.js@4.4.1/**", async (route) =>
      route.fulfill({ path: new URL("../node_modules/chart.js/dist/chart.umd.js", import.meta.url).pathname, contentType: "text/javascript" }));
    await page.goto(URL_PATH);
    await expect(page.locator("#cardFire .card-value")).toHaveText("$1,111,111");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
    await context.close();
  });
}

test("results and table still work when Chart.js fails to load", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort());
  await page.goto(URL_PATH);
  await expect(page.locator("#chartError")).toBeVisible();
  await expect(page.locator(".chart-wrap")).toBeHidden();
  await expect(card(page, "cardFire")).toHaveText("$1,111,111");
  await context.close();
});

const unit = (page, value) => page.locator(`input[name="contributionUnit"][value="${value}"]`).check();

test.describe("contributions", () => {
  test("the unit switch comes before the first contribution field and shows in both modes", async ({ page }) => {
    const before = await page.evaluate(() => {
      const radio = document.querySelector('input[name="contributionUnit"]');
      return !!(radio.compareDocumentPosition(document.getElementById("contribution")) & Node.DOCUMENT_POSITION_FOLLOWING)
        && !document.getElementById("contributionsSection").contains(radio);
    });
    expect(before).toBe(true);
    await page.locator('input[name="mode"][value="target"]').check();
    await expect(page.locator('label:has(input[name="contributionUnit"][value="pct"])')).toBeVisible();
  });

  test("switching units never dims the risk card", async ({ page }) => {
    await page.locator("#returnModel").selectOption("montecarlo");
    await expect(page.locator("#riskList > div")).toHaveCount(3);
    await expect(page.locator("#cardRisk")).not.toHaveClass(/is-busy/);
    await page.evaluate(() => {
      window.busySeen = false;
      new MutationObserver(() => { if (document.getElementById("cardRisk").classList.contains("is-busy")) window.busySeen = true; })
        .observe(document.getElementById("cardRisk"), { attributes: true, attributeFilter: ["class"] });
    });
    await page.locator("#salary").fill("120,000");
    await expect(page.locator("#cardRisk")).not.toHaveClass(/is-busy/);
    await page.evaluate(() => { window.busySeen = false; });
    await unit(page, "pct");
    await expect(page.locator("#contribution")).toHaveValue("5");
    await unit(page, "usd");
    await expect(page.locator("#contribution")).toHaveValue("500");
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.busySeen)).toBe(false);
  });

  test("switching $ <-> % converts the amount using salary", async ({ page }) => {
    await page.locator("#salary").fill("120,000");
    await unit(page, "pct");
    await expect(page.locator("#contribution")).toHaveValue("5");
    await expect(page.locator("#contributionLabel")).toHaveText("Contribution (% of salary)");
    await expect(page.locator("#contributionAffix")).toHaveAttribute("data-suffix", "%");
    await unit(page, "usd");
    await expect(page.locator("#contribution")).toHaveValue("500");
    await expect(page.locator("#contributionAffix")).toHaveAttribute("data-prefix", "$");
  });

  test("percent without a salary asks for one", async ({ page }) => {
    await unit(page, "pct");
    await expect(page.locator("#error")).toContainText("annual salary");
    await page.locator("#salary").fill("100,000");
    await expect(page.locator("#error")).toBeHidden();
  });

  test("target mode shows the employer match and a lower employee amount", async ({ page }) => {
    await page.locator('input[name="mode"][value="target"]').check();
    const without = await card(page, "cardPrimary").innerText();
    await page.locator("#salary").fill("120,000");
    await page.locator("#matchRate").fill("100");
    await page.locator("#matchCap").fill("5");
    await expect(page.locator("#cardPrimary .card-sub")).toContainText("employer match");
    const dollars = (text) => Number(text.match(/\$([\d,]+)/)[1].replace(/,/g, ""));
    expect(dollars(await card(page, "cardPrimary").innerText())).toBeLessThan(dollars(without));
  });

  test("target mode solves in percent of salary", async ({ page }) => {
    await page.locator('input[name="mode"][value="target"]').check();
    await page.locator("#salary").fill("120,000");
    await unit(page, "pct");
    await expect(page.locator("#cardPrimary .card-label")).toHaveText("Contribution needed");
    await expect(card(page, "cardPrimary")).toContainText(/\d+(\.\d+)?%/);
  });

  test("warns when contributions exceed the IRS limit, in both modes", async ({ page }) => {
    const warning = page.locator("#limitWarning");
    await expect(warning).toBeHidden();
    await page.locator("#contribution").fill("3,000");
    await expect(warning).toContainText("$24,500");
    await page.locator("#contribution").fill("1,000");
    await expect(warning).toBeHidden();

    await page.locator('input[name="mode"][value="target"]').check();
    await page.locator("#balance").fill("0");
    await page.locator("#targetAge").fill("35");
    await expect(warning).toBeVisible();
    await page.locator("#targetAge").fill("55");
    await expect(warning).toBeHidden();
  });

  test("raises are saved and reset", async ({ page }) => {
    await page.locator("#raise").fill("3");
    await page.reload();
    await expect(page.locator("#raise")).toHaveValue("3");
    await page.locator("#reset").click();
    await expect(page.locator("#raise")).toHaveValue("0");
  });
});

test.describe("IRA, HSA and employer contributions", () => {
  test("IRA/HSA money adds to the plan but isn't matched", async ({ page }) => {
    await page.locator("#salary").fill("120,000");
    await page.locator("#matchRate").fill("100");
    await page.locator("#matchCap").fill("10");
    const sub = page.locator("#cardPrimary .card-sub");
    await expect(sub).toContainText("$500/mo plus $500/mo match");
    const before = await page.locator("#cardPrimary").innerText();
    await page.locator("#otherContribution").fill("300");
    await expect(sub).toContainText("$500/mo + $300/mo IRA/HSA plus $500/mo match");
    expect(await page.locator("#cardPrimary").innerText()).not.toBe(before);
  });

  test("IRA/HSA money doesn't trigger the workplace-plan limit", async ({ page }) => {
    await page.locator("#contribution").fill("2,000");
    await page.locator("#otherContribution").fill("1,000");
    await expect(page.locator("#limitWarning")).toBeHidden();
  });

  test("an employer contribution needs no employee contribution", async ({ page }) => {
    await page.locator("#contribution").fill("0");
    await page.locator("#employerContribution").fill("5");
    await expect(page.locator("#employerHint")).toBeVisible();
    await page.locator("#salary").fill("120,000");
    await expect(page.locator("#employerHint")).toBeHidden();
    // 5% of $120,000 is the default $500/mo, so the default result.
    await expect(page.locator("#cardPrimary")).toContainText(/61\s*years, 11 months/);
    await expect(page.locator("#cardPrimary .card-sub")).toContainText("$0/mo plus $500/mo employer contribution");
  });

  test("target mode holds IRA/HSA and employer money fixed", async ({ page }) => {
    await page.locator('input[name="mode"][value="target"]').check();
    await expect(card(page, "cardPrimary")).toContainText("$1,072");
    await page.locator("#otherContribution").fill("72");
    await expect(card(page, "cardPrimary")).toContainText("$1,000");
    await expect(page.locator("#cardPrimary .card-sub")).toContainText("Plus your $72/mo IRA/HSA.");
    await page.locator("#salary").fill("120,000");
    await page.locator("#employerContribution").fill("100");
    await expect(card(page, "cardPrimary")).toHaveText("$0/ mo");
    await expect(page.locator("#cardPrimary .card-sub")).toContainText("Your current balance, IRA/HSA contributions and employer contribution alone reach");
  });

  test("switching to % of salary converts the IRA/HSA amount", async ({ page }) => {
    await page.locator("#salary").fill("120,000");
    await page.locator("#otherContribution").fill("500");
    await unit(page, "pct");
    await expect(page.locator("#otherContribution")).toHaveValue("5");
    await expect(page.locator("#otherLabel")).toHaveText("IRA, HSA and other accounts (% of salary)");
  });
});

test.describe("Mega Backdoor Roth", () => {
  const mega = (page) => page.locator("#megaBackdoor");
  const dollars = (text) => Number(text.match(/\$([\d,]+)/)[1].replace(/,/g, ""));

  test("is off by default and shows a separate after-tax field when turned on", async ({ page }) => {
    await expect(page.locator("#megaContribution")).toBeHidden();
    await expect(page.locator("#contributionLabel")).toHaveText("Monthly contribution");
    await mega(page).check();
    await expect(page.locator("#megaContribution")).toBeVisible();
    await expect(page.locator("#contributionLabel")).toHaveText("Basic monthly contribution");
    await expect(page.locator("#contributionHint")).toContainText("Mega Backdoor Roth");
    await expect(page.locator("#megaHint")).toContainText("Room this year: $66,000/yr ($5,500/mo)");
    await mega(page).uncheck();
    await expect(page.locator("#megaContribution")).toBeHidden();
    await expect(page.locator("#contributionLabel")).toHaveText("Monthly contribution");
  });

  test("adds the after-tax amount on top of the basic contribution, shown apart", async ({ page }) => {
    const before = await page.locator("#cardPrimary").innerText();
    await mega(page).check();
    await page.locator("#megaContribution").fill("1,000");
    await expect(page.locator("#cardPrimary .card-sub")).toContainText("$500/mo basic + $1,000/mo Mega Backdoor Roth");
    await expect(page.locator("#summary")).toContainText("Mega Backdoor Roth money");
    expect(await page.locator("#cardPrimary").innerText()).not.toBe(before);
    await expect(page.locator("#megaHint")).toContainText("$66,000/yr");
    expect(await legend(page)).toContain("Mega Backdoor Roth part");
    await page.getByText("Show as table").click();
    await expect(page.locator("#dataTable thead th:visible")).toHaveCount(6);
    await expect(page.locator("#megaColumn")).toBeVisible();
    await expect(page.locator("#dataTable tbody tr").first().locator("td")).toHaveCount(6);
  });

  test("ignores the after-tax amount when turned off", async ({ page }) => {
    const before = await page.locator("#cardPrimary").innerText();
    await mega(page).check();
    await page.locator("#megaContribution").fill("1,000");
    await mega(page).uncheck();
    await expect.poll(() => page.locator("#cardPrimary").innerText()).toBe(before);
    expect(await legend(page)).not.toContain("Mega Backdoor Roth part");
    await expect(page.locator("#dataTable tbody tr").first().locator("td")).toHaveCount(5);
  });

  test("warns when after-tax money is over the room under the total limit", async ({ page }) => {
    const warning = page.locator("#megaWarning");
    await mega(page).check();
    await page.locator("#contribution").fill("2,000");
    await page.locator("#megaContribution").fill("4,000");
    await expect(warning).toBeHidden();
    await page.locator("#megaContribution").fill("4,500");
    await expect(warning).toContainText("$54,000/yr at age 30");
    await expect(warning).toContainText("$48,000/yr left");
    await expect(warning).toContainText("$72,000/yr");
    await expect(page.locator("#limitWarning")).toBeHidden();
  });

  test("rejects a blank after-tax amount only while the option is on", async ({ page }) => {
    await mega(page).check();
    await page.locator("#megaContribution").fill("");
    await expect(page.locator("#error")).toContainText("Mega Backdoor Roth");
    await mega(page).uncheck();
    await expect(page.locator("#error")).toBeHidden();
  });

  test("target mode solves only the basic contribution, holding the after-tax amount", async ({ page }) => {
    await page.locator('input[name="mode"][value="target"]').check();
    const without = dollars(await card(page, "cardPrimary").innerText());
    await mega(page).check();
    await page.locator("#megaContribution").fill("300");
    await expect(page.locator("#cardPrimary .card-label")).toHaveText("Basic monthly contribution needed");
    await expect(page.locator("#cardPrimary .card-sub")).toContainText("Plus your $300/mo Mega Backdoor Roth.");
    await expect.poll(async () => dollars(await card(page, "cardPrimary").innerText())).toBe(without - 300);
    await expect(page.locator("#sensitivity tbody th").first()).toHaveText("Basic monthly contribution needed");
  });

  test("switching $ <-> % converts the after-tax amount too", async ({ page }) => {
    await page.locator("#salary").fill("120,000");
    await mega(page).check();
    await page.locator("#megaContribution").fill("2,000");
    await unit(page, "pct");
    await expect(page.locator("#megaContribution")).toHaveValue("20");
    await expect(page.locator("#megaLabel")).toHaveText("Mega Backdoor Roth (after-tax, % of salary)");
    await expect(page.locator("#megaAffix")).toHaveAttribute("data-suffix", "%");
    await unit(page, "usd");
    await expect(page.locator("#megaContribution")).toHaveValue("2,000");
  });

  test("is saved, shareable and reset", async ({ page }) => {
    await mega(page).check();
    await page.locator("#megaContribution").fill("1,000");
    await expect.poll(() => new URL(page.url()).search).toBe("?megaBackdoor=on&megaContribution=1000");
    await page.reload();
    await expect(mega(page)).toBeChecked();
    await expect(page.locator("#megaContribution")).toHaveValue("1,000");
    await page.locator("#reset").click();
    await expect(mega(page)).not.toBeChecked();
    await expect(page.locator("#megaContribution")).toBeHidden();
    await expect(page.locator("#megaContribution")).toHaveValue("0");
  });
});

const legend = (page) => page.evaluate(() => Chart.getChart(document.getElementById("chart")).legend.legendItems.map((item) => item.text));

test.describe("coast path and sensitivity", () => {
  test("legend lists the coast path after the current-balance line", async ({ page }) => {
    expect(await legend(page)).toEqual([
      "With monthly contributions",
      "Current balance only",
      "Contribute until coast, then stop",
      "CoastFIRE target",
    ]);
  });

  test("the coast path is hidden from the legend when coasting is out of reach", async ({ page }) => {
    await page.locator("#balance").fill("0");
    await page.locator("#contribution").fill("0");
    expect(await legend(page)).not.toContain("Contribute until coast, then stop");
    await page.locator("#balance").fill("50,000");
    await page.locator("#contribution").fill("500");
    expect(await legend(page)).toContain("Contribute until coast, then stop");
  });

  test("the table has a coast-path column", async ({ page }) => {
    await page.getByText("Show as table").click();
    await expect(page.locator("#dataTable thead th").nth(3)).toHaveText("Contribute until coast");
  });

  test("sensitivity table shows ages at -1% / chosen / +1% in contribution mode", async ({ page }) => {
    await expect(page.locator("#sensitivity thead th")).toHaveText(["1% lower (6%)", "As chosen (7%)", "1% higher (8%)"]);
    const rows = page.locator("#sensitivity tbody tr");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("Not by 65");
    await expect(rows.nth(0)).toContainText(/44\s*years/);
    await expect(rows.nth(1)).toContainText(/61\s*years|62\s*years/);
  });

  test("sensitivity table shows the contribution needed in target mode", async ({ page }) => {
    await page.locator('input[name="mode"][value="target"]').check();
    const row = page.locator("#sensitivity tbody tr");
    await expect(row).toHaveCount(1);
    await expect(row.locator("th")).toHaveText("Monthly contribution needed");
    await expect(row.locator("td")).toHaveCount(3);
    await expect(row.locator("td").nth(1)).toContainText("$1,072/mo");
  });
});

const simulate = (page) => page.locator("#returnModel").selectOption("montecarlo");
const datasets = (page) => page.evaluate(() => Chart.getChart(document.getElementById("chart")).data.datasets.map((d) => ({ label: d.label, n: d.data.length })));

const replayHistory = (page) => page.locator("#returnModel").selectOption("historical");

test.describe("replaying historical markets", () => {
  test("shows a historical card with the worst start year and a band", async ({ page }) => {
    await replayHistory(page);
    await expect(page.locator("#cardRisk")).toBeVisible();
    await expect(page.locator("#riskTitle")).toHaveText("Across historical markets (1928\u20132025)");
    await expect(page.locator("#riskList > div")).toHaveCount(3);
    await expect(page.locator("#riskHint")).toContainText("Replays real returns starting in each of the 98 years from 1928");
    await expect(page.locator("#riskHint")).toContainText(/worst start year for you was (19|20)\d\d\./);
    await expect(page.locator("#riskHint")).not.toContainText("volatility");
    const ds = await datasets(page);
    expect(ds.find((d) => d.label === "Likely range (10th\u201390th percentile)").n).toBeGreaterThan(10);
  });

  test("hides the volatility field for a custom portfolio and works in target mode", async ({ page }) => {
    await page.locator("#portfolio").selectOption("custom");
    await replayHistory(page);
    await expect(page.locator("#customVolatilityField")).toBeHidden();
    await page.locator('input[name="mode"][value="target"]').check();
    await expect(page.locator("#riskList > div").first()).toContainText("Contribution for 90% confidence");
  });

  test("switching back restores the simulated title and the steady view", async ({ page }) => {
    await replayHistory(page);
    await expect(page.locator("#riskTitle")).toContainText("historical");
    await simulate(page);
    await expect(page.locator("#riskTitle")).toHaveText("With market ups and downs");
    await page.locator("#returnModel").selectOption("fixed");
    await expect(page.locator("#cardRisk")).toBeHidden();
  });

  test("the choice is saved and shareable", async ({ page }) => {
    await replayHistory(page);
    await page.reload();
    await expect(page.locator("#returnModel")).toHaveValue("historical");
    await expect(page.locator("#riskList > div")).toHaveCount(3);
    await expect.poll(() => page.url()).toContain("returnModel=historical");
  });
});

test.describe("simulated ups and downs", () => {
  test("is off by default: no card, no band", async ({ page }) => {
    await expect(page.locator("#cardRisk")).toBeHidden();
    expect((await datasets(page)).filter((d) => d.n > 0).map((d) => d.label)).not.toContain("Likely range (10th–90th percentile)");
  });

  test("shows the risk card and a percentile band in contribution mode", async ({ page }) => {
    await simulate(page);
    await expect(page.locator("#cardRisk")).toBeVisible();
    const rows = page.locator("#riskList > div");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("Full retirement age");
    await expect(rows.nth(1)).toContainText("Chance that stopping at 44 years");
    await expect(rows.nth(2)).toContainText("90% confidence");
    await expect(page.locator("#riskHint")).toContainText("1,000 simulated markets");
    await expect(page.locator("#cardRisk")).not.toHaveClass(/is-busy/);
    const ds = await datasets(page);
    expect(ds.find((d) => d.label === "Likely range (10th–90th percentile)").n).toBeGreaterThan(10);
    expect(ds.map((d) => d.label)).toContain("With contributions (median)");
    expect(await legend(page)).toEqual([
      "With contributions (median)",
      "Current balance only",
      "Contribute until coast, then stop",
      "CoastFIRE target",
      "Likely range (10th–90th percentile)",
    ]);
  });

  test("shows the contribution for 90% confidence in target mode", async ({ page }) => {
    await page.locator('input[name="mode"][value="target"]').check();
    await simulate(page);
    const rows = page.locator("#riskList > div");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("Contribution for 90% confidence");
    await expect(rows.nth(0)).toContainText("if returns were steady");
    await expect(rows.nth(0).locator("dd")).toContainText("/mo");
  });

  test("results update when inputs change and stay reproducible", async ({ page }) => {
    await simulate(page);
    await expect(page.locator("#riskList > div")).toHaveCount(3);
    const first = await page.locator("#riskList").innerText();
    const text = () => page.locator("#riskList").innerText();
    await page.locator("#contribution").fill("1,500");
    await expect.poll(text).not.toBe(first);
    await page.locator("#contribution").fill("500");
    await expect.poll(text).toBe(first);
  });

  test("switching back to steady restores the original chart and hides the card", async ({ page }) => {
    await simulate(page);
    await expect(page.locator("#riskList > div")).toHaveCount(3);
    await page.locator("#returnModel").selectOption("fixed");
    await expect(page.locator("#cardRisk")).toBeHidden();
    expect(await legend(page)).toEqual([
      "With monthly contributions",
      "Current balance only",
      "Contribute until coast, then stop",
      "CoastFIRE target",
    ]);
  });

  test("custom volatility only appears for a custom portfolio with simulation on", async ({ page }) => {
    const field = page.locator("#customVolatilityField");
    await page.locator("#portfolio").selectOption("custom");
    await expect(field).toBeHidden();
    await simulate(page);
    await expect(field).toBeVisible();
    await page.locator("#customVolatility").fill("0");
    await expect(page.locator("#riskHint")).toContainText("0% yearly volatility");
  });

  test("the choice is remembered and reset", async ({ page }) => {
    await simulate(page);
    await page.reload();
    await expect(page.locator("#returnModel")).toHaveValue("montecarlo");
    await expect(page.locator("#riskList > div")).toHaveCount(3);
    await page.locator("#reset").click();
    await expect(page.locator("#returnModel")).toHaveValue("fixed");
  });
});

// A fresh browser context (no saved inputs) with Chart.js served locally.
async function freshPage(browser, options = {}) {
  const context = await browser.newContext(options);
  await context.route("https://cdn.jsdelivr.net/npm/chart.js@4.4.1/**", (route) =>
    route.fulfill({ body: CHART_JS, contentType: "text/javascript" }));
  return { context, page: await context.newPage() };
}
const search = (page) => new URL(page.url()).search;

test.describe("shareable links", () => {
  test("the address bar tracks only the values that differ from the defaults", async ({ page }) => {
    expect(search(page)).toBe("");
    await page.locator("#age").fill("41");
    await page.locator("#balance").fill("123,456");
    await expect.poll(() => search(page)).toBe("?age=41&balance=123456");
    await page.locator("#reset").click();
    await expect.poll(() => search(page)).toBe("");
  });

  test("Copy link copies the current link and confirms", async ({ browser }) => {
    const { context, page } = await freshPage(browser, { permissions: ["clipboard-read", "clipboard-write"] });
    await page.goto(URL_PATH);
    await page.locator("#age").fill("44");
    await page.locator("#copyLink").click();
    await expect(page.locator("#copyLink")).toHaveText("Copied ✓");
    await expect(page.locator("#copyStatus")).toHaveText("Link copied");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(new URL(copied).search).toBe("?age=44");
    expect(new URL(copied).pathname).toBe(URL_PATH);
    await expect(page.locator("#copyLink")).toHaveText("Copy link", { timeout: 5000 });
    await context.close();
  });

  test("a link opened in a fresh browser reproduces the scenario", async ({ page, browser }) => {
    await page.locator('input[name="mode"][value="target"]').check();
    await page.locator("#age").fill("35");
    await page.locator("#balance").fill("80,000");
    await page.locator("#spending").fill("60,000");
    await page.locator("#portfolio").selectOption("balanced-60-40");
    await expect.poll(() => search(page)).toContain("mode=target");
    const original = {
      primary: await page.locator("#cardPrimary").innerText(),
      fire: await card(page, "cardFire").innerText(),
      coast: await card(page, "cardCoast").innerText(),
    };

    const { context, page: other } = await freshPage(browser);
    await other.goto(page.url());
    await expect(other.locator("#age")).toHaveValue("35");
    await expect(other.locator("#balance")).toHaveValue("80,000");
    await expect(other.locator("#spending")).toHaveValue("60,000");
    await expect.poll(() => other.locator("#cardPrimary").innerText()).toBe(original.primary);
    await expect.poll(() => card(other, "cardFire").innerText()).toBe(original.fire);
    await expect.poll(() => card(other, "cardCoast").innerText()).toBe(original.coast);
    await context.close();
  });

  test("a link doesn't overwrite the viewer's saved inputs until they edit something", async ({ browser }) => {
    const { context, page } = await freshPage(browser);
    await page.goto(URL_PATH);
    await page.locator("#age").fill("41");
    await page.reload();
    await page.goto(`${URL_PATH}?age=50`);
    await expect(page.locator("#age")).toHaveValue("50");
    const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem("coastfire-calculator:v1")).values.age);
    expect(await saved()).toBe("41");
    await page.locator("#balance").fill("60,000");
    expect(await saved()).toBe("50");
    await context.close();
  });

  test("a tampered query falls back safely", async ({ browser }) => {
    const { context, page } = await freshPage(browser);
    await page.goto(`${URL_PATH}?mode=evil&age=abc&balance=12x&portfolio=nope&evil=1`);
    await expect(page.locator("#error")).toBeHidden();
    await expect(page.locator("#age")).toHaveValue("30");
    await expect(page.locator("#balance")).toHaveValue("50,000");
    await expect(page.locator('input[name="mode"][value="contribution"]')).toBeChecked();
    await expect(card(page, "cardFire")).toHaveText("$1,111,111");
    await context.close();
  });

  test("unrelated parameters such as ?v= leave saved inputs in charge", async ({ browser }) => {
    const { context, page } = await freshPage(browser);
    await page.goto(URL_PATH);
    await page.locator("#age").fill("41");
    await page.goto(`${URL_PATH}?v=123&utm_source=x`);
    await expect(page.locator("#age")).toHaveValue("41");
    await context.close();
  });

  test("a link that changes spending but not the FIRE number re-derives it", async ({ browser }) => {
    const { context, page } = await freshPage(browser);
    await page.goto(`${URL_PATH}?spending=60000`);
    await expect(page.locator("#fire")).toHaveValue("1,666,667");
    await context.close();
  });
});

test.describe("tax rate estimate", () => {
  const estimate = (page) => page.locator("#taxEstimateText");
  const spendingBox = (page) => page.locator("#spending");

  test("suggests a rate from spending without changing the field", async ({ page }) => {
    await expect(estimate(page)).toContainText("Estimated 6.5% for single");
    await expect(estimate(page)).toContainText("2025 federal rules");
    await expect(page.locator("#taxRate")).toHaveValue("10");
    await expect(card(page, "cardFire")).toHaveText("$1,111,111");
  });

  test("a higher-spending single filer gets a higher estimate", async ({ page }) => {
    await spendingBox(page).fill("100000");
    await expect(estimate(page)).toContainText("Estimated 14.3% for single");
    await page.getByRole("button", { name: "Fine-tune" }).click();
    await page.locator("#filingStatus").selectOption("married");
    await expect(estimate(page)).toContainText("Estimated 7.7% for married filing jointly");
  });

  test("Use estimate fills the tax rate and recalculates the FIRE number", async ({ page }) => {
    await spendingBox(page).fill("100000");
    await page.getByRole("button", { name: "Use 14.3%" }).click();
    await expect(page.locator("#taxRate")).toHaveValue("14.3");
    const need100k = { ...need, spending: 100_000, taxRate: 0.143 };
    await expect(card(page, "cardFire")).toHaveText(money(requiredBalance({ ...need100k, retireAge: 65 })));
    await expect(page.getByRole("button", { name: /^Use / })).toBeHidden(); // already applied
  });

  test("Fine-tune opens a modal with the breakdown and live inputs", async ({ page }) => {
    await spendingBox(page).fill("100000");
    await page.getByRole("button", { name: "Fine-tune" }).click();
    const dialog = page.getByRole("dialog", { name: "Estimate your tax rate" });
    await expect(dialog).toBeVisible();
    const row = (label) => dialog.locator("#taxRows > div", { hasText: label });
    await expect(row("Standard deduction")).toContainText("$17,750");
    await expect(row("Effective rate")).toContainText("14.3%");
    await dialog.getByLabel("State income tax").fill("5");
    await expect(row("State tax")).toBeVisible();
    await expect(row("Effective rate")).toContainText("19.9%");
    await dialog.getByLabel("Tax-free share of withdrawals").fill("100");
    await expect(row("Effective rate")).toContainText("0.0%");
  });

  test("Use this rate applies the estimate and closes the modal", async ({ page }) => {
    await spendingBox(page).fill("100000");
    await page.getByRole("button", { name: "Fine-tune" }).click();
    await page.getByLabel("Filing status").selectOption("married");
    await page.getByRole("button", { name: "Use this rate" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.locator("#taxRate")).toHaveValue("7.7");
  });

  test("Escape and Close dismiss the modal and return focus", async ({ page }) => {
    const opener = page.getByRole("button", { name: "Fine-tune" });
    await opener.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(opener).toBeFocused();
    await opener.click();
    await page.locator("#closeTax").click();
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("includes Social Security in the breakdown", async ({ page }) => {
    await spendingBox(page).fill("100000");
    await page.locator("#benefit").fill("30000");
    await page.getByRole("button", { name: "Fine-tune" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("#taxRows")).toContainText("Taxable Social Security");
    await expect(dialog.locator("#taxModalNote")).toContainText("treated as Social Security");
  });

  test("filing status, state tax and tax-free share are remembered, shared and reset", async ({ page }) => {
    await page.getByRole("button", { name: "Fine-tune" }).click();
    await page.getByLabel("Filing status").selectOption("head");
    await page.getByLabel("State income tax").fill("4");
    await page.getByLabel("Tax-free share of withdrawals").fill("25");
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(page.locator("#filingStatus")).toHaveValue("head");
    await expect(page.locator("#stateTax")).toHaveValue("4");
    await expect.poll(() => page.url()).toMatch(/filingStatus=head.*stateTax=4|stateTax=4.*filingStatus=head/);
    await page.locator("#reset").click();
    await expect(page.locator("#filingStatus")).toHaveValue("single");
    await expect(page.locator("#stateTax")).toHaveValue("0");
    await expect(page.locator("#rothShare")).toHaveValue("0");
  });

  test("invalid fine-tune values are flagged and hide the estimate", async ({ page }) => {
    await page.getByRole("button", { name: "Fine-tune" }).click();
    await page.getByLabel("State income tax").fill("50");
    await expect(page.locator("#stateTax")).toHaveAttribute("aria-invalid", "true");
    await expect(estimate(page)).toBeEmpty();
    await expect(page.getByRole("button", { name: "Use this rate" })).toBeDisabled();
  });
});

test.describe("Social Security estimate", () => {
  const open = async (page) => {
    await page.getByRole("button", { name: "Estimate Social Security" }).click();
    return page.getByRole("dialog", { name: "Estimate Social Security" });
  };
  const row = (dialog, label) => dialog.locator("#ssRows > div", { hasText: label });

  test("estimates the benefit from earnings and applies it", async ({ page }) => {
    const dialog = await open(page);
    await expect(dialog.locator("#ssNote")).toContainText("Enter your typical yearly earnings");
    await expect(dialog.getByRole("button", { name: "Use this benefit" })).toBeDisabled();
    await dialog.getByLabel("Typical yearly earnings").fill("60000");
    await expect(row(dialog, "Years of earnings")).toContainText("43");
    await expect(row(dialog, "Average monthly earnings")).toContainText("$5,000");
    await expect(row(dialog, "full retirement age")).toContainText("$2,346");
    await expect(row(dialog, "Monthly benefit").last()).toContainText("$2,345");
    await expect(row(dialog, "Yearly benefit")).toContainText("$28,140");
    await dialog.getByRole("button", { name: "Use this benefit" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator("#benefit")).toHaveValue("28,140");
    const withBenefit = { ...need, benefit: 28_140 };
    const expected = Math.round(requiredBalance({ ...withBenefit, retireAge: 65 }));
    await expect(page.locator("#fire")).toHaveValue(expected.toLocaleString("en-US"));
  });

  test("uses the salary when earnings are blank, and counts fewer years when retiring early", async ({ page }) => {
    await page.locator("#salary").fill("60000");
    await page.locator("#retirementAge").fill("47");
    const dialog = await open(page);
    await expect(row(dialog, "Years of earnings")).toContainText("25");
    await expect(dialog.locator("#ssNote")).toContainText("zeros");
    await expect(row(dialog, "Yearly benefit")).not.toContainText("$28,140");
  });

  test("claiming age changes the amount; ages outside 62-70 explain themselves", async ({ page }) => {
    await page.locator("#benefitAge").fill("62");
    const dialog = await open(page);
    await dialog.getByLabel("Typical yearly earnings").fill("60000");
    await expect(row(dialog, "Adjustment for claiming at 62")).toContainText("70.0%");
    await page.keyboard.press("Escape");
    await page.locator("#benefitAge").fill("60");
    await open(page);
    await expect(page.locator("#ssNote")).toContainText("between 62 and 70");
  });

  test("needs 10 years of earnings to qualify", async ({ page }) => {
    await page.locator("#retirementAge").fill("30");
    const dialog = await open(page);
    await dialog.getByLabel("Typical yearly earnings").fill("60000");
    await expect(dialog.locator("#ssNote")).toContainText("at least 10 years");
    await expect(dialog.getByRole("button", { name: "Use this benefit" })).toBeDisabled();
  });

  test("the inputs are remembered and reset; Escape closes the modal", async ({ page }) => {
    const dialog = await open(page);
    await dialog.getByLabel("Typical yearly earnings").fill("85000");
    await dialog.getByLabel("Age you started working").fill("25");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: "Estimate Social Security" })).toBeFocused();
    await page.reload();
    await expect(page.locator("#ssEarnings")).toHaveValue("85,000");
    await expect(page.locator("#ssStartAge")).toHaveValue("25");
    await page.locator("#reset").click();
    await expect(page.locator("#ssEarnings")).toHaveValue("");
    await expect(page.locator("#ssStartAge")).toHaveValue("22");
  });
});

test.describe("explanations", () => {
  const tip = (page, id) => page.locator(`#${id}`);

  test("an info button opens its explanation and Escape closes it", async ({ page }) => {
    await page.getByRole("button", { name: "What is the FIRE number?" }).click();
    await expect(tip(page, "tip-fire")).toBeVisible();
    await expect(tip(page, "tip-fire").locator("h2")).toHaveText("FIRE number");
    await page.keyboard.press("Escape");
    await expect(tip(page, "tip-fire")).toBeHidden();
  });

  test("explanations are hidden until opened", async ({ page }) => {
    for (const id of ["tip-coastfire", "tip-fire", "tip-swr", "tip-return", "tip-tax", "tip-bridge", "tip-coastpath", "tip-success"]) {
      await expect(tip(page, id)).toBeHidden();
    }
  });

  test("works from the keyboard", async ({ page }) => {
    await page.getByRole("button", { name: "About the safe withdrawal rate" }).focus();
    await page.keyboard.press("Enter");
    await expect(tip(page, "tip-swr")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(tip(page, "tip-swr")).toBeHidden();
  });

  test("opening another explanation closes the first; clicking outside closes it", async ({ page }) => {
    await page.getByRole("button", { name: "About the tax rate" }).click();
    await expect(tip(page, "tip-tax")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "About real returns" }).click();
    await expect(tip(page, "tip-return")).toBeVisible();
    await expect(tip(page, "tip-tax")).toBeHidden();
    await page.mouse.click(5, 5);
    await expect(tip(page, "tip-return")).toBeHidden();
  });

  test("the simulation explanation sits on the risk card", async ({ page }) => {
    await page.locator("#returnModel").selectOption("montecarlo");
    await page.getByRole("button", { name: "About the simulated chances" }).click();
    await expect(tip(page, "tip-success")).toContainText("1,000 simulated markets");
  });
});
