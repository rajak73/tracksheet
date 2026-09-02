import { describe, expect, test, vi } from "vitest";
import { checkExtraction, type DayText, type ExtractedActivity } from "@/server/insights/extraction-checks";
import { runExtraction } from "@/server/insights/extract";

/**
 * An unattributable number is dropped. The day is not.
 *
 * ── What this changed, and why it is not a relaxation ─────────────────────
 * Provenance used to refuse the whole extraction when one number could not be
 * traced. On real legacy data that threw away days that were perfectly
 * readable: `live class on binary tree, doubt class, office meeting` beside a
 * quantity box reading `1, 1, 1, 1, 1` has five good labels and five numbers
 * nobody can attach to them, because the only thing linking a `1` to an
 * activity is its position — the exact evidence the check exists to distrust.
 *
 * The activities were true. Only the numbers were unknown, and `null` already
 * means "the text does not state it". An invented number is still removed; it
 * is removed by nulling rather than by discarding everything around it.
 */

const day = (deliverable: string, quantity: string | null = null, minutes = 480): DayText => ({
  deliverable,
  deliverableQuantity: quantity,
  workingMinutes: minutes,
});

const act = (
  label: string,
  sessions: number | null = null,
  value: number | null = null,
  unit: "hours" | "minutes" | null = value === null ? null : "hours",
): ExtractedActivity => ({ label, sessions, duration_value: value, duration_unit: unit });

/** The legacy two-box shape, which is most of the older real data. */
const TWO_BOX = day(
  "live class on binary tree, doubt class, office meeting, live class on hashing, meeting",
  "1, 1, 1, 1, 1",
  375,
);

describe("1. a day whose numbers cannot be attributed still extracts", () => {
  test("the activities survive and their numbers become null", () => {
    const r = checkExtraction(
      [
        act("live class on binary tree", 1),
        act("doubt class", 1),
        act("office meeting", 1),
      ],
      TWO_BOX,
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;

    expect(r.activities.map((a) => a.label)).toEqual([
      "live class on binary tree",
      "doubt class",
      "office meeting",
    ]);
    // Every count dropped: no segment holding a label also holds a number.
    expect(r.activities.every((a) => a.sessions === null)).toBe(true);
    expect(r.nulled).toHaveLength(3);
    /* "elsewhere", not "absent": every 1 IS written down, in the quantity box.
       That distinction is what keeps the guard below from firing here. */
    expect(r.nulled.every((n) => n.reason === "elsewhere")).toBe(true);
  });

  test("the whole day stays unallocated, which is a fact and not an error", () => {
    const r = checkExtraction([act("live class on binary tree", 1)], TWO_BOX);
    expect(r.ok && r.unallocatedMinutes).toBe(375);
  });
});

describe("2. more than half failing is guessing, not conservatism", () => {
  test("a day where most numbers are unattributable fails whole", () => {
    /* One number real, three invented. A model getting most of them wrong is
       not being careful about a hard format; it is making them up. */
    const r = checkExtraction(
      [
        act("checked quiz papers", 25),
        act("live class", 9),
        act("doubt class", 7),
        act("meeting", 4),
      ],
      day("checked 25 quiz papers, live class, doubt class, meeting"),
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.failures.some((f) => f.check === 1 && f.reason.includes("more than half"))).toBe(
      true,
    );
  });

  test("exactly half is not more than half, and survives", () => {
    const r = checkExtraction(
      [act("checked quiz papers", 25), act("doubt class", 7)],
      day("checked 25 quiz papers, doubt class"),
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.ok && r.nulled).toHaveLength(1);
  });
});

describe("4. an invented number is removed either way", () => {
  test("nulled on the surviving path", () => {
    const r = checkExtraction(
      [act("checked quiz papers", 25), act("department meeting", 99)],
      day("checked 25 quiz papers; department meeting about the exam schedule"),
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    const meeting = r.activities.find((a) => a.label === "department meeting")!;
    expect(meeting.sessions, "99 is nowhere in the text").toBeNull();
    expect(r.nulled.map((n) => n.value)).toContain(99);
  });

  test("and never stored on the failing path", () => {
    const r = checkExtraction([act("capstone review", 3)], day("Lecture; Doubt session"));
    // Check 5 fires: the ACTIVITY is fabricated, which nulling cannot fix.
    expect(r.ok).toBe(false);
    expect(!r.ok && r.failures.some((f) => f.check === 5)).toBe(true);
  });
});

describe("5. a fabricated activity still fails the whole extraction", () => {
  test("because there is no truthful thing to store in its place", () => {
    /* A number nobody wrote can become null, which is true. An activity nobody
       did has no null to become. */
    const r = checkExtraction(
      [act("checked quiz papers", 25), act("Capstone review")],
      day("checked 25 quiz papers"),
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.failures.some((f) => f.check === 5)).toBe(true);
  });

  test("an empty label still fails coverage", () => {
    const r = checkExtraction([act("")], day("anything"));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.failures.some((f) => f.check === 4)).toBe(true);
  });
});

describe("6. one number still cannot fill two fields", () => {
  test("the second field is nulled rather than the day refused", () => {
    const r = checkExtraction(
      [act("Doubt solving session", 1, 1, "hours")],
      day("Doubt solving session - 1 hour"),
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    const a = r.activities[0]!;
    // `sessions` claimed the only `1`; the duration had no occurrence of its own.
    expect(a.sessions).toBe(1);
    expect(a.duration_value).toBeNull();
    expect(a.duration_unit, "a unit measuring nothing is not a unit").toBeNull();
    expect(r.nulled[0]!.reason).toBe("already-used");
  });

  test("two occurrences still support two fields", () => {
    const r = checkExtraction(
      [act("Live class", 1, 1, "hours")],
      day("Live class - 1 class - 1 hour"),
    );
    expect(r.ok).toBe(true);
    expect(r.ok && r.nulled).toEqual([]);
  });
});

describe("3. every nulled number is logged with its label and segment", () => {
  test("so the rate is visible rather than silent", async () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const reply = JSON.stringify({
        activities: [
          { label: "live class on binary tree", sessions: 1, duration_value: null, duration_unit: null },
          { label: "doubt class", sessions: null, duration_value: null, duration_unit: null },
        ],
      });
      const result = await runExtraction(TWO_BOX, async () => ({ ok: true as const, text: reply }));
      expect(result.status).toBe("READY");
      expect(result.status === "READY" && result.nulled).toBe(1);

      const lines = spy.mock.calls.map((c) => String(c[0]));
      const nulledLine = lines.find((l) => l.includes("nulled"));
      expect(nulledLine, "a nulled number must reach the log").toBeDefined();
      expect(nulledLine).toContain("sessions=1");
      expect(nulledLine, "with the label it was claimed for").toContain("live class on binary tree");
      expect(nulledLine, "and where it was looked for").toContain("looked in");
    } finally {
      spy.mockRestore();
    }
  });
});
