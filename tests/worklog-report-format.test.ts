import { describe, expect, test } from "vitest";
import {
  ACTIVITIES,
  activityFor,
  activityNamed,
  quantityPhrase,
} from "@/domain/worklog-vocabulary";
import {
  broadCategoryCell,
  compactDuration,
  countableLines,
  deliverableCell,
  quantityCell,
  remarksCell,
  suppliedOr,
  workedMinutesIn,
  workingHours,
  NOT_PROVIDED,
} from "@/domain/worklog-report";

/**
 * The client's report, written the way the client writes it.
 *
 * ── Why the exact characters are asserted ─────────────────────────────────
 * These are not style choices. The client supplied the format down to the
 * separator — "Live Class - 2h, Doubt Clearing - 45m", a hyphen not an en dash,
 * commas not semicolons, "05h 15m" with the leading zero — and this sheet is
 * reconciled by hand against a timetable. A column that renders differently on
 * three screens is three columns as far as the person reading it is concerned,
 * which is what these functions exist to prevent.
 */

let nextAt = 9 * 60;
/** Laid out across the day in the order they are written, as a real day is. */
const line = (name: string, minutes: number, quantity = 0) => {
  const firstAt = nextAt;
  nextAt += minutes + 15;
  return { name, minutes, quantity, firstAt };
};
/** A line with no position on the clock — a week cell, or planned progress. */
const unplaced = (name: string, minutes: number, quantity = 0) => ({ name, minutes, quantity });

describe("the Deliverable column", () => {
  test("the client's own example, character for character", () => {
    expect(
      deliverableCell([
        line("Live Class", 120),
        line("Doubt Clearing", 45),
        line("Assignment Evaluation", 60),
        line("Department Meeting", 45),
        line("Slide Preparation", 45),
      ]),
    ).toBe(
      "Live Class - 2h, Doubt Clearing - 45m, Assignment Evaluation - 1h, " +
        "Department Meeting - 45m, Slide Preparation - 45m",
    );
  });

  test("durations read as people write them", () => {
    expect(compactDuration(120)).toBe("2h");
    expect(compactDuration(45)).toBe("45m");
    expect(compactDuration(90)).toBe("1h 30m");
    expect(compactDuration(0)).toBe("0m");
  });

  test("the day is written in the order it happened", () => {
    // Not in descending order of size: the client's example runs nine o'clock
    // through four, and the Remarks cell beside it narrates the same sequence.
    const cell = deliverableCell([
      { name: "Documentation", minutes: 30, quantity: 0, firstAt: 9 * 60 },
      { name: "Live Class", minutes: 120, quantity: 0, firstAt: 11 * 60 },
    ]);
    expect(cell).toBe("Documentation - 30m, Live Class - 2h");
  });

  test("without a clock, the heaviest leads", () => {
    // Every line of a week or month cell, where several days are merged and
    // "when" has no single answer.
    expect(deliverableCell([unplaced("Documentation", 30), unplaced("Live Class", 120)])).toBe(
      "Live Class - 2h, Documentation - 30m",
    );
  });

  test("equal lines are ordered by name rather than by chance", () => {
    // Otherwise the same week exports in a different order each time and a diff
    // of two reports is unreadable.
    expect(deliverableCell([unplaced("Reporting", 60), unplaced("Documentation", 60)])).toBe(
      "Documentation - 1h, Reporting - 1h",
    );
  });

  test("a placed line comes before an unplaced one", () => {
    expect(
      deliverableCell([
        unplaced("Documentation", 600),
        { name: "Live Class", minutes: 30, quantity: 0, firstAt: 9 * 60 },
      ]),
    ).toBe("Live Class - 30m, Documentation - 10h");
  });

  test("a cell with nothing in it says so", () => {
    expect(deliverableCell([])).toBe("—");
  });
});

describe("the Deliverable Quantity column", () => {
  test("the client's own example", () => {
    expect(
      quantityCell([
        line("Live Class", 120, 1),
        line("Doubt Clearing", 45, 1),
        line("Assignment Evaluation", 60, 12),
        line("Department Meeting", 45, 1),
        line("Slide Preparation", 45, 1),
      ]),
      // Their example, in their order — the order of the day, and parallel to
      // the Deliverable cell above it line for line.
    ).toBe(
      "1 Class, 1 Doubt Session, 12 Assignments, 1 Department Meeting, 1 Slide Preparation Task",
    );
  });

  test("the unit belongs to the activity, never to a pluralised name", () => {
    // "1 Doubt Clearings" is what pluralising the name produced.
    expect(quantityCell([line("Doubt Clearing", 45, 1)])).toBe("1 Doubt Session");
    expect(quantityCell([line("Doubt Clearing", 90, 3)])).toBe("3 Doubt Sessions");
    expect(quantityCell([line("Student Mentoring", 60, 3)])).toBe("3 Students Mentored");
    expect(quantityCell([line("Capstone Review", 120, 6)])).toBe("6 Capstone Reports");
  });

  test("a line nobody counted is left out rather than printed as zero", () => {
    expect(quantityCell([line("Live Class", 120, 1), line("Slide Preparation", 45, 0)])).toBe(
      "1 Class",
    );
  });

  test("every activity the client listed has a unit for one and for many", () => {
    for (const activity of ACTIVITIES) {
      expect(quantityPhrase(activity, 1), activity.name).toBe(`1 ${activity.unit}`);
      expect(quantityPhrase(activity, 4), activity.name).toBe(`4 ${activity.units}`);
      expect(activity.unit.length, activity.name).toBeGreaterThan(0);
    }
  });
});

describe("the Working Hours column", () => {
  test("two digits on the hours, always", () => {
    expect(workingHours(315)).toBe("05h 15m");
    expect(workingHours(390)).toBe("06h 30m");
    expect(workingHours(480)).toBe("08h 00m");
    expect(workingHours(285)).toBe("04h 45m");
  });

  test("a short day is a short day", () => {
    // The client's rule, in as many words: never assume an instructor worked
    // eight hours.
    expect(workingHours(45)).toBe("00h 45m");
    expect(workingHours(0)).toBe("00h 00m");
  });

  test("only what a count means something for reaches the figure", () => {
    const cell = [
      { title: "Live Class", minutes: 120, quantity: 1, countable: true },
      { title: "Tracker Course Material", minutes: 60, quantity: 1, countable: false },
    ];
    expect(workedMinutesIn(cell)).toBe(120);
    expect(countableLines(cell).map((l) => l.name)).toEqual(["Live Class"]);
  });
});

describe("the Broad Category column", () => {
  test("the supplied value, preserved exactly", () => {
    expect(broadCategoryCell({ label: "Technical" })).toBe("Instructor - Technical");
  });

  test("nobody assigned one, and none is invented", () => {
    // The rule this enforces: "do not guess the employee's broad category from
    // their activities."
    expect(broadCategoryCell(null)).toBe(NOT_PROVIDED);
    expect(broadCategoryCell(undefined)).toBe(NOT_PROVIDED);
    expect(broadCategoryCell({ label: "   " })).toBe(NOT_PROVIDED);
  });
});

describe("Employee Name and Employee ID", () => {
  test("preserved exactly, or said to be missing", () => {
    expect(suppliedOr("Arun Verma")).toBe("Arun Verma");
    expect(suppliedOr("NF-001")).toBe("NF-001");
    expect(suppliedOr(null)).toBe(NOT_PROVIDED);
    expect(suppliedOr("")).toBe(NOT_PROVIDED);
  });
});

describe("the Remarks column", () => {
  test("one line, punctuated, with nothing repeated", () => {
    expect(remarksCell(["Binary trees covered", "Binary trees covered", "Slides prepared"])).toBe(
      "Binary trees covered, Slides prepared.",
    );
  });

  test("a day nobody wrote a note about gets an empty cell, not a sentence", () => {
    expect(remarksCell([])).toBe("—");
    expect(remarksCell(["", "  "])).toBe("—");
  });
});

describe("the taxonomy speaks the client's vocabulary", () => {
  test("the names in their example map from the taxonomy that stores them", () => {
    expect(activityFor("LECTURE", "TEACHING").name).toBe("Live Class");
    expect(activityFor("STUDENT_QUERY_RESOLUTION", "STUDENT_SUPPORT").name).toBe("Doubt Clearing");
    expect(activityFor("ASSIGNMENT_EVALUATION", "ASSESSMENT").name).toBe("Assignment Evaluation");
    expect(activityFor("DEPARTMENT_MEETING", "MEETING").name).toBe("Department Meeting");
    expect(activityFor("SLIDES", "CONTENT_DEVELOPMENT").name).toBe("Slide Preparation");
  });

  test("a department meeting is not a faculty meeting", () => {
    // Both are in the client's list and they are different words. Collapsing
    // them would be us deciding the report says something it does not.
    expect(activityFor("FACULTY_MEETING", "MEETING").name).toBe("Faculty Meeting");
    expect(activityFor("DEPARTMENT_MEETING", "MEETING").name).toBe("Department Meeting");
  });

  test("a row with no deliverable is still named by its category", () => {
    expect(activityFor(null, "TEACHING").name).toBe("Live Class");
    expect(activityFor(undefined, "ASSESSMENT").name).toBe("Assessment Evaluation");
  });

  test("nothing outside the list can be produced, whatever comes in", () => {
    const allowed = new Set(ACTIVITIES.map((a) => a.name));
    for (const [deliverable, category] of [
      ["INVENTED_CODE", "ALSO_INVENTED"],
      [null, null],
      ["", ""],
    ] as Array<[string | null, string | null]>) {
      expect(allowed.has(activityFor(deliverable, category).name)).toBe(true);
    }
  });

  test("every name resolves to itself, so the report can round-trip", () => {
    for (const activity of ACTIVITIES) {
      expect(activityNamed(activity.name)).toEqual(activity);
    }
    expect(activityNamed("Live Classes"), "a plural is not a name in the list").toBeNull();
  });
});
