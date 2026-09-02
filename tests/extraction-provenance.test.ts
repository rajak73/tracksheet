import { describe, expect, test } from "vitest";
import {
  checkExtraction,
  segments,
  type DayText,
  type ExtractedActivity,
} from "@/server/insights/extraction-checks";

/**
 * Digit provenance, tightened from presence to proximity.
 *
 * ── The assertion this file exists for ────────────────────────────────────
 * "sessions: 5 attached to the wrong activity in a multi-activity string
 * fails." It is the first test below because it is the one the OLD check could
 * not fail: presence anywhere passes for every number against every activity as
 * soon as a day holds more than one. If that test ever goes green against a
 * presence-only check, the hole has been reopened.
 *
 * The migration that paired each migrated activity with its own quantity
 * narrowed this; it did not close it. An instructor writing "3 classes, doubt
 * session, 2 reviews" presents the same shape by hand.
 */

const day = (deliverable: string, quantity: string | null = null, hours = 8): DayText => ({
  deliverable,
  deliverableQuantity: quantity,
  // Written in hours because these fixtures read better that way; stored, and
  // checked, in the minutes the record actually holds.
  workingMinutes: Math.round(hours * 60),
});

/**
 * `duration` is the number AS THE TEXT STATES IT, with its unit — never a
 * conversion. That separation is the point of the two fields.
 */
const act = (
  label: string,
  sessions: number | null = null,
  duration: number | null = null,
  unit: "hours" | "minutes" | null = duration === null ? null : "hours",
): ExtractedActivity => ({ label, sessions, duration_value: duration, duration_unit: unit });

/** True when the result failed, and failed on check 1 specifically. */
const failedProvenance = (r: ReturnType<typeof checkExtraction>) =>
  !r.ok && r.failures.some((f) => f.check === 1);

describe("a number must appear near its own activity", () => {
  test("4. sessions attached to the wrong activity in a multi-activity string fails", () => {
    /* THE test. "Java class 5 classes; doubt solving" states a 5, and the old
       check would hand it to either activity. It belongs to exactly one. */
    const text = day("Java class 5 classes; doubt solving");

    const wrong = checkExtraction([act("doubt solving", 5)], text);
    expect(failedProvenance(wrong), "5 must not attach to doubt solving").toBe(true);

    const right = checkExtraction([act("Java class", 5)], text);
    expect(right.ok, JSON.stringify(right)).toBe(true);
  });

  test("5. sessions attached to its own paired activity passes", () => {
    /* The shape the migration now writes: each activity beside its own count. */
    const text = day("Lecture — 1; Doubt session — 12");

    const right = checkExtraction([act("Doubt session", 12)], text);
    expect(right.ok, JSON.stringify(right)).toBe(true);

    const wrong = checkExtraction([act("Lecture", 12)], text);
    expect(failedProvenance(wrong), "12 must not attach to Lecture").toBe(true);
  });

  test("6. a single-activity day with one number still passes", () => {
    const text = day("Java class", "5 classes");
    /* One activity, one number, and nothing to confuse it with. The tightening
       must not cost the ordinary case. `5 classes` shares no word with `Java
       class` — but "class" and "classes" are different words, so this passes
       through the deliverable's own segment only if the number is there. */
    const withNumberInText = checkExtraction([act("Java class 5 classes", 5)], day("Java class 5 classes"));
    expect(withNumberInText.ok, JSON.stringify(withNumberInText)).toBe(true);

    // And a day that states nothing numeric proves nothing and is fine.
    const noNumbers = checkExtraction([act("Java class")], text);
    expect(noNumbers.ok, JSON.stringify(noNumbers)).toBe(true);
  });

  test("7. an activity whose label matches no segment fails on any stated number", () => {
    const text = day("Lecture — 1; Doubt session — 12");

    const stated = checkExtraction([act("Capstone review", 3)], text);
    expect(failedProvenance(stated)).toBe(true);

    /* A null still states nothing, so it has nothing to prove — check 5 will
       object to the fabricated label, but check 1 must not. */
    const silent = checkExtraction([act("Capstone review")], text);
    expect(silent.ok).toBe(false);
    expect(
      !silent.ok && silent.failures.some((f) => f.check === 1),
      "a null number needs no provenance",
    ).toBe(false);
  });
});

describe("what counts as the same number", () => {
  test("6 matches 6.0, and 6.0 matches 6", () => {
    expect(checkExtraction([act("reports", 6)], day("reviewed reports — 6.0")).ok).toBe(true);
    expect(checkExtraction([act("reports", 6.0)], day("reviewed reports — 6")).ok).toBe(true);
  });

  test("a decimal is not assembled out of the digits around it", () => {
    /* "1 and 5" is not "1.5". The check that permits the model to state numbers
       at all is the check that must not be satisfied by coincidence. */
    const r = checkExtraction([act("lab", null, 1.5)], day("lab 1 session 5 students", null, 8));
    expect(failedProvenance(r)).toBe(true);
  });

  test("and an integer is not read out of the middle of a decimal", () => {
    // The same disease pointing the other way: "1.5 hours" states 1.5, not 1.
    const r = checkExtraction([act("lab", null, 1)], day("lab ran 1.5 hours", null, 8));
    expect(failedProvenance(r)).toBe(true);
  });

  test("written forms one through twelve count", () => {
    expect(checkExtraction([act("classes", 3)], day("took three classes")).ok).toBe(true);
    expect(checkExtraction([act("classes", 12)], day("took twelve classes")).ok).toBe(true);
    // Thirteen is not on the list, and is not silently accepted.
    expect(failedProvenance(checkExtraction([act("classes", 13)], day("took thirteen classes")))).toBe(
      true,
    );
  });

  test("a number cannot vouch for itself through the label", () => {
    /* If digits counted as meaningful words, an activity labelled "5 classes"
       would match the segment holding the 5 BECAUSE of the 5 — the number would
       be its own evidence. The label has to overlap on a real word. */
    const r = checkExtraction([act("5", 5)], day("Java class; doubt solving 5 students"));
    expect(failedProvenance(r)).toBe(true);
  });
});

describe("segmenting the day's text", () => {
  test("splits on the separators the pairing writes, and on prose punctuation", () => {
    expect(segments("Lecture — 1; Doubt session — 12")).toEqual([
      "Lecture — 1",
      "Doubt session — 12",
    ]);
    expect(segments("Live Class, Doubt clearing")).toEqual(["Live Class", "Doubt clearing"]);
    expect(segments("Ran a lab. Then marked papers")).toEqual(["Ran a lab", "Then marked papers"]);
    expect(segments("one\ntwo")).toEqual(["one", "two"]);
  });

  test("a decimal point is not a sentence end", () => {
    /* Splitting "1.5 hours" would hand check 1 a `1` and a `5` the text never
       stated separately — inventing two numbers out of one. */
    expect(segments("lab ran 1.5 hours")).toEqual(["lab ran 1.5 hours"]);
  });
});

describe("the other checks still hold", () => {
  test("2. time attributed beyond the day's total is refused", () => {
    const r = checkExtraction([act("teaching", null, 9)], day("teaching 9 hours", null, 8));
    expect(!r.ok && r.failures.some((f) => f.check === 2)).toBe(true);
  });

  test("3. an extraction that states no duration leaves the whole day unallocated", () => {
    /* Common, and not a failure: the instructor named what they did without
       saying how long each took. On migrated days it is the norm. */
    const r = checkExtraction([act("Lecture"), act("Doubt session")], day("Lecture; Doubt session", null, 6));
    expect(r.ok).toBe(true);
    expect(r.ok && r.unallocatedMinutes).toBe(360);
  });

  test("3. and durations that were stated come off the total", () => {
    const r = checkExtraction(
      [act("Lecture", null, 2), act("Doubt session", null, 1.5)],
      day("Lecture — 2 hours; Doubt session — 1.5 hours", null, 6),
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.ok && r.unallocatedMinutes).toBe(150);
  });

  test("4. an empty extraction is a failure", () => {
    const r = checkExtraction([], day("Lecture"));
    expect(!r.ok && r.failures.some((f) => f.check === 4)).toBe(true);
  });

  test("5. an activity the text never mentions is a failure", () => {
    const r = checkExtraction([act("Capstone review")], day("Lecture; Doubt session"));
    expect(!r.ok && r.failures.some((f) => f.check === 5)).toBe(true);
  });
});
