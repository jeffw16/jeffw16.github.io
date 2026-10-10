// Pure helpers for saving form values to localStorage. No DOM or storage access:
// app.js reads/writes the actual storage and form.

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
