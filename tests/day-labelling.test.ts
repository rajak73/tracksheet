import { describe, expect, test } from "vitest";
import {
  LABEL_SCHEMA,
  LABEL_SYSTEM,
  labelUserContent,
  parseLabels,
  sharesWord,
} from "@/server/insights/label-day";

/**
 * Call 1 labels a day. It never counts.
 *
 * It is given the DESCRIPTIONS and nothing else — no counts, no durations, not
 * the day's total — because a model that can see a figure will eventually
 * repeat one, and a repeated figure is a second source for a number the form
 * already holds exactly. The sentence is assembled afterwards, in code.
 */

const reply = (activities: unknown[]) => JSON.stringify({ activities });

describe("what the model is sent", () => {
  test("the descriptions, numbered, and not one figure from the rows", () => {
    const text = labelUserContent("2026-09-01", [
      "Live class on binary search",
      "Doubt clearing session",
    ]);
    expect(text).toContain("Date: 2026-09-01");
    expect(text).toContain("1. Live class on binary search");
    expect(text).toContain("2. Doubt clearing session");
    /* The figures the day view holds and the model is never told. Nothing in
       the payload names a quantity, a duration or the recorded total. */
    expect(text).not.toContain("quantity");
    expect(text).not.toContain("minutes");
    expect(text).not.toContain("working");
  });

  test("the rules forbid a number and forbid a count inside a label", () => {
    expect(LABEL_SYSTEM).toContain("Never output a number of any kind");
    expect(LABEL_SYSTEM).toContain("Do not put counts in the label");
  });

  test("9. it offers no list of work areas to choose from", () => {
    /* The standing guard against the taxonomy walking back in through a prompt.
       The instruction may say what a topic IS; it must never list which topics
       exist, because a list in a prompt is a list. */
    const vocabulary = ["Teaching", "Meetings", "Administrative", "Lesson Prep", "Evaluation"];
    for (const word of vocabulary) expect(LABEL_SYSTEM).not.toContain(word);
  });

  test("the schema pins the shape the provider must return", () => {
    expect(LABEL_SCHEMA.required).toContain("activities");
    expect(LABEL_SCHEMA.properties.activities.items.required).toEqual(["label", "unit"]);
  });
});

describe("5. no label contains a digit", () => {
  /* The tripwire. A digit in a label means the model has started counting,
     which is the one thing this whole split exists to prevent. */
  test("a counted label is refused", () => {
    const r = parseLabels(
      reply([{ label: "Reviewed 12 submissions", subtopic: null, topic: null, unit: "submissions" }]),
      ["reviewed 12 submissions"],
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toContain("states a number");
  });

  test("and the same label without the figure is kept", () => {
    const r = parseLabels(
      reply([{ label: "Reviewed submissions", subtopic: null, topic: null, unit: "submissions" }]),
      ["reviewed 12 submissions"],
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.ok && r.labels[0]!.label).toBe("Reviewed submissions");
  });

  test("a digit anywhere in the label is caught, not only a leading one", () => {
    for (const label of ["Taught 2 classes", "Ran doubt session 3", "Marked 25% of papers"]) {
      const r = parseLabels(reply([{ label, subtopic: null, topic: null, unit: "entries" }]), [
        label.toLowerCase(),
      ]);
      expect(r.ok, label).toBe(false);
    }
  });
});

describe("15. a reply of the wrong length is refused", () => {
  test("more labels than rows", () => {
    const r = parseLabels(
      reply([
        { label: "Taught binary search", subtopic: null, topic: null, unit: "classes" },
        { label: "Ran a doubt session", subtopic: null, topic: null, unit: "sessions" },
      ]),
      ["live class on binary search"],
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toContain("2 labels for 1 activities");
  });

  test("fewer labels than rows", () => {
    /* Guessing which row lost its label is how a duration ends up beside the
       wrong activity — the numbers are attached by index afterwards. */
    const r = parseLabels(
      reply([{ label: "Taught binary search", subtopic: null, topic: null, unit: "classes" }]),
      ["live class on binary search", "doubt clearing session"],
    );
    expect(r.ok).toBe(false);
  });
});

describe("a label describes the row it was given", () => {
  test("a label sharing no word with its source is refused", () => {
    const r = parseLabels(
      reply([{ label: "Attended a team meeting", subtopic: null, topic: null, unit: "meetings" }]),
      ["live class on binary search"],
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toContain("shares no word");
  });

  test("3. a compound the writer split still counts as shared", () => {
    /* "take a dead lock class" labels as "Taught deadlock handling", which is
       the specified behaviour and shares no WHOLE word with its source. A rule
       that demanded whole words would refuse the answer that was asked for. */
    expect(sharesWord("Taught deadlock handling", "take a dead lock class")).toBe(true);
  });

  test("a stopword cannot vouch for a label", () => {
    expect(sharesWord("Conducted the session for a team", "on the way to a meeting")).toBe(false);
  });

  test("a figure cannot vouch for a label either", () => {
    // The label and the text share only "12", which proves nothing about it.
    expect(sharesWord("Reviewed 12", "checked 12 quiz papers")).toBe(false);
  });

  test("9. topic may be inferred, and a subtopic may only be quoted", () => {
    const inferred = parseLabels(
      reply([{ label: "Taught deadlock handling", subtopic: "deadlock", topic: "OS", unit: "classes" }]),
      ["take a dead lock class"],
    );
    expect(inferred.ok, JSON.stringify(inferred)).toBe(true);
    // "OS" appears nowhere in the text, and is allowed to.
    expect(inferred.ok && inferred.labels[0]!.topic).toBe("OS");

    const invented = parseLabels(
      reply([{ label: "Ran a doubt session", subtopic: "dynamic programming", topic: "DSA", unit: "sessions" }]),
      ["doubt session"],
    );
    expect(invented.ok).toBe(false);
    expect(!invented.ok && invented.reason).toContain("is not in");
  });

  test("8. an activity naming no subject matter carries no topic", () => {
    const r = parseLabels(
      reply([{ label: "Doubt clearing session", subtopic: null, topic: null, unit: "sessions" }]),
      ["Doubt clearing session"],
    );
    expect(r.ok).toBe(true);
    expect(r.ok && r.labels[0]!.topic).toBeNull();
    expect(r.ok && r.labels[0]!.subtopic).toBeNull();
  });

  test("an empty string is null, not a value", () => {
    /* A model asked for "the specific thing" and given nothing to point at will
       sometimes answer with an empty string, and an empty string is a value
       where null is the fact. */
    const r = parseLabels(
      reply([{ label: "Corrected", subtopic: "", topic: "  ", unit: "" }]),
      ["Corrected"],
    );
    expect(r.ok).toBe(true);
    expect(r.ok && r.labels[0]!.subtopic).toBeNull();
    expect(r.ok && r.labels[0]!.topic).toBeNull();
    expect(r.ok && r.labels[0]!.unit, "the fallback the rules name").toBe("entries");
  });
});

describe("a unit counts things, and never measures time", () => {
  test("a duration noun is not accepted as a unit", () => {
    /* Observed live: "i learned java and oops for 5hr" came back with
       unit "hours", taken from the writer's own "5hr". The number that noun
       would sit beside is the row's QUANTITY, not its duration, so the day
       would have rendered "(1 hours, 5h)" — a length of time stated twice,
       one of them wrong. */
    const r = parseLabels(
      reply([{ label: "Learned Java and OOPs", subtopic: "Java and OOPs", topic: "Java", unit: "hours" }]),
      ["i learned java and oops for 5hr"],
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.ok && r.labels[0]!.unit).toBe("entries");
  });

  test("a countable noun is kept as the writer's own", () => {
    const r = parseLabels(
      reply([{ label: "Reviewed submissions", subtopic: null, topic: null, unit: "submissions" }]),
      ["reviewed submissions"],
    );
    expect(r.ok && r.labels[0]!.unit).toBe("submissions");
  });
});

describe("a malformed reply is refused rather than repaired", () => {
  test("not JSON", () => {
    expect(parseLabels("sorry, I cannot do that", ["x"]).ok).toBe(false);
  });

  test("no activities array", () => {
    expect(parseLabels(JSON.stringify({ labels: [] }), ["x"]).ok).toBe(false);
  });

  test("a label that is not a string", () => {
    expect(parseLabels(reply([{ label: 12, unit: "classes" }]), ["x"]).ok).toBe(false);
  });
});
