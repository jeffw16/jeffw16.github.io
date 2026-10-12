// Pure display helpers: comma-grouped dollar inputs and age labels. No DOM access.

import { splitAge } from "./calc.js?v=31c6da205c";

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

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Age label for prose: "40 years, 1 month", or "60 years" on a whole year. */
export function formatAge(age) {
  const { years, months } = splitAge(age);
  return months ? `${plural(years, "year")}, ${plural(months, "month")}` : plural(years, "year");
}

/** Age split for a big-number card: { big: "40", unit: "years, 1 month" }. */
export function formatAgeParts(age) {
  const { years, months } = splitAge(age);
  const unit = years === 1 ? "year" : "years";
  return { big: String(years), unit: months ? `${unit}, ${plural(months, "month")}` : unit };
}

/**
 * Backspace/Delete with a collapsed caret next to a comma would only remove the
 * comma, which formatting immediately puts back, so the key appears to do
 * nothing. Returns the edit to apply instead (remove the digit on the far side
 * of the comma, then re-format), or null when the native edit is fine.
 * `direction` is "backward" (Backspace) or "forward" (Delete).
 */
export function deleteAcrossComma(value, caret, direction) {
  if (direction === "backward" && caret >= 2 && value[caret - 1] === ",") {
    return formatWithCaret(value.slice(0, caret - 2) + value.slice(caret - 1), caret - 2);
  }
  if (direction === "forward" && value[caret] === "," && caret + 1 < value.length) {
    return formatWithCaret(value.slice(0, caret + 1) + value.slice(caret + 2), caret);
  }
  return null;
}

/** formatAge for a number, or `note` when the age is null (not reached). */
export function formatAgeOrNote(age, note) {
  return age === null || age === undefined ? note : formatAge(age);
}
