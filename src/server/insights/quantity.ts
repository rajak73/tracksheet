/**
 * Reading a count out of free text, or honestly failing to.
 *
 * ── Why this is all-or-nothing ────────────────────────────────────────────
 * `quantity` is whatever the instructor typed. "3 classes" has a number in it.
 * "as per timetable" does not, and neither does "half day". A group holding both
 * has no honest total, so it gets none — not a partial sum, and not the number of
 * ROWS dressed up as a count.
 *
 * That last one is the failure worth naming, because it looks correct. Three
 * activities saying "2 classes", "2 classes" and "3 classes" are seven classes,
 * not three. An implementation that counts items produces three, renders it beside
 * the word "classes", and is wrong in a way nobody can see without opening the
 * day. The same implementation produces a plausible number for the group it cannot
 * read at all.
 *
 * So: every member must yield a number, or the group has none.
 *
 * ── The model never sees this ─────────────────────────────────────────────
 * The text is not sent for interpretation and the model is told to ignore the
 * field entirely. A number it read out of prose would be a number it produced,
 * which is the one thing it is never allowed to do.
 */

/**
 * A leading integer or decimal, and nothing cleverer.
 *
 * Anchored at the start and followed by a word boundary, so "3 classes" and "3.5
 * hours" match while "batch 3" does not. Deliberately strict: a pattern that
 * hunted for a number anywhere would read "unit 3" as three of something, and a
 * wrong count is worse than no count.
 */
const LEADING_NUMBER = /^\s*(\d+(?:\.\d+)?)\b/;

export type QuantityReading =
  | { ok: true; value: number }
  | { ok: false };

/**
 * One member's quantity, as a number if it can be read strictly.
 *
 * Null or empty counts as one: the activity happened, they just did not say how
 * many times. That is a statement about the writing, not about the work.
 */
export function readQuantity(text: string | null | undefined): QuantityReading {
  if (text === null || text === undefined || text.trim() === "") return { ok: true, value: 1 };
  const match = LEADING_NUMBER.exec(text);
  if (!match) return { ok: false };
  const value = Number(match[1]);
  return Number.isFinite(value) ? { ok: true, value } : { ok: false };
}

export type GroupCount = {
  /** The summed count, or null when any member could not be read. */
  count: number | null;
  /** False when any member failed. A false group must never display a number. */
  countConfident: boolean;
};

/**
 * The count for a group of members, or nothing.
 *
 * Sums only when every member yields a number. One unreadable quantity and the
 * whole group has no count — see the note at the top of this file for why a
 * partial sum and an item count are both worse than an absence.
 */
export function countFor(quantities: Array<string | null | undefined>): GroupCount {
  let total = 0;
  for (const text of quantities) {
    const reading = readQuantity(text);
    if (!reading.ok) return { count: null, countConfident: false };
    total += reading.value;
  }
  // Two decimals: "1.5 batches" is a thing somebody may write, and floating
  // point addition of those should not surface as 2.9999999999999996.
  return { count: Math.round(total * 100) / 100, countConfident: true };
}

/**
 * The verbatim quantity strings of the members that have one, in order, without
 * repeats.
 *
 * Shown as context under a group that has no honest count. Deduplicated because
 * five activities all saying "2 classes" is one thing worth telling the reader,
 * not five; ordered by first appearance so it reads in the order the work
 * happened rather than alphabetically.
 */
export function quantityNotes(quantities: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const text of quantities) {
    const value = (text ?? "").trim();
    if (value === "" || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}
