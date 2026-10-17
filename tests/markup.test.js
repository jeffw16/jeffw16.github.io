import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readAssets } from "../scripts/stamp-assets.mjs";

const { "index.html": html, "style.css": css, "app.js": app } = readAssets();
const inputs = [...html.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]);
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];

// Regression: dollar inputs became type="text" but the stylesheet the page
// got only styled type="number", leaving tiny unstyled boxes.
describe("index.html inputs (regression)", () => {
  it("styles every text-entry input type the page uses", () => {
    const types = new Set(inputs.map((t) => attr(t, "type")).filter((t) => t !== "radio"));
    assert.ok(types.size > 0);
    for (const type of types) {
      assert.match(css, new RegExp(`input\\[type="${type}"\\][^{]*\\{`), `style.css has no rule for input[type="${type}"]`);
    }
  });

  it("makes every dollar input a comma-friendly decimal text box", () => {
    const amounts = inputs.filter((t) => /\bdata-amount\b/.test(t));
    assert.deepEqual(amounts.map((t) => attr(t, "id")).sort(), ["balance", "benefit", "contribution", "fire", "megaContribution", "salary", "spending", "ssEarnings"]);
    for (const tag of amounts) {
      assert.equal(attr(tag, "type"), "text", tag);
      assert.equal(attr(tag, "inputmode"), "decimal", tag);
      assert.equal(attr(tag, "min"), undefined, `${tag} should not carry number-only attributes`);
    }
  });

  it("gives every input a matching label", () => {
    for (const tag of inputs.filter((t) => attr(t, "type") !== "radio")) {
      const id = attr(tag, "id");
      assert.match(html, new RegExp(`<label for="${id}"`), `no <label for="${id}">`);
    }
  });

  it("points every info button at an existing popover", () => {
    const targets = [...html.matchAll(/popovertarget="([\w-]+)"/g)].map((m) => m[1]);
    assert.ok(targets.length >= 8);
    for (const id of targets) assert.match(html, new RegExp(`<div id="${id}" class="tip" popover>`), `no popover #${id}`);
  });

  it("labels every info button and gives every popover a heading", () => {
    for (const [tag] of html.matchAll(/<button\b[^>]*popovertarget[^>]*>/g)) assert.match(tag, /aria-label="[^"]+"/, tag);
    for (const [block] of html.matchAll(/<div id="tip-[\w-]+" class="tip" popover>[\s\S]*?<\/div>/g)) assert.match(block, /<h2>[^<]+<\/h2>\s*<p>[^<]+<\/p>/);
  });

  it("has every element app.js looks up by id", () => {
    const ids = new Set([...app.matchAll(/\$\("([\w-]+)"\)/g)].map((m) => m[1]));
    for (const id of ids) assert.match(html, new RegExp(`\\bid="${id}"`), `index.html is missing #${id}`);
  });
});
