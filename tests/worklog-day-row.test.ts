import { describe, expect, test } from "vitest";
import { buildDayRow, remarksFor, type DayEntry } from "@/domain/worklog-day-rows";

/**
 * The row the instructor's table is built from.
 *
 * ── Why this is a unit test and the rest of the page is not ───────────────
 * Everything the table decides — which days a row covers, whether an empty row
 * is a day nobody filed or a day that has not happened, what the Remarks cell
 * says, whether the provenance note appears — is decided here, in a pure
 * function. The columns then print what it returns. Testing it through the
 * rendered page would test React as well and say less about either.
 */

const day = (logDate: string, over: Partial<DayEntry> = {}): DayEntry => ({
  id: `id-${logDate}`,
  logDate,
  deliverable: "Live Class on binary search",
  deliverableQuantity: "2 classes",
  workingHours: 6.5,
  remarks: null,
  source: "NATIVE",
  ...over,
});

const MON = "2026-08-03";
const TUE = "2026-08-04";
const WED = "2026-08-05";
const WEEK = [MON, TUE, WED, "2026-08-06", "2026-08-07", "2026-08-08", "2026-08-09"];
const AFTER = "2026-08-20";

const row = (dates: string[], days: DayEntry[], today = AFTER, dayNotes = {}) =>
  buildDayRow({ key: "k", label: "l", dates, days, today, dayNotes });

describe("a day is the row", () => {
  test("8. a day that was saved appears in the row that covers it", () => {
    const r = row([TUE], [day(MON), day(TUE), day(WED)]);
    expect(r.state).toBe("recorded");
    expect(r.days.map((d) => d.logDate)).toEqual([TUE]);
  });

  test("9. the quantity is carried through character for character", () => {
    /* The row must not tidy, parse or normalise it on the way to the column.
       "gfddgh" is what somebody wrote and is the record. */
    for (const typed of ["2 classes + 1 doubt", "half day", "gfddgh", "1, 1, 40, 1"]) {
      const r = row([MON], [day(MON, { deliverableQuantity: typed })]);
      expect(r.days[0]!.deliverableQuantity).toBe(typed);
    }
    // And an empty box stays one value, not two.
    expect(row([MON], [day(MON, { deliverableQuantity: null })]).days[0]!.deliverableQuantity)
      .toBeNull();
  });

  test("10. hours are summed as numbers, once, in minutes", () => {
    /* 6.5 is 390 minutes, which the column formats as "6h 30m". Summing the
       formatted strings back would reintroduce the rounding this avoids. */
    expect(row([MON], [day(MON, { workingHours: 6.5 })]).totalMinutes).toBe(390);
    expect(
      row(WEEK, [day(MON, { workingHours: 6.5 }), day(TUE, { workingHours: 1.25 })]).totalMinutes,
    ).toBe(465);
  });

  test("10. a day with no hours contributes nothing, and is not a zero duration", () => {
    /* The column renders 0 as a dash rather than "0h 00m": the stored column is
       not nullable, so zero is the only way "nobody said" can arrive, and
       printing it as a duration states a measurement nobody took. */
    const r = row([MON], [day(MON, { workingHours: 0 })]);
    expect(r.totalMinutes).toBe(0);
    expect(r.days[0]!.workingHours).toBe(0);
  });
});

describe("15. empty is two different facts and they never collapse", () => {
  test("a passed day nobody filed is missing", () => {
    expect(row([MON], []).state).toBe("missing");
  });

  test("a day that has not happened is future", () => {
    expect(row(["2030-01-01"], [], AFTER).state).toBe("future");
  });

  test("a week holding today is in progress, so its passed days can still be missing", () => {
    /* The distinction that makes the whole thing worth having: a week is only
       "not yet reached" when ALL of it is ahead. Read from the Monday itself,
       the week is in progress and an empty Monday is a day nobody filed. */
    expect(row(WEEK, [], MON).state).toBe("missing");
    expect(row(WEEK, [], "2026-07-01").state).toBe("future");
  });
});

describe("13. the provenance note follows the words", () => {
  test("a MIGRATED day carries it", () => {
    expect(row([MON], [day(MON, { source: "MIGRATED" })]).hasMigrated).toBe(true);
  });

  test("a NATIVE day does not", () => {
    expect(row([MON], [day(MON)]).hasMigrated).toBe(false);
  });

  test("a week carries it if any of its days do — one note, not seven", () => {
    /* Per row rather than per day: it drives one quiet line under the cell, and
       a week showing it seven times would be noise. */
    const r = row(WEEK, [day(MON), day(TUE, { source: "MIGRATED" })]);
    expect(r.hasMigrated).toBe(true);
  });
});

describe("the Remarks column", () => {
  test("a day note outranks the day's own remark", () => {
    const days = [day(MON, { remarks: "what I wrote on the row" })];
    expect(remarksFor([MON], days, { [MON]: "what I wrote about the day" })).toBe(
      "what I wrote about the day",
    );
  });

  test("a week joins its days in date order and skips the empty ones", () => {
    const days = [day(MON, { remarks: "binary trees" }), day(WED, { remarks: "section B" })];
    expect(remarksFor(WEEK, days, {})).toBe("binary trees; section B");
  });

  test("a row with nothing to say says nothing, rather than a run of separators", () => {
    expect(remarksFor(WEEK, [day(MON), day(TUE)], {})).toBe("");
  });
});

describe("a week is its days, kept", () => {
  test("in date order, however they arrive", () => {
    const r = row(WEEK, [day(WED), day(MON), day(TUE)]);
    expect(r.days.map((d) => d.logDate)).toEqual([MON, TUE, WED]);
  });

  test("and days outside the row are not in it", () => {
    const r = row([MON], [day(MON), day(TUE)]);
    expect(r.days).toHaveLength(1);
  });

  test("nothing is merged, so two days never become one line", () => {
    /* The old builder folded activities together by deliverable name and summed
       their counts. Two days that say the same thing are still two days, and
       collapsing them would drop one of the numbers beside them. */
    const r = row(WEEK, [
      day(MON, { deliverable: "Live Class", deliverableQuantity: "2 classes" }),
      day(TUE, { deliverable: "Live Class", deliverableQuantity: "3 classes" }),
    ]);
    expect(r.days).toHaveLength(2);
    expect(r.days.map((d) => d.deliverableQuantity)).toEqual(["2 classes", "3 classes"]);
  });
});
