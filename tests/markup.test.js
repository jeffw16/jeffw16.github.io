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
    assert.deepEqual(amounts.map((t) => attr(t, "id")).sort(), ["balance", "contribution", "fire", "spending"]);
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

  it("has every element app.js looks up by id", () => {
    const ids = new Set([...app.matchAll(/\$\("([\w-]+)"\)/g)].map((m) => m[1]));
    for (const id of ids) assert.match(html, new RegExp(`\\bid="${id}"`), `index.html is missing #${id}`);
  });
});
