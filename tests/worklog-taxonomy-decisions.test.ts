import { describe, expect, test } from "vitest";
import {
  CATEGORIES,
  DELIVERABLES,
  deliverableFor,
  deliverableNamed,
  quantityPhrase,
  quantityWhenUnstated,
} from "@/domain/worklog-taxonomy";
import { broadCategoryCell, subjectsCell, NOT_PROVIDED } from "@/domain/worklog-report";

/**
 * The five decisions, as rules rather than as prose.
 *
 * ── Why these are asserted structurally, not by calling the model ─────────
 * Four of the five are classification behaviour, and what a model answers today
 * is not what it answers next month. What must hold whatever it answers is the
 * shape underneath: which category a name belongs to, what its unit counts, and
 * that no name outside the list can be produced. Those are the things that make
 * a wrong classification recoverable rather than silent.
 *
 * The model's own behaviour on the twelve sentences these decisions came from is
 * exercised by `npm run worklog:sample`, for the same reason the AI narration
 * has a script rather than a test: one that passes with no key is worse than
 * none.
 */

describe("Decision 1 — two fields, never one", () => {
  test("Instructor Category answers what somebody IS", () => {
    expect(broadCategoryCell({ label: "Technical" })).toBe("Instructor - Technical");
    // Assigned, so an absence is somebody not having filled it in.
    expect(broadCategoryCell(null)).toBe(NOT_PROVIDED);
  });

  test("Subjects Covered answers what they DID, and lists all of it", () => {
    expect(subjectsCell(["Tech", "Maths"])).toBe("Tech, Maths");
    expect(subjectsCell(["Tech", "Tech", "Maths"]), "distinct, in order").toBe("Tech, Maths");
  });

  test("a period that named no subject is empty, not Not Provided", () => {
    /* A day of meetings and admin names no subject and the model is told to
     * return null rather than reach for one. "Not Provided" would say somebody
     * forgot to fill something in; an em dash says there was nothing to fill. */
    expect(subjectsCell([])).toBe("—");
    expect(subjectsCell([null, undefined, "  "])).toBe("—");
  });

  test("the two are independent — neither substitutes for the other", () => {
    // A Technical instructor who spent the period on Maths shows both facts.
    expect(broadCategoryCell({ label: "Technical" })).toBe("Instructor - Technical");
    expect(subjectsCell(["Maths"])).toBe("Maths");
  });
});

describe("Decision 2 — Lab Evaluation", () => {
  const lab = deliverableNamed("Lab Evaluation")!;

  test("it is its own name, no longer Exam Evaluation's", () => {
    expect(lab).toBeTruthy();
    expect(deliverableFor("LAB_EVALUATION", null).name).toBe("Lab Evaluation");
    expect(deliverableFor("EXAM_EVALUATION", null).name).toBe("Exam Evaluation");
  });

  test("it is countable, like both of its Assessment siblings", () => {
    expect(lab.category).toBe("Assessment");
    for (const sibling of ["Assignment Evaluation", "Exam Evaluation"]) {
      expect(deliverableNamed(sibling)!.counting, sibling).toBe("items");
    }
    expect(lab.counting).toBe("items");
  });

  test("the unit counts items evaluated, not students and not sessions", () => {
    expect(quantityPhrase(lab, 8)).toBe("8 Lab Evaluations");
    expect(quantityPhrase(lab, 1)).toBe("1 Lab Evaluation");
  });

  test("an unstated count is a question mark, never a one", () => {
    /* The category must not move with the phrasing. Whether a number was
     * written decides the QUANTITY and nothing else — it used to decide which
     * category the work was filed under. */
    expect(quantityWhenUnstated(lab)).toBeNull();
    expect(quantityPhrase(lab, null)).toBe("? Lab Evaluations");
  });

  test("lab teaching and lab marking stay different things", () => {
    expect(deliverableFor("LAB_SESSION", null).category).toBe("Teaching");
    expect(deliverableFor("LAB_EVALUATION", null).category).toBe("Assessment");
  });
});

describe("Decision 3 — Meeting (Other)", () => {
  const other = deliverableNamed("Meeting (Other)")!;
  const department = deliverableNamed("Department Meeting")!;

  test("it exists, under Administrative, treated like Department Meeting", () => {
    expect(other).toBeTruthy();
    expect(other.category).toBe("Administrative");
    expect(other.counting, "the same treatment as its sibling").toBe(department.counting);
  });

  test("Department Meeting is governance only", () => {
    for (const code of ["DEPARTMENT_MEETING", "FACULTY_MEETING"]) {
      expect(deliverableFor(code, null).name, code).toBe("Department Meeting");
    }
  });

  test("anything with a student in it is not a Department Meeting", () => {
    for (const code of ["STUDENT_MEETING", "PROJECT_MEETING"]) {
      expect(deliverableFor(code, null).name, code).toBe("Meeting (Other)");
    }
  });

  test("the governance count can no longer be reached by a student meeting", () => {
    // Before this, every one of these four printed "1 Department Meeting" and
    // added to the same total a manager reads as "the department met".
    const governance = ["DEPARTMENT_MEETING", "FACULTY_MEETING", "STUDENT_MEETING", "PROJECT_MEETING"]
      .filter((code) => deliverableFor(code, null).name === "Department Meeting");
    expect(governance).toEqual(["DEPARTMENT_MEETING", "FACULTY_MEETING"]);
  });
});

describe("Decision 4 — Department Duties", () => {
  const duties = deliverableNamed("Department Duties")!;

  test("it exists under Administrative, hours only", () => {
    expect(duties).toBeTruthy();
    expect(duties.category).toBe("Administrative");
    // "How many admissions paperworks" is not a question anybody asks.
    expect(duties.counting).toBe("none");
    expect(quantityPhrase(duties, 3), "never appears in the quantity column").toBeNull();
  });

  test("departmental duty is no longer called Documentation", () => {
    expect(deliverableFor("DEPARTMENT_WORK", null).name).toBe("Department Duties");
  });

  test("Documentation is reserved for writing documents", () => {
    for (const code of ["DOCUMENTATION", "RECORD_MAINTENANCE"]) {
      expect(deliverableFor(code, null).name, code).toBe("Documentation");
    }
  });
});

describe("Decision 5 — Data Analysis", () => {
  const analysis = deliverableNamed("Data Analysis")!;

  test("it exists under Research, hours only", () => {
    expect(analysis).toBeTruthy();
    expect(analysis.category).toBe("Research");
    expect(analysis.counting).toBe("none");
  });

  test("analysis can never demand a count of experiments", () => {
    // "? Experiments" against somebody who ran none was the failure.
    expect(quantityPhrase(analysis, null)).toBeNull();
    expect(quantityWhenUnstated(analysis)).toBeNull();
  });

  test("Research's three verbs stay three different things", () => {
    expect(deliverableFor("LITERATURE_REVIEW", null).name, "reading").toBe("Literature Review");
    expect(deliverableFor("EXPERIMENT", null).name, "running").toBe("Experiment");
    expect(deliverableFor("RESEARCH_PAPER", null).name, "writing").toBe("Research Paper");
  });

  test("analysing is none of those three", () => {
    for (const code of ["RESEARCH_ANALYSIS", "DATA_ANALYSIS"]) {
      expect(deliverableFor(code, null).name, code).toBe("Data Analysis");
    }
  });

  test("Experiment stays countable, because running one is a discrete thing", () => {
    expect(deliverableNamed("Experiment")!.counting).toBe("items");
  });
});

describe("the taxonomy after all five", () => {
  test("eight categories, twenty-five deliverables", () => {
    expect(CATEGORIES).toHaveLength(8);
    expect(DELIVERABLES).toHaveLength(25);
  });

  test("every deliverable belongs to one of the eight", () => {
    const known = new Set<string>(CATEGORIES);
    for (const d of DELIVERABLES) {
      expect(known.has(d.category), `${d.name} -> ${d.category}`).toBe(true);
    }
  });

  test("every stored code still resolves, and no code resolves twice", () => {
    const seen = new Set<string>();
    for (const d of DELIVERABLES) {
      for (const code of d.codes) {
        expect(seen.has(code), `${code} is claimed by two deliverables`).toBe(false);
        seen.add(code);
        expect(deliverableFor(code, null).name).toBe(d.name);
      }
    }
    expect(seen.size, "all 44 stored deliverables have a home").toBe(44);
  });

  test("a counted deliverable has a unit; an uncounted one has none", () => {
    for (const d of DELIVERABLES) {
      if (d.counting === "none") {
        expect(d.unit, d.name).toBe("");
        expect(quantityPhrase(d, 5), d.name).toBeNull();
      } else {
        expect(d.unit.length, d.name).toBeGreaterThan(0);
        expect(d.units.length, d.name).toBeGreaterThan(0);
      }
    }
  });
});
