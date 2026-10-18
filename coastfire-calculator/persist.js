// Pure helpers for saving form values to localStorage and to shareable URLs. No DOM,
// storage or location access: app.js reads/writes the actual storage, form and URL.
import { groupDigits } from "./format.js?v=4b8d7eb0c0";

export const STORAGE_KEY = "coastfire-calculator:v1";
const VERSION = 1;

/** JSON text to store for the given form values ({ fieldName: string }). */
export function serializeState(values) {
  return JSON.stringify({ version: VERSION, values });
}

/**
 * Form values to apply from saved JSON text. Starts from `defaults` and takes
 * each known key whose saved value is a string; keys listed in `allowed` must
 * also be one of their allowed values. Missing, corrupt or wrong-version data
 * yields a copy of the defaults.
 */
export function parseSavedState(text, defaults, allowed = {}) {
  const result = { ...defaults };
  let saved;
  try {
    saved = JSON.parse(text);
  } catch {
    return result;
  }
  if (!saved || saved.version !== VERSION || typeof saved.values !== "object" || saved.values === null) return result;
  for (const key of Object.keys(defaults)) {
    const value = saved.values[key];
    if (typeof value !== "string") continue;
    if (allowed[key] && !allowed[key].includes(value)) continue;
    result[key] = value;
  }
  return result;
}

/** True when every default key has its default value. */
export function isDefaultState(values, defaults) {
  return Object.keys(defaults).every((key) => values[key] === defaults[key]);
}

/** Field names present in saved JSON text (empty for missing, corrupt or wrong-version data). */
export function savedKeys(text) {
  try {
    const saved = JSON.parse(text);
    if (!saved || saved.version !== VERSION || typeof saved.values !== "object" || saved.values === null) return [];
    return Object.keys(saved.values);
  } catch {
    return [];
  }
}

// ---------- Shareable links ----------

const AMOUNT_PATTERN = /^(\d+(\.\d*)?|\.\d+)?$/;
const NUMBER_PATTERN = /^(-?\d+(\.\d*)?|-?\.\d+)?$/;

/**
 * Query string ("?a=1&b=2", or "" when nothing differs) holding the values that
 * differ from `defaults`. `kinds` maps a field to "amount" (comma-grouped dollars,
 * stored without commas) or "number"; other fields are plain strings.
 */
export function encodeQuery(values, defaults, kinds = {}) {
  const params = new URLSearchParams();
  for (const key of Object.keys(defaults)) {
    const value = values[key];
    if (typeof value !== "string" || value === defaults[key]) continue;
    params.set(key, kinds[key] === "amount" ? value.replace(/,/g, "") : value);
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

/**
 * Form values from a URL query string, or null if it holds no recognised field.
 * Starts from `defaults` and takes each known field whose value passes its check:
 * `allowed` lists the valid options of choice fields, and amount/number fields
 * (per `kinds`) must look numeric. Anything else, including unrelated parameters
 * such as a cache-busting ?v=, is ignored. Amounts come back comma-grouped.
 */
export function decodeQuery(search, defaults, allowed = {}, kinds = {}) {
  const params = new URLSearchParams(search);
  const result = { ...defaults };
  let found = false;
  for (const key of Object.keys(defaults)) {
    if (!params.has(key)) continue;
    const value = params.get(key);
    if (allowed[key] && !allowed[key].includes(value)) continue;
    if (kinds[key] === "amount" && !AMOUNT_PATTERN.test(value)) continue;
    if (kinds[key] === "number" && !NUMBER_PATTERN.test(value)) continue;
    result[key] = kinds[key] === "amount" ? groupDigits(value) : value;
    found = true;
  }
  return found ? result : null;
}
