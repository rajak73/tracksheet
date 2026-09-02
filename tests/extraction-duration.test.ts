import { describe, expect, test } from "vitest";
import {
  checkExtraction,
  durationMinutes,
  type DayText,
  type ExtractedActivity,
} from "@/server/insights/extraction-checks";

/**
 * A duration is reported as the text states it, and converted in code.
 *
 * ── The bug this closes ───────────────────────────────────────────────────
 * The prompt asked for `hours`. For "checked 25 quiz papers — 45 minutes" the
 * only honest answer is 0.75, and 0.75 is nowhere in the text, so digit
 * provenance rejected it — correctly, and fatally: every line stating minutes
 * failed, which in real instructor data is most of them.
 *
 * Two fields fix it without weakening a check. The model reports 45 and
 * "minutes", both of which are written down; code multiplies. The model still
 * computes nothing, and provenance still refuses anything the text does not say.
 */

const day = (deliverable: string, minutes = 480, quantity: string | null = null): DayText => ({
  deliverable,
  deliverableQuantity: quantity,
  workingMinutes: minutes,
});

const act = (
  label: string,
  sessions: number | null,
  value: number | null,
  unit: "hours" | "minutes" | null,
): ExtractedActivity => ({ label, sessions, duration_value: value, duration_unit: unit });

/** Arun Verma's day, which is what broke the original prompt. */
const REAL_DAY = [
  "doubt clearing session 11:15 AM to 12:00 PM",
  "checked 25 quiz papers — 45 minutes",
  "took java 5 to 6 — 1",
].join("\n");

describe("a duration is stated, never computed", () => {
  test("1. minutes are reported as minutes and converted to minutes", () => {
    const a = act("checked quiz papers", 25, 45, "minutes");
    const r = checkExtraction([a], day("checked 25 quiz papers — 45 minutes"));
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(durationMinutes(a)).toBe(45);
  });

  test("2. hours are reported as hours and converted to minutes", () => {
    const a = act("Live class binary tree", 1, 2, "hours");
    const r = checkExtraction([a], day("Live class on binary tree - 1 class - 2 hours"));
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(durationMinutes(a)).toBe(120);
  });

  test("3. a clock range is not a duration", () => {
    /* THE correctness test. Deriving 45 minutes from 11:15 to 12:00 is a strong
       instinct, and both clock values appear in the text — so provenance alone
       would happily pass a `45` that came from subtraction rather than from
       reading. It is caught because 45 is not among the numbers the segment
       states: 11, 15, 12 and 0 are. */
    const derived = act("doubt clearing session", null, 45, "minutes");
    const r = checkExtraction([derived], day(REAL_DAY));
    expect(!r.ok && r.failures.some((f) => f.check === 1)).toBe(true);

    // The honest extraction of the same line states no duration at all.
    const honest = act("doubt clearing session", null, null, null);
    expect(checkExtraction([honest], day(REAL_DAY)).ok).toBe(true);
  });

  test("3b. nor is a bare range like '5 to 6'", () => {
    const derived = act("took java", 1, 1, "hours");
    /* One hour is "6 minus 5", which the model must not perform. The text states
       5, 6 and 1 — and the 1 is already spoken for by `sessions`, so the
       duration has no occurrence of its own. */
    const r = checkExtraction([derived], day(REAL_DAY));
    expect(!r.ok && r.failures.some((f) => f.check === 6)).toBe(true);
  });

  test("4. a session count with no stated duration passes", () => {
    const a = act("took java", 1, null, null);
    const r = checkExtraction([a], day(REAL_DAY));
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(durationMinutes(a)).toBeNull();
  });

  test("5. one number cannot fill both sessions and duration", () => {
    const line = day("Doubt solving session - 1 hour");
    // Duration only: the text says one HOUR, and that is what is claimed.
    expect(checkExtraction([act("Doubt solving session", null, 1, "hours")], line).ok).toBe(true);

    /* Both: the single `1` would have to vouch twice. Check 1 cannot see this —
       the number IS present — which is exactly why check 6 exists. */
    const both = checkExtraction([act("Doubt solving session", 1, 1, "hours")], line);
    expect(!both.ok && both.failures.some((f) => f.check === 6)).toBe(true);
  });

  test("5b. and two occurrences of the same number support two fields", () => {
    // "1 class" and "1 hour" are two separate statements of 1.
    const r = checkExtraction(
      [act("Live class", 1, 1, "hours")],
      day("Live class - 1 class - 1 hour"),
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });

  test("6. a duration absent from the source is refused", () => {
    const r = checkExtraction(
      [act("Department meeting", null, 90, "minutes")],
      day("Department meeting about the exam schedule"),
    );
    expect(!r.ok && r.failures.some((f) => f.check === 1)).toBe(true);
  });

  test("the whole day reconciles in minutes", () => {
    /* 45 minutes stated, nothing else, against a 6-hour day. The remainder is
       unallocated — a fact, not a failure. */
    const r = checkExtraction(
      [
        act("doubt clearing session", null, null, null),
        act("checked quiz papers", 25, 45, "minutes"),
        act("took java", 1, null, null),
      ],
      day(REAL_DAY, 360),
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.ok && r.unallocatedMinutes).toBe(315);
  });

  test("a duration that would exceed the day is refused", () => {
    const r = checkExtraction(
      [act("checked quiz papers", 25, 45, "minutes")],
      day("checked 25 quiz papers — 45 minutes", 30),
    );
    expect(!r.ok && r.failures.some((f) => f.check === 2)).toBe(true);
  });
});
