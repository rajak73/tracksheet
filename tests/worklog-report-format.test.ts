import { describe, expect, test } from "vitest";
import {
  DELIVERABLES,
  deliverableFor,
  deliverableNamed,
  quantityPhrase,
  quantityWhenUnstated,
  sumQuantities,
  UNSTATED,
} from "@/domain/worklog-taxonomy";
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
const line = (name: string, minutes: number, quantity: number | null = 0) => {
  const firstAt = nextAt;
  nextAt += minutes + 15;
  return { name, minutes, quantity, firstAt };
};
/** A line with no position on the clock — a week cell, or planned progress. */
const unplaced = (name: string, minutes: number, quantity: number | null = 0) => ({
  name,
  minutes,
  quantity,
});

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

  test("the unit belongs to the deliverable, never to a pluralised name", () => {
    // "1 Doubt Clearings" is what pluralising the name produced.
    expect(quantityCell([line("Doubt Clearing", 45, 1)])).toBe("1 Doubt Session");
    expect(quantityCell([line("Doubt Clearing", 90, 3)])).toBe("3 Doubt Sessions");
    expect(quantityCell([line("Exam Evaluation", 60, 20)])).toBe("20 Scripts");
    expect(quantityCell([line("Academic Guidance", 60, 3)])).toBe("3 Guidance Sessions");
  });

  test("a line nobody counted is left out rather than printed as zero", () => {
    expect(quantityCell([line("Live Class", 120, 1), line("Slide Preparation", 45, 0)])).toBe(
      "1 Class",
    );
  });

  test("every counted deliverable has a unit for one and for many", () => {
    for (const d of DELIVERABLES.filter((x) => x.counting !== "none")) {
      expect(quantityPhrase(d, 1), d.name).toBe(`1 ${d.unit}`);
      expect(quantityPhrase(d, 4), d.name).toBe(`4 ${d.units}`);
      expect(d.unit.length, d.name).toBeGreaterThan(0);
    }
  });

  test("a deliverable that is never counted has no entry in the column", () => {
    // Hours only. A unit with no number beside it would be worse than absence.
    for (const d of DELIVERABLES.filter((x) => x.counting === "none")) {
      expect(quantityPhrase(d, null), d.name).toBeNull();
      expect(quantityPhrase(d, 3), d.name).toBeNull();
      expect(quantityCell([line(d.name, 60, 3)]), d.name).toBe("—");
    }
  });
});

describe("a count nobody stated stays visibly unknown", () => {
  /**
   * ── The rule the client wrote out twice ─────────────────────────────────
   * "graded some assignments" with no number must render `? Assignments`, never
   * `1 Assignment`. An invented 1 is not a smaller error than an invented 12 —
   * it is a wrong number with nothing about it that looks wrong, sitting in the
   * column whose entire purpose is how many.
   *
   * The exception is as precise: for a unit that counts OCCURRENCES, the entry
   * IS one of them, so 1 is a fact. "Attended the department meeting" is one
   * meeting by definition and needs nobody to have counted it.
   */

  test("an unstated item count prints the client's question mark", () => {
    expect(quantityCell([line("Assignment Evaluation", 120, null)])).toBe("? Assignments");
    expect(quantityCell([line("Exam Evaluation", 60, null)])).toBe("? Scripts");
    expect(quantityCell([line("Experiment", 90, null)])).toBe("? Experiments");
  });

  test("it is never quietly dropped", () => {
    // `> 0` is false for null, so a filter on it made the unknown invisible —
    // which is worse than a wrong number, because nobody can see it went.
    const cell = quantityCell([line("Live Class", 120, 1), line("Assignment Evaluation", 60, null)]);
    expect(cell).toContain(UNSTATED);
    expect(cell).toBe("1 Class, ? Assignments");
  });

  test("an occurrence needs nobody to have counted it", () => {
    for (const name of ["Live Class", "Department Meeting", "Workshop Attended", "Doubt Clearing"]) {
      const d = deliverableNamed(name)!;
      expect(quantityWhenUnstated(d), name).toBe(1);
    }
  });

  test("an item count is never invented", () => {
    for (const name of [
      "Assignment Evaluation",
      "Exam Evaluation",
      "Question Paper Preparation",
      "Research Paper",
      "Experiment",
    ]) {
      const d = deliverableNamed(name)!;
      expect(quantityWhenUnstated(d), name).toBeNull();
    }
  });

  test("something never counted stays uncounted either way", () => {
    for (const name of ["Literature Review", "Reporting", "Documentation", "Self-Learning"]) {
      expect(quantityWhenUnstated(deliverableNamed(name)!), name).toBeNull();
    }
  });

  test("one unknown makes the total unknown", () => {
    // Twelve assignments plus an unstated number of assignments is not twelve.
    expect(sumQuantities([12, null])).toBeNull();
    expect(sumQuantities([null, null])).toBeNull();
    expect(sumQuantities([12, 8])).toBe(20);
  });

  test("an unknown is not a zero", () => {
    // Zero is a count. "None" and "nobody said" are answers a manager acts on
    // differently, and the column has to be able to tell them apart.
    expect(quantityCell([line("Assignment Evaluation", 60, 0)])).toBe("—");
    expect(quantityCell([line("Assignment Evaluation", 60, null)])).toBe("? Assignments");
  });

  test("a day of nothing but unknowns still says so", () => {
    expect(sumQuantities([])).toBeNull();
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
  test("the subjects the period touched, in the order first seen", () => {
    expect(broadCategoryCell(["Technical", "Maths"])).toBe("Technical, Maths");
  });

  test("each subject once, however many entries named it", () => {
    expect(broadCategoryCell(["Tech", "Tech", "Maths"])).toBe("Tech, Maths");
    expect(broadCategoryCell(["Tech", "tech"]), "case-insensitively").toBe("Tech");
  });

  test("a period that named no subject reads as empty, not Not Provided", () => {
    /* The column is read from the work now, so a blank is not somebody failing
     * to fill a field in — a day of meetings and admin genuinely names no
     * subject. "Not Provided" belonged to the assigned column, which is gone. */
    expect(broadCategoryCell([])).toBe("—");
    expect(broadCategoryCell([null, undefined, "  "])).toBe("—");
    expect(broadCategoryCell([])).not.toBe(NOT_PROVIDED);
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
    expect(deliverableFor("LECTURE", "TEACHING").name).toBe("Live Class");
    expect(deliverableFor("STUDENT_QUERY_RESOLUTION", "STUDENT_SUPPORT").name).toBe("Doubt Clearing");
    expect(deliverableFor("ASSIGNMENT_EVALUATION", "ASSESSMENT").name).toBe("Assignment Evaluation");
    expect(deliverableFor("DEPARTMENT_MEETING", "MEETING").name).toBe("Department Meeting");
    expect(deliverableFor("SLIDES", "CONTENT_DEVELOPMENT").name).toBe("Slide Preparation");
  });

  test("every stored deliverable resolves, and only to a name on the list", () => {
    // 44 stored codes onto 21 printable names. A code with no home would print
    // "Other / Unclassified Work" against real teaching.
    const allowed = new Set(DELIVERABLES.map((d) => d.name));
    for (const d of DELIVERABLES) {
      for (const code of d.codes) {
        expect(deliverableFor(code, null).name, code).toBe(d.name);
        expect(allowed.has(deliverableFor(code, null).name)).toBe(true);
      }
    }
  });

  test("a row with no deliverable is still named by its category", () => {
    expect(deliverableFor(null, "TEACHING").name).toBe("Live Class");
    expect(deliverableFor(undefined, "ASSESSMENT").name).toBe("Assignment Evaluation");
    expect(deliverableFor(null, "LEARNING").name, "hours against no artefact").toBe("Self-Learning");
  });

  test("nothing outside the list can be produced, whatever comes in", () => {
    const allowed = new Set(DELIVERABLES.map((d) => d.name));
    for (const [deliverable, category] of [
      ["INVENTED_CODE", "ALSO_INVENTED"],
      [null, null],
      ["", ""],
    ] as Array<[string | null, string | null]>) {
      expect(allowed.has(deliverableFor(deliverable, category).name)).toBe(true);
    }
  });

  test("every name resolves to itself, so the report can round-trip", () => {
    for (const d of DELIVERABLES) {
      expect(deliverableNamed(d.name)).toEqual(d);
    }
    expect(deliverableNamed("Live Classes"), "a plural is not a name in the list").toBeNull();
  });
});
