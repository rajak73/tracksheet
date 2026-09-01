/**
 * Whether the stored metric tables can still be believed.
 *
 * ── Why this exists, and why it is temporary ──────────────────────────────
 * `InstructorDailyMetric` and `UniversityDailyMetric` are a cache over
 * `ActivityLog`, refreshed by `recomputeDay`. The instructor's worklog now
 * writes `WorklogEntry`, which `recomputeDay` does not read and cannot be made
 * to read — it summarises a table that is being retired. The route that used to
 * refresh a day on every write has gone with the model it belonged to.
 *
 * So every figure computed from those tables describes work as it stood before
 * the write path moved, and nothing in the data says so. A wrong number with
 * nothing marking it wrong is worse than a missing one: somebody is looking at
 * that dashboard now, and a manager acting on a stale utilisation figure cannot
 * tell it apart from a real one.
 *
 * ── Why every day, rather than the affected ones ──────────────────────────
 * The intention was to mark only days written since the move. It cannot be done
 * from timestamps: the quantity-pairing migration touched every row, so all 45
 * carry an `updatedAt` after the move and none can be distinguished from a day
 * an instructor actually rewrote.
 *
 * Over-marking is recoverable — a figure comes back when analytics replaces it.
 * Under-marking leaves a wrong number on screen looking exactly like a right
 * one. So the whole set is marked.
 *
 * ── Removing this ─────────────────────────────────────────────────────────
 * Delete this file. Every consumer imports from here precisely so that the
 * marking cannot be half-removed: the compiler will name every site.
 */

export type StoredMetricsStatus = {
  /** False while the tables describe a source the product no longer writes. */
  available: false;
  /** Shown to the reader, verbatim. One line, no jargon, no blame. */
  note: string;
};

/**
 * The one answer, shared by every route that reads a stored metric.
 *
 * A constant rather than a function of the period: the gap is not "some days
 * are stale", it is "this cache no longer has a writer".
 */
export const STORED_METRICS: StoredMetricsStatus = {
  available: false,
  note: "Being migrated — these figures are computed from data the worklog no longer writes to, so they are not shown rather than shown wrong.",
};
