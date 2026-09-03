import { describe, expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DayInsightCell, type ServedDay, type ServedPeriod } from "@/app/_components/DayInsightCell";
import { formatMinutes } from "@/app/_lib/format";

/**
 * The insight cell, asserted on rendered output.
 *
 * Two of these are permission differences that exist ONLY in the UI — a retry
 * control an instructor sees and a manager does not. There is no server
 * response that differs, so nothing but rendering can check them.
 */

const DATE = "2026-09-01";

function render(props: Parameters<typeof DayInsightCell>[0]): string {
  return renderToStaticMarkup(createElement(DayInsightCell, props));
}

const base = {
  instructorId: "i1",
  scope: "DAY" as const,
  from: DATE,
  to: DATE,
  initial: null,
  // Rendering must not start a fetch; these tests are about what is shown.
  autoGenerate: false,
};

const failed: ServedDay = {
  points: [],
  unallocated_minutes: 480,
  raw_text: "doubt clearing session 11:15 AM to 12:00 PM",
  generated_at: "2026-09-01T10:00:00.000Z",
  status: "FAILED",
  last_error: "check 5: \"capstone review\" shares no meaningful word with the day's text",
  failure_kind: "structure",
};

/** Never got an answer. Reads differently because it means something different. */
const providerFailed: ServedDay = {
  ...failed,
  last_error: "provider: timed out after 8000ms",
  failure_kind: "provider",
};

/** Extracted cleanly. The numbers were in a box nobody can attach to a label. */
const numbersNull: ServedDay = {
  points: [
    { label: "live class on binary tree", subtopic: null, topic: null, sessions: null, minutes: null },
    { label: "doubt class", subtopic: null, topic: null, sessions: null, minutes: null },
    { label: "office meeting", subtopic: null, topic: null, sessions: null, minutes: null },
  ],
  unallocated_minutes: 375,
  raw_text: "live class on binary tree, doubt class, office meeting",
  generated_at: "2026-09-01T10:00:00.000Z",
  status: "READY",
  last_error: null,
  failure_kind: null,
};

const ready: ServedDay = {
  points: [
    { label: "checked 25 quiz papers", subtopic: null, topic: null, sessions: 25, minutes: 45 },
    { label: "department meeting", subtopic: null, topic: null, sessions: null, minutes: null },
  ],
  unallocated_minutes: 315,
  raw_text: "checked 25 quiz papers — 45 minutes; department meeting",
  generated_at: "2026-09-01T10:00:00.000Z",
  status: "READY",
  last_error: null,
};

describe("10. the three states are distinguishable", () => {
  test("numbers-null is not an error: activities, dashes, no badge, no retry", () => {
    /* THE case that matters for what is actually on screen. Most legacy days
       land here, and every one of them looked broken when none of them were. */
    const html = render({ ...base, served: numbersNull, canGenerate: true });

    expect(html).toContain("live class on binary tree");
    expect(html).toContain("doubt class");
    expect(html, "an unstated number is a dash").toContain("—");

    expect(html, "nothing failed, so nothing says so").not.toContain("Couldn’t structure");
    expect(html).not.toContain("Could not be read");
    expect(html, "there is nothing to retry").not.toContain("Try again");
    /* And no "not attributed" footnote either: with no duration anywhere, the
       whole day being unallocated is the ordinary case, not a shortfall. */
    expect(html).not.toContain("not attributed");
  });

  test("structure-failed shows the raw text and says what happened", () => {
    const html = render({ ...base, served: failed, canGenerate: true });
    expect(html).toContain("doubt clearing session 11:15 AM to 12:00 PM");
    expect(html).toContain("Couldn’t structure this entry");
  });

  test("provider-failed is worded as an outage, not as a property of the entry", () => {
    const html = render({ ...base, served: providerFailed, canGenerate: true });
    expect(html).toContain("doubt clearing session 11:15 AM to 12:00 PM");
    expect(html).toContain("Couldn’t reach the reader");
    expect(html).not.toContain("Couldn’t structure this entry");
  });

  test("the three are not each other", () => {
    const a = render({ ...base, served: numbersNull });
    const b = render({ ...base, served: failed });
    const c = render({ ...base, served: providerFailed });
    expect(new Set([a, b, c]).size, "three states, three renderings").toBe(3);
  });
});

describe("9. a FAILED day", () => {
  test("renders its raw text unchanged", () => {
    const html = render({ ...base, served: failed });
    expect(html).toContain("doubt clearing session 11:15 AM to 12:00 PM");
    expect(html).toContain("Couldn’t structure this entry");
  });

  test("shows a retry control to the instructor", () => {
    const html = render({ ...base, served: failed, canGenerate: true });
    expect(html).toContain("Try again");
  });

  test("and not to a manager", () => {
    /* The same response, the same day, a different viewer. This difference is
       expressed nowhere but here, so nothing but rendered output can hold it. */
    const html = render({ ...base, served: failed, canGenerate: false });
    expect(html).toContain("doubt clearing session 11:15 AM to 12:00 PM");
    expect(html, "a manager cannot spend a call on somebody else's day").not.toContain("Try again");
  });
});

describe("a READY day renders the points", () => {
  test("label, count and duration, with the topic kept", () => {
    const html = render({ ...base, served: ready });
    expect(html).toContain("checked 25 quiz papers");
    expect(html).toContain("department meeting");
    expect(html).toContain("25");
    expect(html).toContain(formatMinutes(45));
  });

  test("12. a stated zero and an unstated duration are distinguishable", () => {
    const withZero: ServedDay = {
      ...ready,
      points: [
        { label: "office day", subtopic: null, topic: null, sessions: null, minutes: 0 },
        { label: "reading", subtopic: null, topic: null, sessions: null, minutes: null },
      ],
      unallocated_minutes: 0,
    };
    const html = render({ ...base, served: withZero });
    // A real zero says so; a duration nobody wrote is a dash.
    expect(html).toContain("00h 00m");
    expect(html).toContain("—");
  });
});

describe("11. no surface emits a decimal hour", () => {
  test("every duration on the day cell is hours-and-minutes", () => {
    const html = render({ ...base, served: ready });
    expect(html).not.toMatch(/\d+\.\d+\s*h/);
    expect(html).toMatch(/\d\dh \d\dm/);
  });

  test("and on the week cell", () => {
    const period: ServedPeriod = {
      insight: {
        groups: [
          { name: "Live class", item_count: 3, sessions: 3, minutes: 390, day_count: 3 },
          { name: "Doubt clearing", item_count: 1, sessions: null, minutes: null, day_count: 1 },
        ],
        unallocated_minutes: 90,
        days_logged: 4,
      },
      generated_at: "2026-09-07T10:00:00.000Z",
      status: "READY",
    };
    const html = render({ ...base, scope: "WEEK", served: period });
    expect(html).toContain("Live class");
    expect(html).toContain(formatMinutes(390));
    expect(html).not.toMatch(/\d+\.\d+\s*h/);
    expect(html).not.toMatch(/6\.5/);
    // The unstated duration is a dash, not a zero.
    expect(html).toContain("—");
  });

  test("the days sit behind a disclosure rather than beside the rollup", () => {
    const period: ServedPeriod = {
      insight: {
        groups: [{ name: "Live class", item_count: 3, sessions: 3, minutes: 390, day_count: 3 }],
        unallocated_minutes: 0,
        days_logged: 3,
      },
      generated_at: null,
      status: "READY",
    };
    const html = render({ ...base, scope: "WEEK", served: period });
    expect(html).toContain("aria-expanded=\"false\"");
    expect(html).toContain("Show the 3 days");
  });

  test("a week group name never carries a topic", () => {
    const period: ServedPeriod = {
      insight: {
        groups: [{ name: "Live class", item_count: 2, sessions: 2, minutes: 120, day_count: 2 }],
        unallocated_minutes: 0,
        days_logged: 2,
      },
      generated_at: null,
      status: "READY",
    };
    const html = render({ ...base, scope: "WEEK", served: period });
    expect(html).not.toContain("binary tree");
    expect(html).not.toContain("hashing");
  });
});
