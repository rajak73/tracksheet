import { describe, expect, test } from "vitest";
import {
  countableUnit,
  formatSpan,
  formatTotal,
  groupsReconcile,
  joinList,
  renderActivity,
  renderDaySummary,
  renderGroupPhrase,
  renderMonthSummary,
  renderWeekSummary,
  splitGroupName,
  type SummaryActivity,
  type SummaryGroup,
} from "@/domain/summary-render";

/**
 * The sentence is written in code, and this is where that is proved.
 *
 * Two model calls, both language-only: one labels a day, one groups a period.
 * Every figure below is assembled from the rows the instructor filled in, which
 * is why almost all of it can be tested without a provider, a key or a network.
 *
 * The reason for the split is that a model which writes the prose writes the
 * numbers in it too, and a wrong number inside a cached summary stays wrong
 * until the underlying day changes — which, for a closed month, is never.
 */

const activity = (over: Partial<SummaryActivity>): SummaryActivity => ({
  label: "Taught binary search",
  qty: null,
  unit: "classes",
  minutes: null,
  ...over,
});

const group = (over: Partial<SummaryGroup>): SummaryGroup => ({
  name: "DSA — taught",
  count: null,
  unit: "classes",
  minutes: 60,
  days: 1,
  subtopics: [],
  ...over,
});

describe("13. a duration reads one way in a sentence and another as a total", () => {
  test("a whole hour drops its zero minutes inside a sentence", () => {
    expect(formatSpan(180)).toBe("3h");
    expect(formatSpan(90)).toBe("1h 30m");
    expect(formatSpan(45)).toBe("45m");
  });

  test("the day total keeps both halves", () => {
    /* The figure somebody checks against the timesheet. A total that renders
       `7h` one week and `7h 30m` the next is two shapes of one field. */
    expect(formatTotal(420)).toBe("7h 00m");
    expect(formatTotal(450)).toBe("7h 30m");
    expect(formatTotal(45)).toBe("0h 45m");
  });

  test("neither formatter ever prints a decimal hour", () => {
    for (const minutes of [20, 45, 100, 121, 481]) {
      expect(formatSpan(minutes)).not.toMatch(/\d\.\d/);
      expect(formatTotal(minutes)).not.toMatch(/\d\.\d/);
    }
  });
});

describe("one activity, rendered", () => {
  test("count, unit and duration", () => {
    expect(renderActivity(activity({ qty: 2, minutes: 180 }))).toBe(
      "Taught binary search (2 classes, 3h)",
    );
  });

  test("a figure the row does not carry is dropped, never faked", () => {
    expect(renderActivity(activity({ minutes: 60 }))).toBe("Taught binary search (1h)");
    expect(renderActivity(activity({ qty: 2 }))).toBe("Taught binary search (2 classes)");
    expect(renderActivity(activity({}))).toBe("Taught binary search");
  });

  test("the unit noun is not repeated when the label already says it", () => {
    /* "Reviewed submissions (12 submissions" reads as though the second twelve
       were something else. */
    const reviewed = activity({
      label: "Reviewed submissions",
      unit: "submissions",
      qty: 12,
      minutes: 90,
    });
    expect(renderActivity(reviewed)).toBe("Reviewed submissions (12, 1h 30m)");
  });
});

/**
 * ── The three defects, each with a test so it cannot return ───────────────
 * All three were found by running the thing rather than reading it: two were
 * regressions in this file's assembly, and the third was a real reply from a
 * real model.
 */
describe("a count only prints when its noun means something", () => {
  test("`entries` is a count with no meaningful unit, so no count is printed", () => {
    /* "(1 entry, 2h)" and "(2 entries)" say nothing a reader did not already
       have. `entries` is the fallback the labelling rules name when no noun
       fits — the model has already reported that the number means nothing on
       its own, and printing it adds words and no information. */
    expect(
      renderActivity(activity({ label: "Learned Java and OOPs concepts", unit: "entries", qty: 1, minutes: 120 })),
    ).toBe("Learned Java and OOPs concepts (2h)");
    expect(
      renderActivity(activity({ label: "OAuth token expiration debugging", unit: "entries", qty: 2, minutes: null })),
    ).toBe("OAuth token expiration debugging");
  });

  test("a unit that is a time noun falls back and renders no count", () => {
    /* Observed live: "i learned java and oops for 5hr" came back with
       unit "hours". The number beside it is the row's QUANTITY, not its
       duration, so the day rendered "(1 hours, 5h)" — a length of time stated
       twice, one of them wrong. */
    for (const unit of ["hours", "hrs", "minutes", "mins", "h", "m"]) {
      expect(renderActivity(activity({ unit, qty: 1, minutes: 300 })), unit).toBe(
        "Taught binary search (5h)",
      );
    }
    expect(countableUnit("hours")).toBe("entries");
    expect(countableUnit("classes")).toBe("classes");
  });

  test("a count of 1 with a real unit still renders, singular", () => {
    // One class is a fact; one entry is not.
    expect(renderActivity(activity({ unit: "classes", qty: 1, minutes: 60 }))).toBe(
      "Taught binary search (1 class, 1h)",
    );
    expect(renderActivity(activity({ label: "Ran a review", unit: "sessions", qty: 1, minutes: 60 }))).toBe(
      "Ran a review (1 session, 1h)",
    );
  });

  test("5. one of something the label already names prints no count at all", () => {
    /* "Ran a doubt session (1, 1h)" — the "a" has already said one, and the
       lone digit beside it reads as a figure the reader is meant to check. */
    expect(renderActivity(activity({ label: "Ran a doubt session", unit: "sessions", qty: 1, minutes: 60 }))).toBe(
      "Ran a doubt session (1h)",
    );
    expect(renderActivity(activity({ label: "Ran a doubt session", unit: "sessions", qty: 1, minutes: null }))).toBe(
      "Ran a doubt session",
    );
  });

  test("6. one of something the label does NOT name still prints", () => {
    // There the figure is the only thing saying how many.
    expect(renderActivity(activity({ label: "Taught binary search", unit: "classes", qty: 1, minutes: 120 }))).toBe(
      "Taught binary search (1 class, 2h)",
    );
  });

  test("more than one still prints, even where the label names the noun", () => {
    /* The no-duplicate-noun rule still applies at twelve — it is only the count
       of ONE that the label's own "a" has already stated. */
    expect(
      renderActivity(activity({ label: "Reviewed submissions", unit: "submissions", qty: 12, minutes: 90 })),
    ).toBe("Reviewed submissions (12, 1h 30m)");
  });

  test("a period keeps the count the row dropped, under the group's own name", () => {
    /* The group name gives the number a meaning the individual row could not:
       "125 checked quiz papers", never "125 entries". */
    const g = group({ name: "Checked quiz papers", unit: "entries", count: 125, minutes: 225, days: 5 });
    expect(renderGroupPhrase(g)).toBe("125 checked quiz papers");
  });

  test("a group whose name contains its unit noun renders the noun once", () => {
    /* This printed "22 Mock interviews interviews": the topic WAS the counted
       noun, and only the no-topic branch tested for that. */
    const named = group({ name: "Mock interviews — ran", unit: "interviews", count: 22 });
    expect(renderGroupPhrase(named)).toBe("22 mock interviews");

    const plain = group({ name: "Mock interviews", unit: "interviews", count: 5 });
    expect(renderGroupPhrase(plain)).toBe("5 mock interviews");
  });
});

describe("4. a day renders its activities and its total", () => {
  test("the specified day reads exactly as specified", () => {
    const lines = renderDaySummary(
      [
        activity({ label: "Learned Java and OOPs", unit: "sessions", minutes: 300 }),
        activity({ label: "Taught deadlock handling", unit: "classes", minutes: 180 }),
      ],
      480,
    );
    expect(lines).toBe("Learned Java and OOPs (5h), taught deadlock handling (3h) — 8h 00m");
  });

  test("the first clause keeps its capital and the rest do not", () => {
    const text = renderDaySummary(
      [activity({ minutes: 60 }), activity({ label: "Ran a doubt session", minutes: 60 })],
      120,
    );
    expect(text.startsWith("Taught")).toBe(true);
    expect(text).toContain("ran a doubt session");
  });

  test("a word the writer capitalised throughout is left alone", () => {
    // "DSA revision" must not become "dSA revision".
    const text = renderDaySummary(
      [activity({ minutes: 60 }), activity({ label: "DSA revision", minutes: 60 })],
      120,
    );
    expect(text).toContain("DSA revision");
  });
});

describe("14. a single-activity day renders one clause and a total", () => {
  test("one activity is a valid day", () => {
    expect(renderDaySummary([activity({ qty: 1, minutes: 60 })], 60)).toBe(
      "Taught binary search (1 class, 1h) — 1h 00m",
    );
  });

  test("one of a thing takes the singular noun", () => {
    for (const [unit, one] of [
      ["classes", "1 class"],
      ["sessions", "1 session"],
      ["interviews", "1 interview"],
      ["submissions", "1 submission"],
    ] as const) {
      expect(renderActivity(activity({ qty: 1, unit, label: "Ran a thing" }))).toBe(
        `Ran a thing (${one})`,
      );
    }
  });

  test("a day with nothing in it renders nothing", () => {
    expect(renderDaySummary([], 480)).toBe("");
  });
});

describe("10. a group of one is written as a word, not a figure", () => {
  test("a contest, not 1 contest", () => {
    /* "1 contest with editorial" reads as a figure somebody is meant to check.
       "a contest" reads as English, and says the same thing. */
    const contest = group({ name: "Contest with editorial", unit: "contests", count: 1 });
    expect(renderGroupPhrase(contest)).toBe("a contest");
  });

  test("more than one keeps the figure", () => {
    expect(renderGroupPhrase(group({ count: 9, unit: "classes" }))).toBe("9 DSA classes");
  });

  test("a group nobody counted is named, not numbered", () => {
    expect(renderGroupPhrase(group({ name: "Amazon OA prep", count: null }))).toBe("Amazon OA prep");
  });
});

describe("a group name carries a topic and an action, or an action alone", () => {
  test("the dash splits them", () => {
    expect(splitGroupName("DSA — taught")).toEqual({ topic: "DSA", action: "taught" });
    expect(splitGroupName("Doubt clearing")).toEqual({ topic: null, action: "Doubt clearing" });
  });

  test("the group's own name is used when it already ends in the counted noun", () => {
    const mocks = group({ name: "Mock interviews", unit: "interviews", count: 5 });
    expect(renderGroupPhrase(mocks)).toBe("5 mock interviews");
  });

  test("and the noun stands alone when it does not", () => {
    /* Rather than gluing the two together into "32 submission review
       submissions". Code cannot conjugate English, and a group that reads a
       little plainer is a smaller fault than one that reads as generated. */
    const reviews = group({ name: "Submission review", unit: "submissions", count: 32 });
    expect(renderGroupPhrase(reviews)).toBe("32 submissions");
  });
});

describe("a week reads as two lines", () => {
  const week: SummaryGroup[] = [
    group({
      name: "DSA — taught",
      count: 9,
      unit: "classes",
      minutes: 810,
      days: 5,
      subtopics: ["binary search", "two pointers", "recursion", "DP", "hashing"],
    }),
    group({ name: "Mock interviews", count: 5, unit: "interviews", minutes: 210, days: 3 }),
    group({ name: "Contest with editorial", count: 1, unit: "contests", minutes: 210, days: 1 }),
  ];

  test("the largest group leads, with what it covered", () => {
    const [first] = renderWeekSummary(week, 1_230);
    expect(first).toBe(
      "9 DSA classes covering binary search, two pointers, recursion, DP and hashing — 13h 30m across 5 days.",
    );
  });

  test("everything else follows in one sentence, largest first, with the total", () => {
    const [, second] = renderWeekSummary(week, 1_230);
    expect(second).toBe(
      "Alongside: 5 mock interviews (3h 30m), a contest (3h 30m). 20h 30m total.",
    );
  });

  test("one group is one line — there is no alongside when there was nothing else", () => {
    const lines = renderWeekSummary([week[0]!], 810);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("13h 30m total.");
  });

  test("Other sorts last however large it is", () => {
    const lines = renderWeekSummary(
      [
        group({ name: "Other", minutes: 600, count: 4, unit: "entries" }),
        group({ name: "DSA — taught", minutes: 60, count: 2, unit: "classes" }),
      ],
      660,
    );
    expect(lines[0]!.startsWith("2 DSA classes")).toBe(true);
    // Named, not numbered in a noun that says nothing: "4 other", never "4 entries".
    expect(lines[1]).toContain("4 other");
  });

  test("a leading group that named no subtopics drops the covering clause", () => {
    const lines = renderWeekSummary([group({ count: 3, minutes: 180, days: 2 })], 180);
    expect(lines[0]).toBe("3 DSA classes — 3h across 2 days. 3h 00m total.");
  });
});

describe("a month buckets what it did not lead with", () => {
  const month: SummaryGroup[] = [
    group({
      name: "DSA — taught",
      count: 38,
      unit: "classes",
      minutes: 3_420,
      days: 21,
      subtopics: ["arrays", "binary search", "graphs"],
    }),
    group({ name: "Mock interviews — ran", count: 22, unit: "interviews", minutes: 900, days: 10 }),
    group({ name: "Resume — ran", count: 30, unit: "reviews", minutes: 540, days: 8 }),
    group({ name: "Contests — assessed", count: 4, unit: "contests", minutes: 600, days: 4 }),
  ];

  test("the leading group takes the first line", () => {
    const lines = renderMonthSummary(month, 5_460);
    expect(lines[0]).toBe(
      "38 DSA classes across arrays, binary search and graphs — 57h over 21 days.",
    );
  });

  test("groups sharing an action are bucketed under it, with their own subtotal", () => {
    const lines = renderMonthSummary(month, 5_460);
    /* Named by the one thing the groups genuinely share — the action already in
       each name. A fixed list of bucket names would be a category system, and
       asking the model for them was ruled out in the same breath. */
    expect(lines[1]).toBe("Ran: 22 mock interviews, 30 resume reviews — 24h.");
  });

  test("a lone group falls into the closing sentence, which carries the total", () => {
    const lines = renderMonthSummary(month, 5_460);
    expect(lines[2]).toBe("Also: 4 contests — 10h. 91h 00m total.");
  });

  test("fewer buckets means fewer lines, never a line padded to fill the shape", () => {
    expect(renderMonthSummary([month[0]!], 3_420)).toHaveLength(1);
    expect(renderMonthSummary(month.slice(0, 2), 4_320)).toHaveLength(2);
  });
});

describe("12. the parts add up to the whole, or nothing is stored", () => {
  test("a payload whose groups do not account for the period fails the check", () => {
    const groups = [group({ minutes: 300 }), group({ name: "Other", minutes: 120 })];
    expect(groupsReconcile(groups, 420)).toBe(true);
    expect(groupsReconcile(groups, 480)).toBe(false);
  });
});

describe("a list of subtopics reads as a sentence", () => {
  test("the last is joined with and", () => {
    expect(joinList(["a"])).toBe("a");
    expect(joinList(["a", "b"])).toBe("a and b");
    expect(joinList(["a", "b", "c"])).toBe("a, b and c");
  });
});
