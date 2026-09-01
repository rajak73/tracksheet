import { describe, expect, test } from "vitest";
import { countFor, quantityNotes, readQuantity } from "@/server/insights/quantity";

/**
 * Counting from free text, and refusing to when it cannot be done honestly.
 *
 * ── The three regressions this exists for ─────────────────────────────────
 * All three produce a number that LOOKS right, which is why they need a test
 * rather than a reading:
 *
 *   1. Counting rows instead of reading quantities. Three activities saying
 *      "2 classes", "2 classes" and "3 classes" are seven classes. An
 *      implementation that counts items says three, prints it beside the word
 *      "classes", and is wrong in a way nobody sees without opening the day.
 *
 *   2. Partially summing a group it cannot fully read. "batch A" has no number
 *      in it, so a group containing it has no total — but an implementation that
 *      skips the unreadable member and sums the rest returns a confident-looking
 *      figure that is missing an unknown amount.
 *
 *   3. Falling back to the item count when extraction fails. Same shape as the
 *      first, and it hides exactly where the data is weakest.
 */

describe("reading one quantity", () => {
  test("a leading number is read", () => {
    expect(readQuantity("3 classes")).toEqual({ ok: true, value: 3 });
    expect(readQuantity("2.5 sessions")).toEqual({ ok: true, value: 2.5 });
    expect(readQuantity("  7  ")).toEqual({ ok: true, value: 7 });
  });

  test("absent means once, because the activity still happened", () => {
    expect(readQuantity(null)).toEqual({ ok: true, value: 1 });
    expect(readQuantity("")).toEqual({ ok: true, value: 1 });
    expect(readQuantity("   ")).toEqual({ ok: true, value: 1 });
  });

  test("text without a leading number cannot be read", () => {
    expect(readQuantity("half day").ok).toBe(false);
    expect(readQuantity("as per timetable").ok).toBe(false);
    expect(readQuantity("batch A").ok).toBe(false);
  });

  /* A number somewhere in the middle is not a count of anything. "unit 3" is the
     third unit, not three units, and a pattern loose enough to find it would
     invent counts out of ordinary prose. */
  test("a number that is not at the start is not a count", () => {
    expect(readQuantity("unit 3").ok).toBe(false);
    expect(readQuantity("section B 2 groups").ok).toBe(false);
  });
});

describe("counting a group", () => {
  /* Regression 1. */
  test("quantities are SUMMED, not counted", () => {
    expect(countFor(["2 classes", "2 classes", "3 classes"])).toEqual({
      count: 7,
      countConfident: true,
    });
  });

  test("nulls count as one each", () => {
    expect(countFor([null, null])).toEqual({ count: 2, countConfident: true });
    expect(countFor(["3 classes", null])).toEqual({ count: 4, countConfident: true });
  });

  /* Regressions 2 and 3 together: one unreadable member and the group has no
     count at all — not the sum of the rest, and not the number of members. */
  test("one unreadable member and the whole group has no count", () => {
    expect(countFor(["batch A", null])).toEqual({ count: null, countConfident: false });
    expect(countFor(["3 classes", "as per timetable"])).toEqual({
      count: null,
      countConfident: false,
    });
  });

  test("an empty group counts nothing and is still honest about it", () => {
    expect(countFor([])).toEqual({ count: 0, countConfident: true });
  });
});

describe("quantity notes", () => {
  test("verbatim, in order, without repeats", () => {
    expect(quantityNotes(["2 classes", null, "2 classes", "batch A"])).toEqual([
      "2 classes",
      "batch A",
    ]);
  });

  test("nothing to say when nobody wrote a quantity", () => {
    expect(quantityNotes([null, "", "  "])).toEqual([]);
  });
});
