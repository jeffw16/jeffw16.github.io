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
