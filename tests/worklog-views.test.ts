import { describe, expect, test } from "vitest";
import {
  addDays,
  buildPeriodRow,
  mondayOf,
  remarksFor,
  weekOf,
  weeksOfMonth,
  type RowActivity,
} from "@/domain/worklog-rows";
import { deliverableCell, quantityCell, workingHours } from "@/domain/worklog-report";

/**
 * The rows every view is built from, for both roles.
 *
 * ── Why these are not rendering tests ─────────────────────────────────────
 * What each screen must get right is the ROW: which activities merge, what the
 * period totals, whether an empty period is a miss or a day that has not
 * happened. That is `buildPeriodRow`, and both roles call it — so a case
 * proved here is proved for the instructor's screen and the manager's at once,
 * which is the whole reason the merge lives in one place.
 *
 * Sticky columns and shading are CSS, and a test asserting a class name proves
 * only that somebody typed the class name.
 */

const TODAY = "2026-08-19"; // a Wednesday
const act = (
  workDate: string,
  label: string,
  hours: number,
  opts: { subject?: string; quantity?: number | null; remarks?: string; startTime?: string } = {},
): RowActivity => ({
  workDate,
  durationHours: hours,
  remarks: opts.remarks ?? null,
  startTime: opts.startTime,
  activityType: { code: "TEACHING", label: "Teaching" },
  deliverableType: { code: label, isCountable: true },
  broadCategory: opts.subject ? { label: opts.subject } : null,
  quantity: opts.quantity === undefined ? 1 : opts.quantity,
});

const row = (dates: string[], activities: RowActivity[], notes: Record<string, string> = {}) =>
  buildPeriodRow({ key: "k", label: "l", dates, activities, dayNotes: notes, today: TODAY });

describe("1 — a day merges the same deliverable across two subjects", () => {
  test("a Tech class and a Maths class become one line", () => {
    const built = row(
      [TODAY],
      [
        act(TODAY, "LECTURE", 2, { subject: "Technical" }),
        act(TODAY, "LECTURE", 1.5, { subject: "Mathematics" }),
      ],
    );
    expect(built.lines, "one line, not two").toHaveLength(1);
    expect(deliverableCell(built.lines)).toBe("Live Class - 3h 30m");
    expect(quantityCell(built.lines)).toBe("2 Classes");
  });

  test("and both subjects are still named", () => {
    const built = row(
      [TODAY],
      [
        act(TODAY, "LECTURE", 2, { subject: "Technical" }),
        act(TODAY, "LECTURE", 1.5, { subject: "Mathematics" }),
      ],
    );
    expect(built.subjects).toEqual(["Technical", "Mathematics"]);
  });

  test("different deliverables stay apart", () => {
    const built = row(
      [TODAY],
      [act(TODAY, "LECTURE", 2), act(TODAY, "STUDENT_QUERY_RESOLUTION", 0.75)],
    );
    expect(deliverableCell(built.lines)).toBe("Live Class - 2h, Doubt Clearing - 45m");
  });
});

describe("2 — an unstated count reads the same for both roles, in every view", () => {
  /* Both roles call this builder, so one assertion covers both screens. The
   * three views differ only in which dates they hand it. */
  const unstated = [act(TODAY, "ASSIGNMENT_EVALUATION", 1, { quantity: null })];

  test("day", () => {
    expect(quantityCell(row([TODAY], unstated).lines)).toBe("? Assignments");
  });

  test("week", () => {
    expect(quantityCell(row(weekOf(TODAY), unstated).lines)).toBe("? Assignments");
  });

  test("month", () => {
    const dates = weeksOfMonth("2026-08").flatMap((w) => w.dates);
    expect(quantityCell(row(dates, unstated).lines)).toBe("? Assignments");
  });

  test("one unknown makes the period unknown, never a partial sum", () => {
    const mixed = [
      act(TODAY, "ASSIGNMENT_EVALUATION", 1, { quantity: 12 }),
      act(TODAY, "ASSIGNMENT_EVALUATION", 1, { quantity: null }),
    ];
    expect(quantityCell(row([TODAY], mixed).lines), "not 12").toBe("? Assignments");
  });
});

describe("3 & 5 — nothing recorded, and the two reasons are different", () => {
  test("a day that passed with nothing on it is missing", () => {
    expect(row(["2026-08-17"], []).state).toBe("missing");
  });

  test("a day that has not happened is not a miss", () => {
    expect(row(["2026-08-21"], []).state).toBe("future");
  });

  test("today with nothing on it is still a miss, not the future", () => {
    expect(row([TODAY], []).state).toBe("missing");
  });

  test("a week holding today is in progress, not future", () => {
    // Its passed days can each be missing; the week itself has started.
    expect(row(weekOf(TODAY), []).state).toBe("missing");
  });

  test("a week entirely ahead is future", () => {
    expect(row(weekOf(addDays(TODAY, 14)), []).state).toBe("future");
  });

  test("anything recorded outranks both", () => {
    expect(row([TODAY], [act(TODAY, "LECTURE", 1)]).state).toBe("recorded");
  });
});

describe("6 — a missing week is detected per week, not per instructor", () => {
  const weeks = weeksOfMonth("2026-08");
  /* Present in weeks 1, 3 and 4; absent in week 2. The failure this guards is
   * a check that asks "did this person file this month" and paints every week
   * the same. */
  const activities = weeks
    .filter((w) => w.index !== 2)
    .map((w) => act(w.dates[0]!, "LECTURE", 2));

  test("only week two reads as missing", () => {
    const states = weeks.map((w) => row(w.dates, activities).state);
    expect(states[1]).toBe("missing");
    for (const index of [0, 2, 3]) {
      if (weeks[index]) expect(states[index], `week ${index + 1}`).toBe("recorded");
    }
  });

  test("the other weeks keep their own figures", () => {
    const built = row(weeks[0]!.dates, activities);
    expect(built.totalMinutes).toBe(120);
    expect(deliverableCell(built.lines)).toBe("Live Class - 2h");
  });
});

describe("7 — the periods a month is made of", () => {
  test("weeks are clipped to the month, so week one is not last month", () => {
    const weeks = weeksOfMonth("2026-08");
    expect(weeks[0]!.dates[0]).toBe("2026-08-01");
    expect(weeks.at(-1)!.dates.at(-1)).toBe("2026-08-31");
  });

  test("every day of the month appears exactly once", () => {
    const dates = weeksOfMonth("2026-08").flatMap((w) => w.dates);
    expect(dates).toHaveLength(31);
    expect(new Set(dates).size, "no day in two weeks").toBe(31);
  });

  test("weeks are numbered in chronological order", () => {
    const weeks = weeksOfMonth("2026-08");
    expect(weeks.map((w) => w.index)).toEqual(weeks.map((_, i) => i + 1));
    for (let i = 1; i < weeks.length; i++) {
      expect(weeks[i]!.dates[0]! > weeks[i - 1]!.dates[0]!).toBe(true);
    }
  });

  test("a week runs Monday to Sunday", () => {
    expect(mondayOf("2026-08-19"), "Wednesday belongs to Monday's week").toBe("2026-08-17");
    expect(mondayOf("2026-08-23"), "Sunday belongs to the week that started").toBe("2026-08-17");
    expect(weekOf("2026-08-19")).toHaveLength(7);
    expect(weekOf("2026-08-19")[0]).toBe("2026-08-17");
  });
});

describe("the Remarks column composes from two places", () => {
  test("the day's own note wins over the entries' remarks", () => {
    /* The day note is the instructor speaking about the whole day and is the
     * more considered of the two. */
    const built = row(
      [TODAY],
      [act(TODAY, "LECTURE", 1, { remarks: "per-entry note" })],
      { [TODAY]: "the day note" },
    );
    expect(built.remarks).toBe("the day note");
  });

  test("without one, the entries' own remarks stand in, de-duplicated", () => {
    const built = row(
      [TODAY],
      [
        act(TODAY, "LECTURE", 1, { remarks: "binary trees" }),
        act(TODAY, "LECTURE", 1, { remarks: "binary trees" }),
        act(TODAY, "LECTURE", 1, { remarks: "section B" }),
      ],
    );
    expect(built.remarks).toBe("binary trees, section B");
  });

  test("a period spanning days joins them in date order, skipping the empty", () => {
    const dates = ["2026-08-17", "2026-08-18", "2026-08-19"];
    expect(
      remarksFor(
        dates,
        [
          act("2026-08-19", "LECTURE", 1, { remarks: "wednesday" }),
          act("2026-08-17", "LECTURE", 1, { remarks: "monday" }),
        ],
        {},
      ),
    ).toBe("monday; wednesday");
  });

  test("a period with nothing said about it says nothing", () => {
    expect(row([TODAY], [act(TODAY, "LECTURE", 1)]).remarks).toBe("");
  });
});

describe("hours are always Xh Ym, never a decimal", () => {
  test("across every period shape", () => {
    const built = row([TODAY], [act(TODAY, "LECTURE", 2.25)]);
    expect(built.totalMinutes).toBe(135);
    expect(workingHours(built.totalMinutes)).toBe("02h 15m");
  });

  test("a week sums its days", () => {
    const built = row(weekOf(TODAY), [
      act("2026-08-17", "LECTURE", 2),
      act("2026-08-19", "LECTURE", 1.5),
    ]);
    expect(workingHours(built.totalMinutes)).toBe("03h 30m");
  });
});
