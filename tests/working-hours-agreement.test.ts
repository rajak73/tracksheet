import { describe, expect, test } from "vitest";
import { rollUp, type RollupActivity } from "@/domain/rollup";
import { countsAsWorking, didHappen } from "@/domain/working-hours";

/**
 * Every reader of Working Hours must produce the same number.
 *
 * ── What went wrong ───────────────────────────────────────────────────────
 * The rule lived inside `rollUp`, and the readers that did not go through
 * `rollUp` did not have it. The week sheet's column — labelled, in the file,
 * "Working Hours" — summed every row it was given: a class nobody gave counted,
 * and so did a meeting. So an instructor's own week and the manager's sheet of
 * the same week printed different totals under the same name, which is the
 * third time this product has had that bug.
 *
 * `status` made it invisible: it was declared on the Activity type and read by
 * nothing, so a MISSED lecture rendered exactly like a taught one.
 *
 * ── What this pins ────────────────────────────────────────────────────────
 * Not the components — the ARITHMETIC they share. Summing the entries
 * `countsAsWorking` accepts must equal `rollUp`'s total, for any input. If a
 * future reader adds up hours some third way, this is what should stop it.
 */

const entry = (
  code: string,
  hours: number,
  opts: { countable?: boolean | null; status?: string; quantity?: number } = {},
): RollupActivity => ({
  durationHours: hours,
  remarks: null,
  status: opts.status,
  activityType: { code, label: code },
  deliverableType:
    opts.countable === undefined || opts.countable === null
      ? null
      : { isCountable: opts.countable },
  quantity: opts.quantity ?? 1,
});

/** A week with every case in it that has ever been got wrong. */
const WEEK: RollupActivity[] = [
  entry("TEACHING", 2, { countable: true }),
  // No deliverable at all: the CATEGORY decides, and teaching counts. Twelve
  // and three quarter hours once vanished exactly here.
  entry("TEACHING", 1.5),
  // A countable category whose deliverable says otherwise — the deliverable is
  // the more specific statement and wins.
  entry("ASSESSMENT", 1, { countable: false }),
  // Real work that is not student-facing. Its hours are shown, never totalled.
  entry("MEETING", 3),
  entry("ADMIN", 0.5),
  // Did not happen. Neither of these is an hour of anything.
  entry("TEACHING", 2, { countable: true, status: "MISSED" }),
  entry("TEACHING", 4, { countable: true, status: "EXCUSED" }),
  // Late is not absent — it happened.
  entry("MENTORING", 1, { status: "LATE" }),
];

const sum = (rows: RollupActivity[]) => rows.reduce((n, a) => n + a.durationHours, 0);

describe("the sheets and the report agree", () => {
  test("summing what countsAsWorking accepts equals rollUp's total", () => {
    expect(sum(WEEK.filter(countsAsWorking))).toBeCloseTo(rollUp(WEEK).hours, 10);
  });

  test("and that total is the student-facing hours, by hand", () => {
    // 2 (taught) + 1.5 (taught, category fallback) + 1 (mentoring, late but held)
    expect(rollUp(WEEK).hours).toBeCloseTo(4.5, 10);
  });

  test("an absence contributes nothing, however many hours it claims", () => {
    const withAbsences = sum(WEEK.filter(countsAsWorking));
    const withoutTheAbsentRows = sum(
      WEEK.filter((a) => a.status !== "MISSED" && a.status !== "EXCUSED").filter(countsAsWorking),
    );
    expect(withAbsences).toBe(withoutTheAbsentRows);
  });

  test("the grouping cannot change the answer", () => {
    // The 08h/13h45/18h45 bug: the same entries totalled differently by day,
    // week and month because countability was decided per GROUP, not per entry.
    const byDay = [WEEK.slice(0, 3), WEEK.slice(3, 6), WEEK.slice(6)];
    const perDay = byDay.reduce((n, day) => n + rollUp(day).hours, 0);
    expect(perDay).toBeCloseTo(rollUp(WEEK).hours, 10);
  });
});

describe("didHappen", () => {
  test("MISSED and EXCUSED did not", () => {
    expect(didHappen(entry("TEACHING", 1, { status: "MISSED" }))).toBe(false);
    expect(didHappen(entry("TEACHING", 1, { status: "EXCUSED" }))).toBe(false);
  });

  test("everything else did, including rows written before status existed", () => {
    expect(didHappen(entry("TEACHING", 1, { status: "COMPLETED" }))).toBe(true);
    expect(didHappen(entry("TEACHING", 1, { status: "LATE" }))).toBe(true);
    expect(didHappen(entry("TEACHING", 1))).toBe(true);
  });
});
