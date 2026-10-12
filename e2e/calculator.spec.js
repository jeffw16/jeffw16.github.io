import { test, expect, URL_PATH } from "./fixtures.js";
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
  await expect(page.locator("#dataTable thead th")).toHaveCount(4);
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
