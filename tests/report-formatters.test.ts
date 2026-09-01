import { describe, expect, test } from "vitest";
import {
  NOT_PROVIDED,
  remarksCell,
  suppliedOr,
  workingHours,
} from "@/domain/worklog-report";

/**
 * The report formatters that outlive the taxonomy.
 *
 * ── Written before the deletion, not after ────────────────────────────────
 * `worklog-report-format.test.ts` is about to go: most of it holds the
 * Deliverable and Deliverable Quantity columns — merged named deliverables,
 * per-deliverable units, the `?` a countable deliverable prints when nobody
 * stated a count — and none of that exists once the tracker moves.
 *
 * Three of its groups were never about the taxonomy. They are here first, so
 * that file can be deleted without taking them, which is exactly how
 * `phase78-insights-admin` took the admin overview's arithmetic with it.
 *
 *   the hours format   — the client specified it to the character
 *   `suppliedOr`       — a missing name says so rather than printing blank
 *   `remarksCell`      — one line, de-duplicated, em dash when there is none
 *
 * All three are still called: the hours format by the instructor's table and
 * the tracker's every cell, the other two by the CSV export.
 */

describe("the hours format", () => {
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

  test("and zero is a real figure, distinct from nothing at all", () => {
    /* The tracker leans on this. A week somebody filed with no hours reads
       "00h 00m"; a week they did not file reads as an em dash, and the two are
       different facts a manager acts on differently. The formatter's job is to
       render zero as zero and never as absence. */
    expect(workingHours(0)).toBe("00h 00m");
    expect(workingHours(0)).not.toBe("—");
  });
});

describe("a name that is missing says so", () => {
  test("preserved exactly, or said to be missing", () => {
    expect(suppliedOr("Arun Verma")).toBe("Arun Verma");
    expect(suppliedOr("NF-001")).toBe("NF-001");
    expect(suppliedOr(null)).toBe(NOT_PROVIDED);
    expect(suppliedOr("")).toBe(NOT_PROVIDED);
  });

  test("a blank string is missing, not a name made of spaces", () => {
    expect(suppliedOr("   ")).toBe(NOT_PROVIDED);
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
