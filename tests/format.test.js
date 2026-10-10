import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseAmount, groupDigits, formatWithCaret, formatAge, formatAgeParts } from "../coastfire-calculator/format.js";

describe("parseAmount", () => {
  it("parses plain and comma-grouped numbers", () => {
    assert.equal(parseAmount("500"), 500);
    assert.equal(parseAmount("50,000"), 50_000);
    assert.equal(parseAmount("1,234,567.89"), 1_234_567.89);
  });
  it("ignores dollar signs and spaces", () => {
    assert.equal(parseAmount(" $40,000 "), 40_000);
  });
  it("accepts a trailing or leading dot", () => {
    assert.equal(parseAmount("12."), 12);
    assert.equal(parseAmount(".5"), 0.5);
  });
  it("is NaN for empty or invalid text", () => {
    assert.ok(Number.isNaN(parseAmount("")));
    assert.ok(Number.isNaN(parseAmount(".")));
    assert.ok(Number.isNaN(parseAmount("abc")));
    assert.ok(Number.isNaN(parseAmount("1.2.3")));
    assert.ok(Number.isNaN(parseAmount("-5")));
  });
});

describe("groupDigits", () => {
  it("adds commas every three integer digits", () => {
    assert.equal(groupDigits("1"), "1");
    assert.equal(groupDigits("1000"), "1,000");
    assert.equal(groupDigits("1234567"), "1,234,567");
  });
  it("leaves the fractional part ungrouped", () => {
    assert.equal(groupDigits("1234.5678"), "1,234.5678");
    assert.equal(groupDigits("1000."), "1,000.");
  });
  it("re-groups already-grouped or mis-grouped text", () => {
    assert.equal(groupDigits("1,0000"), "10,000");
    assert.equal(groupDigits("$12,34"), "1,234");
  });
  it("drops stray characters, extra dots and leading zeros", () => {
    assert.equal(groupDigits("12a34"), "1,234");
    assert.equal(groupDigits("1.2.3"), "1.23");
    assert.equal(groupDigits("0050"), "50");
    assert.equal(groupDigits("0"), "0");
    assert.equal(groupDigits("0.5"), "0.5");
  });
  it("returns an empty string for empty input", () => {
    assert.equal(groupDigits(""), "");
  });
});

describe("formatWithCaret", () => {
  it("keeps the caret at the end when typing at the end", () => {
    assert.deepEqual(formatWithCaret("1000", 4), { value: "1,000", caret: 5 });
    assert.deepEqual(formatWithCaret("1,0000", 6), { value: "10,000", caret: 6 });
  });
  it("keeps the caret after the same digit when editing in the middle", () => {
    // "50,000" → typed "1" after the "5": "510,000", caret after "51".
    assert.deepEqual(formatWithCaret("510,000", 2), { value: "510,000", caret: 2 });
    // "5,000" → typed "1" after "5,": "5,1000", caret after "5,1" → "51,000" caret after "51".
    assert.deepEqual(formatWithCaret("5,1000", 3), { value: "51,000", caret: 2 });
  });
  it("re-groups after a deletion shifts the comma", () => {
    // "10,000" → delete a "0" after the "10": "10,00", caret after "10" → "1,000" caret after "1,0".
    assert.deepEqual(formatWithCaret("10,00", 2), { value: "1,000", caret: 3 });
  });
  it("places the caret at 0 when it was at the start", () => {
    assert.deepEqual(formatWithCaret("12345", 0), { value: "12,345", caret: 0 });
  });
  it("handles empty input", () => {
    assert.deepEqual(formatWithCaret("", 0), { value: "", caret: 0 });
  });
});

describe("formatAge", () => {
  it('renders "X years, Y months"', () => {
    assert.equal(formatAge(40 + 6 / 12), "40 years, 6 months");
    assert.equal(formatAge(34 + 7 / 12), "34 years, 7 months");
  });
  it("uses the singular for one month", () => {
    assert.equal(formatAge(40 + 1 / 12), "40 years, 1 month");
  });
  it("omits months on a whole year", () => {
    assert.equal(formatAge(60), "60 years");
  });
  it("uses the singular for one year", () => {
    assert.equal(formatAge(1), "1 year");
    assert.equal(formatAge(1 + 2 / 12), "1 year, 2 months");
  });
  it("rounds to the nearest month, carrying into the next year", () => {
    assert.equal(formatAge(42.999), "43 years");
    assert.equal(formatAge(42 + 11 / 12), "42 years, 11 months");
  });
  it('never renders "X and Y months"', () => {
    for (let m = 0; m < 12 * 5; m++) {
      const text = formatAge(30 + m / 12);
      assert.doesNotMatch(text, / and /);
      assert.match(text, /^\d+ years?(, \d+ months?)?$/);
    }
  });
});

describe("formatAgeParts", () => {
  it("splits into a big year number and a unit with months", () => {
    assert.deepEqual(formatAgeParts(40 + 1 / 12), { big: "40", unit: "years, 1 month" });
    assert.deepEqual(formatAgeParts(60 + 6 / 12), { big: "60", unit: "years, 6 months" });
  });
  it("uses just the year unit on a whole year", () => {
    assert.deepEqual(formatAgeParts(55), { big: "55", unit: "years" });
    assert.deepEqual(formatAgeParts(1), { big: "1", unit: "year" });
  });
  it("reads the same as formatAge when joined", () => {
    for (let m = 0; m < 12 * 5; m++) {
      const { big, unit } = formatAgeParts(30 + m / 12);
      assert.equal(`${big} ${unit}`, formatAge(30 + m / 12));
    }
  });
});
