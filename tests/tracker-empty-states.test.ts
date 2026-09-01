import { describe, expect, test } from "vitest";
import { cellState, cellText, type CellState } from "@/domain/tracker-cell";
import { workingHours } from "@/domain/worklog-report";

/**
 * 3. A tracker cell's three empty states, which must never become one.
 *
 * ── Written before the rendering, deliberately ────────────────────────────
 * Once all three render as blank it is very hard to notice they were ever
 * different — the grid looks fine, and the only symptom is a manager chasing
 * somebody who already filed.
 *
 *   not yet reached   the future. Blank.
 *   filed nothing     the week passed and they did not. Em dash.
 *   filed zero hours  they answered, recording none. "00h 00m".
 *
 * ── Shown to fail, per the rule ───────────────────────────────────────────
 * The last test plants the collapse this file exists to prevent — a renderer
 * that treats every empty cell alike — and proves the assertions catch it. An
 * absence test that has never failed is a test that reports absence for
 * everything.
 */

const TODAY = "2026-09-02";
const PAST = "2026-08-24";
const FUTURE = "2026-09-28";

describe("the three states are three different answers", () => {
  test("a week entirely ahead is future, whatever is in it", () => {
    expect(cellState({ weekStart: FUTURE, today: TODAY, daysLogged: 0, totalMinutes: 0 })).toBe(
      "future",
    );
  });

  test("a week holding today is in progress, so its empty days are missing", () => {
    /* The distinction that makes the state worth having. Read from a Monday
       that has arrived, an unfiled week is a week nobody filed — not a week
       that has not happened. */
    expect(cellState({ weekStart: TODAY, today: TODAY, daysLogged: 0, totalMinutes: 0 })).toBe(
      "missing",
    );
  });

  test("a passed week nobody filed is missing", () => {
    expect(cellState({ weekStart: PAST, today: TODAY, daysLogged: 0, totalMinutes: 0 })).toBe(
      "missing",
    );
  });

  test("a passed week they filed with no hours is ZERO, not missing", () => {
    /* The one a manager acts on wrongly if it collapses. They answered; the
       answer was none. Chasing them for paperwork they already did is the
       failure. */
    expect(cellState({ weekStart: PAST, today: TODAY, daysLogged: 3, totalMinutes: 0 })).toBe(
      "zero",
    );
  });

  test("and a week with hours is simply recorded", () => {
    expect(cellState({ weekStart: PAST, today: TODAY, daysLogged: 3, totalMinutes: 450 })).toBe(
      "recorded",
    );
  });
});

describe("what each one prints", () => {
  test("future is blank — no dash, nothing to read as a gap", () => {
    expect(cellText("future", workingHours(0))).toBe("");
  });

  test("missing is an em dash: visibly empty", () => {
    expect(cellText("missing", workingHours(0))).toBe("—");
  });

  test("zero prints the figure, because it is a figure", () => {
    expect(cellText("zero", workingHours(0))).toBe("00h 00m");
  });

  test("no two of them print the same thing", () => {
    /* The property, stated directly rather than inferred from the three tests
       above: whatever the formatter does, these must stay distinguishable. */
    const printed = (["future", "missing", "zero"] as CellState[]).map((s) =>
      cellText(s, workingHours(0)),
    );
    expect(new Set(printed).size, `all three printed: ${JSON.stringify(printed)}`).toBe(3);
  });
});

describe("the collapse this file exists to catch", () => {
  test("a renderer that blanks every empty cell fails these assertions", () => {
    /* Planted, so the assertions above are known to be load-bearing. This is
       the bug: one branch for "nothing to show", which is how three facts
       become one blank cell and nobody notices for a release. */
    const collapsed = (state: CellState, formatted: string) =>
      state === "recorded" ? formatted : "";

    const printed = (["future", "missing", "zero"] as CellState[]).map((s) =>
      collapsed(s, workingHours(0)),
    );
    expect(new Set(printed).size, "the collapse must be detectable").toBe(1);

    // And the real renderer must not behave that way.
    expect(cellText("missing", workingHours(0))).not.toBe(
      collapsed("missing", workingHours(0)),
    );
    expect(cellText("zero", workingHours(0))).not.toBe(collapsed("zero", workingHours(0)));
  });
});
