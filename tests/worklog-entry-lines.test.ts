import { describe, expect, test } from "vitest";
import { parseHours, splitEntries, MAX_ENTRIES } from "@/domain/worklog-entry-lines";

/**
 * Four boxes into several entries, and the ways that goes silently wrong.
 *
 * ── What these are really guarding ────────────────────────────────────────
 * Not "does it split". Whether a value can land against the WRONG deliverable
 * without anything looking wrong. That is the only outcome here that survives
 * review: a refusal costs an instructor a minute, and a quantity shifted one
 * place is reconciled by hand at month end, if ever.
 *
 * Several cases below were found by probing the rule adversarially rather than
 * by writing it, and each is named where it came from.
 */

const split = (
  deliverable: string,
  workingHours: string,
  quantity = "",
  remarks = "",
) => splitEntries({ deliverable, quantity, workingHours, remarks });

describe("one entry still behaves exactly as it did", () => {
  test("the ordinary case", () => {
    const r = split("Live class on binary trees", "2h", "1", "section A");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries).toEqual([
      {
        deliverable: "Live class on binary trees",
        quantity: 1,
        workingHours: 2,
        remarks: "section A",
        // The boxes as typed, carried beside the parsed values. The table
        // prints these; the numbers above are what totals are summed from.
        rawQuantity: "1",
        rawWorkingHours: "2h",
      },
    ]);
  });

  test("a deliverable containing commas is NOT cut up", () => {
    /* The commonest single-entry shape on this form. Counting entries by
     * splitting the deliverable would refuse this as three entries and teach
     * instructors to delete words from their own sentences. */
    const r = split("Doubt session for section A, second years, mostly on recursion", "45m");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]!.deliverable).toContain("second years");
  });

  test("an empty quantity means nobody said, not zero", () => {
    const r = split("Checked assignments", "1h");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries[0]!.quantity, "the client's `?`, resolved by unit at write time").toBeNull();
  });
});

describe("several entries, by line or by comma", () => {
  test("newlines", () => {
    const r = split(
      "Live class\nDoubt session\nChecked assignments",
      "2h\n45m\n1h",
      "1\n1\n12",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries.map((e) => [e.deliverable, e.workingHours, e.quantity])).toEqual([
      ["Live class", 2, 1],
      ["Doubt session", 0.75, 1],
      ["Checked assignments", 1, 12],
    ]);
  });

  test("commas, when every duration says what it is", () => {
    const r = split("Live class, Doubt session, Checked assignments", "2h, 45m, 1h", "1, 1, 12");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries).toHaveLength(3);
    expect(r.entries[2]!.quantity).toBe(12);
  });

  test("a trailing comma does not shift everything after it", () => {
    const r = split("Live class, Doubt session,", "2h, 45m", "1, 1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries).toHaveLength(2);
    expect(r.entries[1]!.deliverable).toBe("Doubt session");
  });

  test("one remark covers every entry", () => {
    const r = split("Live class\nDoubt session", "2h\n45m", "", "binary trees, AVL rotations");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Not split on its commas — it is one sentence about the day.
    expect(r.entries.map((e) => e.remarks)).toEqual([
      "binary trees, AVL rotations",
      "binary trees, AVL rotations",
    ]);
  });
});

describe("the ways a value lands on the wrong line — all refused", () => {
  /* Every case here was found by probing the rule rather than writing it, and
   * every one of them is accepted-and-wrong under a naive comma split. */

  test('"1,5" is not one and a half hours becoming two entries', () => {
    const r = split("Live class", "1,5");
    expect(r.ok, "a bare 5 after a comma has no unit").toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/ambiguous/i);
  });

  test('"1,200" in the quantity box cannot become two entries', () => {
    // Refused by the hours count, since hours says one entry and quantity two.
    const r = split("Checked assignments", "2h", "1,200");
    expect(r.ok).toBe(false);
  });

  test('"1h, 30m" meaning ninety minutes is at least visible', () => {
    /* Both parts carry units, so this IS read as two entries — which may not be
     * what they meant. It cannot be refused without also refusing the genuine
     * "2h, 45m", so the form's preview is what catches it. Asserted so the
     * behaviour is a decision on record rather than an accident. */
    const r = split("Live class, Doubt session", "1h, 30m");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries).toHaveLength(2);
  });

  test("a bare number above twelve is refused, not read as hours", () => {
    // "45" in a box labelled Working Hours is forty-five minutes to everybody
    // except the parser, which read forty-five hours.
    const r = split("Doubt session", "45");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/45m/);
  });

  test("but a plausible bare number is still hours", () => {
    const r = split("Live class", "8");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries[0]!.workingHours).toBe(8);
  });
});

describe("mismatched counts are refused, naming both", () => {
  test("more deliverables than durations", () => {
    const r = split("Live class\nDoubt session\nMarking", "2h\n45m");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/3 deliverables but 2 working-hour values/);
  });

  test("more quantities than entries", () => {
    const r = split("Live class\nDoubt session", "2h\n45m", "1\n1\n12");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/3 quantities but 2 entries/);
  });

  test("remarks that are neither one nor N", () => {
    const r = split("A\nB\nC", "1h\n1h\n1h", "", "x\ny");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/2 remarks but 3 entries/);
  });

  test("nothing at all in the hours box", () => {
    const r = split("Live class", "");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/how long/i);
  });

  test("beyond the ceiling", () => {
    const many = Array.from({ length: MAX_ENTRIES + 1 }, () => "1h").join("\n");
    const r = split(Array.from({ length: MAX_ENTRIES + 1 }, () => "x").join("\n"), many);
    expect(r.ok).toBe(false);
  });
});

describe("a quantity nobody stated, in a list", () => {
  test("? and - mean unstated, positionally", () => {
    const r = split("Live class\nMarking\nDoubt session", "2h\n1h\n45m", "1\n?\n1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries.map((e) => e.quantity)).toEqual([1, null, 1]);
  });

  /**
   * ── This used to be a refusal, and is deliberately no longer one ────────
   * The box is labelled Deliverable Quantity and people answer it in words:
   * "2 classes", "1 doubt session", "twelve". Refusing those taught nothing
   * except to leave the box empty, which loses the words as well as the count.
   *
   * The rule now: the first whole number is the count, and everything else is
   * context. Text carrying no digit at all is the client's `?` — an honest
   * "they did not give a number" — rather than an error.
   *
   * Being lenient costs nothing, and that is the whole reason it is safe:
   * `rawQuantity` stores the box verbatim and the table prints it, so a reader
   * always sees exactly what was written. The parse is only ever used for
   * arithmetic, and refusing to guess is the correct arithmetic here.
   */
  test("a quantity written in words is kept, and counts as unstated", () => {
    const r = split("Marking", "1h", "twelve");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // No digit, so no count is asserted — but the word survives verbatim.
    expect(r.entries[0]!.quantity).toBeNull();
    expect(r.entries[0]!.rawQuantity).toBe("twelve");
  });

  test("a count with context keeps both halves", () => {
    const r = split("Live class", "6h", "2 classes taken");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries[0]!.quantity).toBe(2);
    expect(r.entries[0]!.rawQuantity).toBe("2 classes taken");
  });

  test("hours may be written as a sentence, and are still measured exactly", () => {
    const r = split("Live class", "6 hours 30 minutes", "1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries[0]!.workingHours).toBe(6.5);
    expect(r.entries[0]!.rawWorkingHours).toBe("6 hours 30 minutes");
  });

  /* The loosened parsing must not loosen the guards it sits behind. A bare
     number over twelve is still refused, and text with no unit at all is still
     not a duration — otherwise "2 classes" in the hours box would quietly
     become two hours. */
  test("context does not make anything a duration", () => {
    expect(split("Marking", "45", "1").ok).toBe(false);
    expect(split("Marking", "2 classes", "1").ok).toBe(false);
  });
});

describe("hours as people write them", () => {
  test("every accepted form", () => {
    for (const [text, hours] of [
      ["8", 8],
      ["8.5", 8.5],
      ["8h", 8],
      ["8h 30m", 8.5],
      ["8:30", 8.5],
      ["8h30", 8.5],
      ["45m", 0.75],
      ["45 mins", 0.75],
      ["90 minutes", 1.5],
      ["2 hrs", 2],
    ] as Array<[string, number]>) {
      expect(parseHours(text), text).toBeCloseTo(hours, 5);
    }
  });

  test("and what it will not guess at", () => {
    for (const text of ["", "soon", "8h 75m", "half an hour", "45"]) {
      expect(parseHours(text), text).toBeNull();
    }
  });
});
