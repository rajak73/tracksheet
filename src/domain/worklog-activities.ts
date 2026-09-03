/**
 * The activity rows an instructor authored, and what a day derives from them.
 *
 * ── What this ends ────────────────────────────────────────────────────────
 * Two boxes joined by nothing but position. A day reading "1, 1, 12, 1, 4, 1,
 * 1, 1, 6" beside nine descriptions, and one real day with five descriptions
 * against four numbers, so even counting them off failed. Nobody meant to write
 * that; the form asked for it.
 *
 * A quantity now lives on the row it belongs to, so the pairing is a fact the
 * instructor stated rather than one anybody has to infer. For these days the
 * numbers are GIVEN, not extracted.
 */

/** One row, as it is stored. `minutes` is computed on the server, never sent. */
export type ActivityRow = {
  description: string;
  /**
   * How many. Null means it was not counted.
   *
   * Blank and zero are different facts and must stay different: a meeting or a
   * debugging session has no count, while `0` would claim zero classes
   * happened. Nothing here may turn one into the other.
   */
  quantity: number | null;
  /** `Hr × 60 + Min`. Blank Hr and Min genuinely mean no time, so zero is right. */
  minutes: number;
};

/** What the client sends for one row, before the server computes anything. */
export type SubmittedRow = {
  description: string;
  quantity: number | null;
  hr: number;
  min: number;
};

/** A row counts as filled when it says what was done. */
export const isFilled = (row: { description: string }) => row.description.trim() !== "";

/** A row carrying numbers but no description says nothing and is refused. */
export const hasOrphanNumbers = (row: SubmittedRow) =>
  !isFilled(row) && (row.quantity !== null || row.hr > 0 || row.min > 0);

/**
 * `90` minutes becomes 1 hour 30. Applied on blur in the form and again here,
 * because a client that skipped it must not be able to store `min: 90`.
 */
export function normaliseRow(row: SubmittedRow): ActivityRow {
  const total = Math.max(0, Math.trunc(row.hr)) * 60 + Math.max(0, Math.trunc(row.min));
  return {
    description: row.description.trim(),
    quantity: row.quantity === null ? null : Math.max(0, Math.trunc(row.quantity)),
    minutes: total,
  };
}

/**
 * The day's total, from the rows and only from the rows.
 *
 * Never taken from the client. A calculated field the caller can override is
 * not calculated, and a total the rows do not support is exactly the kind of
 * number that gets believed.
 */
export const totalMinutes = (rows: ActivityRow[]) => rows.reduce((n, r) => n + r.minutes, 0);

/**
 * The client's own sheet still has Deliverable and Deliverable Quantity, so
 * both are still shown and exported — derived from the rows at read time rather
 * than stored a second time, because two copies of one fact eventually disagree.
 */
export const deliverableFrom = (rows: ActivityRow[]) => rows.map((r) => r.description).join("\n");

export const quantityFrom = (rows: ActivityRow[]) => {
  const stated = rows.filter((r) => r.quantity !== null).map((r) => String(r.quantity));
  return stated.length ? stated.join(", ") : null;
};

/** Rows as stored, or null for a legacy day that has none. */
export function parseActivities(value: unknown): ActivityRow[] | null {
  if (!Array.isArray(value)) return null;
  const out: ActivityRow[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.description !== "string") return null;
    if (typeof r.minutes !== "number") return null;
    const q = r.quantity;
    if (q !== null && typeof q !== "number") return null;
    out.push({ description: r.description, quantity: (q as number | null) ?? null, minutes: r.minutes });
  }
  return out;
}
