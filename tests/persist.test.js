import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { STORAGE_KEY, serializeState, parseSavedState, isDefaultState, savedKeys } from "../coastfire-calculator/persist.js";

const defaults = Object.freeze({ mode: "contribution", age: "30", balance: "50,000", portfolio: "sp500" });
const allowed = Object.freeze({ mode: ["contribution", "target"], portfolio: ["sp500", "custom"] });

describe("STORAGE_KEY", () => {
  it("is a namespaced, versioned key", () => {
    assert.match(STORAGE_KEY, /^coastfire-calculator:v\d+$/);
  });
});

describe("serializeState", () => {
  it("round-trips through parseSavedState", () => {
    const values = { mode: "target", age: "42", balance: "123,456", portfolio: "custom" };
    assert.deepEqual(parseSavedState(serializeState(values), defaults, allowed), values);
  });
  it("produces versioned JSON", () => {
    assert.deepEqual(JSON.parse(serializeState({ age: "30" })), { version: 1, values: { age: "30" } });
  });
});

describe("parseSavedState", () => {
  it("returns a copy of the defaults when nothing is saved", () => {
    const result = parseSavedState(null, defaults, allowed);
    assert.deepEqual(result, defaults);
    assert.notEqual(result, defaults);
  });
  it("returns the defaults for corrupt JSON", () => {
    assert.deepEqual(parseSavedState("{not json", defaults, allowed), defaults);
    assert.deepEqual(parseSavedState("", defaults, allowed), defaults);
  });
  it("returns the defaults for a different version or malformed shape", () => {
    assert.deepEqual(parseSavedState(JSON.stringify({ version: 2, values: { age: "40" } }), defaults), defaults);
    assert.deepEqual(parseSavedState(JSON.stringify({ version: 1, values: null }), defaults), defaults);
    assert.deepEqual(parseSavedState(JSON.stringify({ version: 1 }), defaults), defaults);
    assert.deepEqual(parseSavedState("42", defaults), defaults);
    assert.deepEqual(parseSavedState("null", defaults), defaults);
  });
  it("fills keys missing from saved data with defaults", () => {
    const text = serializeState({ age: "45" });
    assert.deepEqual(parseSavedState(text, defaults, allowed), { ...defaults, age: "45" });
  });
  it("ignores unknown keys", () => {
    const text = serializeState({ age: "45", evil: "x" });
    assert.equal("evil" in parseSavedState(text, defaults, allowed), false);
  });
  it("ignores non-string values", () => {
    const text = serializeState({ age: 45, balance: null, mode: ["target"] });
    assert.deepEqual(parseSavedState(text, defaults, allowed), defaults);
  });
  it("rejects values outside the allowed list", () => {
    const text = serializeState({ mode: "bogus", portfolio: "removed-preset" });
    assert.deepEqual(parseSavedState(text, defaults, allowed), defaults);
  });
  it("keeps saved empty strings (a cleared field stays cleared)", () => {
    assert.equal(parseSavedState(serializeState({ balance: "" }), defaults, allowed).balance, "");
  });
  it("does not mutate the defaults", () => {
    parseSavedState(serializeState({ age: "50" }), defaults, allowed);
    assert.equal(defaults.age, "30");
  });
});

describe("isDefaultState", () => {
  it("is true for the defaults", () => {
    assert.equal(isDefaultState({ ...defaults }, defaults), true);
  });
  it("is false when any value differs", () => {
    assert.equal(isDefaultState({ ...defaults, age: "31" }, defaults), false);
    assert.equal(isDefaultState({ ...defaults, mode: "target" }, defaults), false);
  });
  it("is false when a default key is missing", () => {
    const { age, ...rest } = defaults;
    assert.equal(isDefaultState(rest, defaults), false);
  });
});

describe("savedKeys", () => {
  it("lists the saved field names", () => {
    assert.deepEqual(savedKeys(serializeState({ age: "30", mode: "target" })), ["age", "mode"]);
  });
  it("is empty for missing, corrupt or wrong-version data", () => {
    assert.deepEqual(savedKeys(null), []);
    assert.deepEqual(savedKeys("{nope"), []);
    assert.deepEqual(savedKeys(JSON.stringify({ version: 9, values: { age: "1" } })), []);
    assert.deepEqual(savedKeys(JSON.stringify({ version: 1, values: null })), []);
  });
});

import { encodeQuery, decodeQuery } from "../coastfire-calculator/persist.js";

describe("encodeQuery", () => {
  const kinds = { balance: "amount", age: "number" };
  it("is empty when nothing differs from the defaults", () => {
    assert.equal(encodeQuery({ ...defaults }, defaults, kinds), "");
  });
  it("includes only the values that differ", () => {
    assert.equal(encodeQuery({ ...defaults, age: "41" }, defaults, kinds), "?age=41");
  });
  it("stores amounts without commas", () => {
    assert.equal(encodeQuery({ ...defaults, balance: "1,234,567" }, defaults, kinds), "?balance=1234567");
  });
  it("keeps a cleared field as an empty value", () => {
    assert.equal(encodeQuery({ ...defaults, balance: "" }, defaults, kinds), "?balance=");
  });
  it("encodes special characters and skips non-string values and unknown keys", () => {
    assert.equal(encodeQuery({ ...defaults, mode: "a b&c", age: 5, extra: "x" }, defaults, kinds), "?mode=a+b%26c");
  });
  it("does not mutate its inputs", () => {
    const values = Object.freeze({ ...defaults, age: "41" });
    assert.doesNotThrow(() => encodeQuery(values, defaults, kinds));
  });
});

describe("decodeQuery", () => {
  const kinds = { balance: "amount", age: "number" };
  it("round-trips through encodeQuery, regrouping amounts", () => {
    const values = { mode: "target", age: "42", balance: "1,234,567", portfolio: "custom" };
    assert.deepEqual(decodeQuery(encodeQuery(values, defaults, kinds), defaults, allowed, kinds), values);
  });
  it("fills missing fields with the defaults (a link defines the whole scenario)", () => {
    assert.deepEqual(decodeQuery("?age=45", defaults, allowed, kinds), { ...defaults, age: "45" });
  });
  it("is null for an empty query or one with no recognised field", () => {
    assert.equal(decodeQuery("", defaults, allowed, kinds), null);
    assert.equal(decodeQuery("?v=abc123&utm_source=x", defaults, allowed, kinds), null);
  });
  it("ignores unknown parameters but keeps recognised ones", () => {
    assert.deepEqual(decodeQuery("?v=abc&age=50&evil=1", defaults, allowed, kinds), { ...defaults, age: "50" });
  });
  it("rejects values outside the allowed list", () => {
    assert.equal(decodeQuery("?mode=evil", defaults, allowed, kinds), null);
    assert.deepEqual(decodeQuery("?mode=evil&age=41", defaults, allowed, kinds), { ...defaults, age: "41" });
  });
  it("rejects non-numeric amounts and numbers", () => {
    assert.equal(decodeQuery("?age=abc", defaults, allowed, kinds), null);
    assert.equal(decodeQuery("?balance=12x", defaults, allowed, kinds), null);
    assert.equal(decodeQuery("?balance=1e9", defaults, allowed, kinds), null);
    assert.equal(decodeQuery("?age=1.2.3", defaults, allowed, kinds), null);
  });
  it("accepts decimals, negatives for numbers, and empty values", () => {
    assert.deepEqual(decodeQuery("?age=-2.5&balance=1000.50", defaults, allowed, kinds), { ...defaults, age: "-2.5", balance: "1,000.50" });
    assert.deepEqual(decodeQuery("?balance=", defaults, allowed, kinds), { ...defaults, balance: "" });
  });
  it("decodes escaped characters in choice fields", () => {
    assert.deepEqual(decodeQuery("?portfolio=custom", defaults, allowed, kinds), { ...defaults, portfolio: "custom" });
  });
  it("does not mutate the defaults", () => {
    decodeQuery("?age=99", defaults, allowed, kinds);
    assert.equal(defaults.age, "30");
  });
});
