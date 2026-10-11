import { test as base, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const CHART_JS = readFileSync(new URL("../node_modules/chart.js/dist/chart.umd.js", import.meta.url));

// Hermetic page: Chart.js comes from node_modules instead of the CDN, and any
// console error or uncaught exception fails the test.
export const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.route("https://cdn.jsdelivr.net/npm/chart.js@4.4.1/**", (route) =>
      route.fulfill({ body: CHART_JS, contentType: "text/javascript" }));
    await use(page);
    expect(errors, "console/page errors").toEqual([]);
  },
});

export { expect };

export const URL_PATH = "/coastfire-calculator/";
