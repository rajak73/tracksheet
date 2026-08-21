import { describe, expect, test } from "vitest";
import { rollUp, type RollupActivity } from "@/domain/rollup";
import { countsAsWorking, didHappen } from "@/domain/working-hours";

/**
 * Every reader of Working Hours must produce the same number.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 * Everything an instructor records is Working Hours. It used to count only time
 * spent with students; the client changed that, and because the rule has one
 * home the change was one function body — every test below except the by-hand
 * total went on passing, because they assert that readers AGREE rather than
 * what the rule happens to be.
 *
 * An absence is still not work: MISSED and EXCUSED are excluded before the
 * question is asked.
 *
 * ── What went wrong before ────────────────────────────────────────────────
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

  test("and that total is every hour that happened, by hand", () => {
    /* The client redefined Working Hours: an instructor writes up what they did
     * and says how long it took, and all of it is their working time. It used
     * to count only student-facing hours and this case asserted 4.5.
     *
     * 2 taught + 1.5 taught + 1 assessment + 3 meeting + 0.5 admin + 1 mentoring.
     * The six hours of MISSED and EXCUSED below are still excluded — an absence
     * is not work, and that rule did not change. */
    expect(rollUp(WEEK).hours).toBeCloseTo(9, 10);
  });

  test("work that is not student-facing now counts", () => {
    // The whole point of the change: preparation, meetings and admin are real
    // work, and the headline figure used to leave them out.
    const meetingOnly = [entry("MEETING", 3), entry("ADMIN", 0.5)];
    expect(rollUp(meetingOnly).hours).toBeCloseTo(3.5, 10);
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
