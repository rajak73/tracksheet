/**
 * How the client's report cells are written — in one place, for every reader.
 *
 * ── Why this is shared rather than done where it is shown ─────────────────
 * The same four cells are produced twice: once by the tracker grid on screen
 * and once by its CSV export, whose own comment promised "the same strings the
 * grid shows, so a screenshot and the CSV agree". They did not quite: the grid
 * wrote "Lecture – 2.5h" and the export wrote "Lecture – 2.5h" only because two
 * separate pieces of code happened to still match. The instructor's own report
 * screen wrote a third variant.
 *
 * Three copies of a format the client specified to the character is three
 * chances to disagree with them, and the disagreement shows up in the artefact
 * they actually read. So the format lives here and the readers call it.
 *
 * ── The client's format, exactly ──────────────────────────────────────────
 *   Deliverable            "Live Class - 2h, Doubt Clearing - 45m"
 *   Deliverable Quantity   "1 Class, 12 Assignments"
 *   Working Hours          "05h 15m"
 *
 * A hyphen between name and duration, not an en dash. Commas between entries,
 * not semicolons. Hours always two digits. None of that is decoration — it is
 * what their sheet has always looked like.
 */

import {
  deliverableNamed,
  quantityPhrase,
  UNSTATED,
  type Deliverable,
} from "@/domain/worklog-taxonomy";

/** One named line of work in a report cell. */
export type ReportLine = {
  /** One of the client's activity names. */
  name: string;
  minutes: number;
  /**
   * `null` is the client's `?` — the instructor never said how many.
   *
   * Distinct from 0, which is a count. A deliverable that is never counted at
   * all carries null too, and is left out of the column entirely rather than
   * printed with a question mark; `quantityCell` tells the two apart by asking
   * the taxonomy, not by looking at the number.
   */
  quantity: number | null;
  /**
   * When the earliest of these started, as minutes past local midnight.
   *
   * Present wherever the clock is known, absent where it is not — a planned
   * deliverable's progress has hours but no position on the day. See `ordered`.
   */
  firstAt?: number;
};

/** What a cell says when nothing was recorded for it. */
export const NOTHING = "—";

/** What a cell says when the value was never supplied. */
export const NOT_PROVIDED = "Not Provided";

/**
 * `2h`, `45m`, `1h 30m`.
 *
 * Compact because the Deliverable cell holds five of these and the client's
 * example writes them this way. Zero is "0m" rather than blank, so a line that
 * was recorded with no measurable time still reads as a line.
 */
export function compactDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

/**
 * `05h 15m` — the Working Hours column.
 *
 * Two digits on the hours, always, because the column is read down rather than
 * across and ragged numbers make a total hard to scan. Minutes are padded for
 * the same reason.
 */
export function workingHours(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}h ${String(total % 60).padStart(2, "0")}m`;
}

/**
 * The order the client's own example is written in: the order the day happened.
 *
 * ── Chronological, not heaviest-first ─────────────────────────────────────
 * Their example reads "Live Class - 2h, Doubt Clearing - 45m, Assignment
 * Evaluation - 1h, Department Meeting - 45m, Slide Preparation - 45m", which is
 * nine o'clock through four — not the descending order of size that sorting by
 * hours would produce. A day reads as a day, and the Remarks cell beside it
 * narrates the same sequence, so the two would otherwise disagree about what
 * happened when.
 *
 * A line with no position on the clock sorts after the ones that have one,
 * heaviest first — which is every line of a week or month cell, where several
 * days are merged and "when" has no single answer. Ties break on the name so
 * two exports of the same period are diffable.
 */
function ordered(lines: ReportLine[]): ReportLine[] {
  return [...lines].sort(
    (a, b) =>
      (a.firstAt ?? Number.MAX_SAFE_INTEGER) - (b.firstAt ?? Number.MAX_SAFE_INTEGER) ||
      b.minutes - a.minutes ||
      a.name.localeCompare(b.name),
  );
}

/** `"Live Class - 2h, Doubt Clearing - 45m"` */
export function deliverableCell(lines: ReportLine[]): string {
  const parts = ordered(lines).map((l) => `${l.name} - ${compactDuration(l.minutes)}`);
  return parts.length ? parts.join(", ") : NOTHING;
}

/**
 * `"1 Class, ? Assignments, 1 Department Meeting"`
 *
 * ── Three different things a missing number can mean ──────────────────────
 * The client's rule distinguishes them and so does this:
 *
 *   never counted      Literature Review, Reporting, Documentation,
 *                      Self-Learning, Other. There is no unit, so the line is
 *                      absent from this column and its hours speak for it.
 *
 *   counted, unknown   "graded some assignments". Printed `? Assignments`, so
 *                      the gap is visible. Never 1, never 0, never omitted —
 *                      omitting it is how an unknown becomes invisible, which
 *                      is the failure the client called out by name.
 *
 *   counted, zero      a real count of none. Left out, because "0 Classes"
 *                      beside two hours of teaching reads as a contradiction.
 *
 * The unit comes from the taxonomy, never from pluralising the name — "1 Doubt
 * Clearings" is what that produced.
 */
export function quantityCell(lines: ReportLine[]): string {
  const parts: string[] = [];
  for (const line of ordered(lines)) {
    const deliverable: Deliverable | null = deliverableNamed(line.name);
    if (!deliverable) {
      // A name outside the closed list should be impossible by the time it
      // reaches here, but printing the raw count beats printing nothing.
      if (line.quantity !== null && line.quantity > 0) parts.push(`${line.quantity} ${line.name}`);
      continue;
    }
    if (deliverable.counting === "none") continue;
    if (line.quantity !== null && line.quantity <= 0) continue;
    const phrase = quantityPhrase(deliverable, line.quantity);
    if (phrase) parts.push(phrase);
  }
  return parts.length ? parts.join(", ") : NOTHING;
}

/** Re-exported so a renderer can show the client's `?` without a second source. */
export { UNSTATED };

/**
 * The Broad Category column: the category the person was assigned.
 *
 * ── Never derived from what they did ──────────────────────────────────────
 * The client's rule, in their words: "preserve it exactly", and "do not guess
 * the employee's broad category from their activities". This column used to
 * hold the subject their work was judged to be about — inferred per entry and
 * carried forward from the last office day — which is precisely the guess that
 * rule forbids.
 *
 * "Not Provided" when nobody has assigned one. An empty cell that says so is
 * honest; a subject read off a lecture is not, and it would be sitting in the
 * column the whole sheet is grouped by.
 */
export function broadCategoryCell(assigned: { label: string } | null | undefined): string {
  const label = assigned?.label?.trim();
  return label ? `Instructor - ${label}` : NOT_PROVIDED;
}

/** Employee Name and Employee ID: preserved exactly, or said to be missing. */
export function suppliedOr(value: string | null | undefined): string {
  const text = value?.trim();
  return text ? text : NOT_PROVIDED;
}


/* ── Reading the tracker's cells ───────────────────────────────────────────
 * Structural rather than imported types, so this module stays in `domain` and
 * does not depend on the analytics layer that happens to be its busiest caller.
 */

/** What the tracker records for one named line of work in a week. */
export type CellDeliverable = {
  title: string;
  minutes: number;
  /** `null` once anything inside it is unknown. See `ReportLine.quantity`. */
  quantity: number | null;
  /** False for planned-deliverable progress, which is not time with students. */
  countable: boolean;
  /** Earliest start, where the clock is known. Absent for planned deliverables. */
  firstAt?: number;
};

/** Every line in the cell, for the Deliverable column. */
export function reportLines(deliverables: readonly CellDeliverable[]): ReportLine[] {
  return deliverables.map((d) => ({
    name: d.title,
    minutes: d.minutes,
    quantity: d.quantity,
    firstAt: d.firstAt,
  }));
}

/**
 * Only the lines a count means something for, for the Quantity column.
 *
 * The client's rule is not to invent quantities, and a planned deliverable's
 * progress has no unit of its own to count in.
 */
export function countableLines(deliverables: readonly CellDeliverable[]): ReportLine[] {
  /* An unknown count is kept, deliberately. Filtering on `> 0` dropped it —
   * null is not greater than zero — and a dropped unknown is exactly the silent
   * disappearance the client's `?` exists to prevent. `quantityCell` decides
   * what to print; this only decides what is a candidate. */
  return reportLines(
    deliverables.filter((d) => d.countable && (d.quantity === null || d.quantity > 0)),
  );
}

/**
 * The minutes behind the Working Hours column.
 *
 * Deliberately unchanged in what it counts: the same `countable` lines the
 * figure has always been built from. The client's new rules changed how this
 * number is WRITTEN, not which work it is measured over, and quietly widening
 * it here would move a figure their sheet is reconciled against.
 */
export function workedMinutesIn(deliverables: readonly CellDeliverable[]): number {
  return deliverables.reduce((n, d) => n + (d.countable ? d.minutes : 0), 0);
}

/**
 * The Remarks column: one professional line, not a pile of fragments.
 *
 * The client asked for "one concise professional summary". A week's cell
 * collects the notes from several days, so the most this can honestly do is
 * join the distinct ones and punctuate them — inventing a sentence that spans
 * them would be inventing an account of the week. Nothing is characterised,
 * concluded or completed on anybody's behalf.
 */
export function remarksCell(remarks: readonly string[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const remark of remarks) {
    const text = remark.trim().replace(/[.\s]+$/, "");
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    parts.push(text);
  }
  return parts.length ? `${parts.join(", ")}.` : NOTHING;
}
