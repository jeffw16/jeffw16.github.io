import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseAmount, groupDigits, formatWithCaret, deleteAcrossComma, formatAge, formatAgeParts, formatAgeOrNote } from "../coastfire-calculator/format.js";

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

describe("deleteAcrossComma", () => {
  it("Backspace right after a comma removes the digit before it", () => {
    assert.deepEqual(deleteAcrossComma("50,000", 3, "backward"), { value: "5,000", caret: 1 });
    assert.deepEqual(deleteAcrossComma("1,234,567", 6, "backward"), { value: "123,567", caret: 3 });
  });
  it("Delete right before a comma removes the digit after it", () => {
    assert.deepEqual(deleteAcrossComma("5,000", 1, "forward"), { value: "500", caret: 1 });
    assert.deepEqual(deleteAcrossComma("1,234,567", 5, "forward"), { value: "123,467", caret: 5 });
  });
  it("returns null when the key isn't next to a comma (native edit is fine)", () => {
    assert.equal(deleteAcrossComma("50,000", 2, "backward"), null);
    assert.equal(deleteAcrossComma("50,000", 3, "forward"), null);
    assert.equal(deleteAcrossComma("500", 3, "backward"), null);
    assert.equal(deleteAcrossComma("", 0, "forward"), null);
  });
  it("returns null at the edges of the text", () => {
    assert.equal(deleteAcrossComma(",5", 1, "backward"), null);
    assert.equal(deleteAcrossComma("5,", 1, "forward"), null);
  });
});

// Simulates what a browser + app.js do for each keystroke in a dollar input:
// the native edit (or deleteAcrossComma's replacement), then formatWithCaret.
function press({ value, caret }, key) {
  if (key === "Backspace" || key === "Delete") {
    const direction = key === "Backspace" ? "backward" : "forward";
    const across = deleteAcrossComma(value, caret, direction);
    if (across) return across;
    if (direction === "backward") {
      if (caret === 0) return { value, caret };
      return formatWithCaret(value.slice(0, caret - 1) + value.slice(caret), caret - 1);
    }
    if (caret === value.length) return { value, caret };
    return formatWithCaret(value.slice(0, caret) + value.slice(caret + 1), caret);
  }
  if (key === "Home") return { value, caret: 0 };
  if (key === "End") return { value, caret: value.length };
  if (key === "ArrowLeft") return { value, caret: Math.max(0, caret - 1) };
  if (key === "ArrowRight") return { value, caret: Math.min(value.length, caret + 1) };
  return formatWithCaret(value.slice(0, caret) + key + value.slice(caret), caret + key.length);
}
const keys = (state, ...ks) => ks.reduce(press, state);
const typeText = (state, text) => keys(state, ...text);

describe("dollar input keystrokes (regression)", () => {
  const empty = { value: "", caret: 0 };

  it("typing digits adds commas and keeps the caret at the end", () => {
    let s = empty;
    const seen = [];
    for (const ch of "1234567") { s = press(s, ch); seen.push(s.value); }
    assert.deepEqual(seen, ["1", "12", "123", "1,234", "12,345", "123,456", "1,234,567"]);
    assert.equal(s.caret, s.value.length);
  });

  it("typing a decimal amount", () => {
    assert.deepEqual(typeText(empty, "2500.5"), { value: "2,500.5", caret: 7 });
  });

  it("Backspace from the end deletes one digit per press, never sticking on a comma", () => {
    let s = { value: "1,234,567", caret: 9 };
    const seen = [];
    while (s.value) { s = press(s, "Backspace"); seen.push(s.value); }
    assert.deepEqual(seen, ["123,456", "12,345", "1,234", "123", "12", "1", ""]);
  });

  it("Backspace right after a comma deletes the digit before it (was a no-op)", () => {
    const s = keys({ value: "50,000", caret: 6 }, "Home", "ArrowRight", "ArrowRight", "ArrowRight", "Backspace");
    assert.deepEqual(s, { value: "5,000", caret: 1 });
  });

  it("Delete right before a comma deletes the digit after it (was stuck)", () => {
    let s = keys({ value: "5,000", caret: 5 }, "Home", "ArrowRight", "Delete");
    assert.deepEqual(s, { value: "500", caret: 1 });
    s = press(s, "Delete");
    assert.deepEqual(s, { value: "50", caret: 1 });
  });

  it("Delete from the start removes every digit", () => {
    let s = { value: "1,234,567", caret: 0 };
    for (let i = 0; i < 7; i++) s = press(s, "Delete");
    assert.deepEqual(s, { value: "", caret: 0 });
  });

  it("inserting a digit in the middle keeps the caret after it", () => {
    const s = keys({ value: "50,000", caret: 6 }, "Home", "ArrowRight", "1");
    assert.deepEqual(s, { value: "510,000", caret: 2 });
  });

  it("every value typed parses back to the number typed", () => {
    for (const n of [0, 7, 999, 1000, 65_432, 1_000_000, 123_456_789]) {
      assert.equal(parseAmount(typeText(empty, String(n)).value), n);
    }
  });
});

describe("formatAgeOrNote", () => {
  it("formats a real age", () => {
    assert.equal(formatAgeOrNote(40 + 1 / 12, "Not by 65"), "40 years, 1 month");
    assert.equal(formatAgeOrNote(0, "Not by 65"), "0 years");
  });
  it("returns the note for null or undefined", () => {
    assert.equal(formatAgeOrNote(null, "Not by 65"), "Not by 65");
    assert.equal(formatAgeOrNote(undefined, "Not by 65"), "Not by 65");
  });
});
