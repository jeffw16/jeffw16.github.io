// Pure helpers for comma-grouped dollar inputs. No DOM access.

/** Parse a user-typed amount like "1,234.5" or "$50,000" into a number (NaN if empty/invalid). */
export function parseAmount(text) {
  const cleaned = String(text).replace(/[$,\s]/g, "");
  if (cleaned === "" || !/^\d*\.?\d*$/.test(cleaned) || cleaned === ".") return NaN;
  return Number(cleaned);
}

/** Group the integer part of a digits-and-dot string with commas: "1234567.8" → "1,234,567.8". */
export function groupDigits(text) {
  const raw = String(text).replace(/[^\d.]/g, "");
  const dot = raw.indexOf(".");
  const intPart = (dot === -1 ? raw : raw.slice(0, dot)).replace(/^0+(?=\d)/, "");
  const fracPart = dot === -1 ? "" : "." + raw.slice(dot + 1).replace(/\./g, "");
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + fracPart;
}

/**
 * Reformat an input's value with commas while typing, keeping the caret after
 * the same number of digits/dots it was after before formatting.
 */
export function formatWithCaret(value, caret) {
  const significant = (s) => s.replace(/[^\d.]/g, "").length;
  const before = significant(value.slice(0, caret));
  const formatted = groupDigits(value);
  let seen = 0;
  let pos = 0;
  while (pos < formatted.length && seen < before) {
    if (/[\d.]/.test(formatted[pos])) seen++;
    pos++;
  }
  return { value: formatted, caret: pos };
}
