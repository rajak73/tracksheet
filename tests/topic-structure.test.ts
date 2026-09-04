import { describe, expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  checkExtraction,
  type DayText,
  type ExtractedActivity,
} from "@/server/insights/extraction-checks";
import { extractionInstruction, parseExtraction } from "@/server/insights/extract";
import { DayInsightCell, type ServedDay, type ServedPeriod } from "@/app/_components/DayInsightCell";
import {
  PROMPT_VERSION_EXTRACT,
  PROMPT_VERSION_WEEK,
  PROMPT_VERSION_MONTH,
  contextHash,
} from "@/server/insights/context";

/**
 * Topic and subtopic — structure without a taxonomy.
 *
 * ── What this fixes ───────────────────────────────────────────────────────
 * The insight column echoed the Deliverable column. "i took dsa class on binary
 * search" produced "i took dsa class on binary search", which is the input
 * handed back. Recognising that `binary search` sits under `DSA` is what makes
 * the column worth a screen.
 *
 * ── Why it is not the taxonomy returning ──────────────────────────────────
 * Three conditions, and these tests hold all three: no stored list of topics
 * anywhere; topic exists only in the derived insight and never in the record or
 * its hash; topic is never selectable. The third is the one that will be argued
 * with — a dropdown decides in advance what somebody may write, and this
 * organises afterwards what they did write. The moment it becomes selectable it
 * stops being the second thing.
 */

const day = (deliverable: string, minutes = 480): DayText => ({
  deliverable,
  deliverableQuantity: null,
  workingMinutes: minutes,
});

const act = (over: Partial<ExtractedActivity> & { label: string }): ExtractedActivity => ({
  subtopic: null,
  topic: null,
  sessions: null,
  duration_value: null,
  duration_unit: null,
  ...over,
});

describe("1 & 4. a subtopic is quoted; a topic is inferred", () => {
  test("the prompt asks for exactly that, and says which may be inferred", () => {
    const text = extractionInstruction(day("anything"));
    expect(text).toContain("subtopic");
    // Wrapped across two lines in the prompt; asserted as the two halves.
    expect(text).toContain("topic may be inferred");
    expect(text).toContain("subtopic may not");
    expect(text).toContain("Prefer null over a guess");
  });

  test('"i took dsa class on binary search" carries binary search under DSA', () => {
    const parsed = parseExtraction(
      JSON.stringify({
        activities: [
          {
            label: "i took dsa class on binary search",
            subtopic: "binary search",
            topic: "DSA",
            sessions: null,
            duration_value: null,
            duration_unit: null,
          },
        ],
      }),
    );
    expect(parsed).not.toBeNull();
    expect(parsed![0]!.subtopic).toBe("binary search");
    expect(parsed![0]!.topic).toBe("DSA");

    const r = checkExtraction(parsed!, day("i took dsa class on binary search"));
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.ok && r.activities[0]!.topic, "DSA is nowhere in the text and is allowed").toBe("DSA");
  });

  test("4. a subtopic that is not in the text fails the extraction", () => {
    /* The bound on the one inference this system allows. A topic may come from
       the model's knowledge; a subtopic is a quotation, and an invented
       quotation is an invented fact. */
    const r = checkExtraction(
      [act({ label: "i took dsa class on binary search", subtopic: "quantum computing", topic: "CS" })],
      day("i took dsa class on binary search"),
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.failures.some((f) => f.check === 5)).toBe(true);
    expect(!r.ok && r.failures.some((f) => f.reason.includes("quantum computing"))).toBe(true);
  });

  test("an inferred topic is never checked against the text", () => {
    // "DSA" appears nowhere in "Live class on binary trees" and must still pass.
    const r = checkExtraction(
      [act({ label: "Live class on binary trees", subtopic: "binary trees", topic: "DSA" })],
      day("Live class on binary trees"),
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });
});

describe("2 & 3. an activity naming no subject matter has no topic", () => {
  test('"Doubt clearing session" extracts with a null topic', () => {
    const r = checkExtraction([act({ label: "Doubt clearing session" })], day("Doubt clearing session"));
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.ok && r.activities[0]!.topic).toBeNull();
  });

  test('"Corrected" has neither topic nor subtopic', () => {
    const r = checkExtraction([act({ label: "Corrected" })], day("Corrected"));
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.activities[0]!.topic).toBeNull();
    expect(r.activities[0]!.subtopic).toBeNull();
  });

  test("an empty-string subtopic is read as null, not as a value", () => {
    const parsed = parseExtraction(
      JSON.stringify({
        activities: [
          { label: "Corrected", subtopic: "", topic: "  ", sessions: null, duration_value: null, duration_unit: null },
        ],
      }),
    );
    expect(parsed![0]!.subtopic).toBeNull();
    expect(parsed![0]!.topic).toBeNull();
  });
});

const cell = (served: ServedDay | ServedPeriod, scope: "DAY" | "WEEK" = "DAY") =>
  renderToStaticMarkup(
    createElement(DayInsightCell, {
      instructorId: "i1",
      scope,
      from: "2026-09-01",
      to: "2026-09-01",
      initial: null,
      autoGenerate: false,
      served,
    }),
  );

describe("5. a day with no topic renders as itself", () => {
  test("one activity, no topic, no invented heading", () => {
    /* THE guard against this change becoming a different failure. Forcing a
       topic onto a day that has none is worse than the echo it replaces — the
       echo is at least honest about having nothing to add. */
    const html = cell({
      points: [
        {
          label: "Investigate intermittent OAuth token expiration errors for enterprise users and admin",
          subtopic: null,
          topic: null,
          sessions: null,
          minutes: 360,
        },
      ],
      unallocated_minutes: 0,
      raw_text: "Investigate intermittent OAuth token expiration errors",
      generated_at: null,
      status: "READY",
      last_error: null,
      failure_kind: null,
    });
    expect(html).toContain("Investigate intermittent OAuth token expiration errors");
    expect(html).toContain("06h 00m");
    // No topic heading element at all.
    expect(html).not.toContain("uppercase");
  });

  test("a day with topics groups under them, and untopiced activities follow", () => {
    const html = cell({
      points: [
        { label: "Live class on binary search", subtopic: "binary search", topic: "DSA", sessions: 2, minutes: 195 },
        { label: "Doubt clearing session", subtopic: null, topic: null, sessions: 1, minutes: 120 },
      ],
      unallocated_minutes: 165,
      raw_text: "…",
      generated_at: null,
      status: "READY",
      last_error: null,
      failure_kind: null,
    });
    /* One DSA activity, so no heading: a heading for one item is overhead, and
       the point renders inline as `DSA — binary search`. */
    expect(html).toContain("DSA — binary search");
    expect(html).not.toContain("Live class on binary search");
    expect(html).toContain("Doubt clearing session");
    // The day total, always, on its own line.
    expect(html).toContain("Total");
    expect(html).toContain("05h 15m");
  });
});

describe("7. topic totals are the sum of their members", () => {
  test("subtopics carry sessions and no duration", () => {
    const period: ServedPeriod = {
      insight: {
        groups: [
          {
            name: "DSA",
            item_count: 3,
            sessions: 5,
            minutes: 750,
            day_count: 3,
            subtopics: [
              { name: "binary search", sessions: 2, item_count: 1 },
              { name: "hashing", sessions: 1, item_count: 1 },
            ],
            entries: [],
          },
          {
            name: "Other",
            item_count: 2,
            sessions: null,
            minutes: null,
            day_count: 2,
            subtopics: [],
            entries: ["Investigate intermittent OAuth token expiry", "Corrected"],
          },
        ],
        unallocated_minutes: 0,
        days_logged: 3,
      },
      generated_at: null,
      status: "READY",
    };
    const html = cell(period, "WEEK");

    expect(html).toContain("DSA");
    expect(html).toContain("binary search");
    expect(html).toContain("12h 30m");
    expect(html).toContain("3 days");
    // Other lists what it holds; a named topic is described by its subtopics.
    expect(html).toContain("Corrected");
    /* No duration beside a subtopic: the minutes are already on the topic line,
       and printing them twice invites somebody to add the second set. */
    const subtopicRow = html.slice(html.indexOf("binary search"), html.indexOf("hashing"));
    expect(subtopicRow).not.toMatch(/\d\dh \d\dm/);
  });
});

describe("9 & 10. no list of topics, and no way to select one", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const full = join(dir, e);
      if (e === "generated" || e === "node_modules") continue;
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx|prisma|sql)$/.test(e)) files.push(full);
    }
  };
  /* The PRODUCT, not the marketing site. `src/app/(public)` has a `TOPICS`
     array of documentation links — "How the platform fits together" — which is
     a set of pages, not a set of things an instructor may have worked on. A
     guard that flags it teaches people to widen the allowlist, which is how a
     guard stops guarding. */
  walk("src/server");
  walk("src/domain");
  walk("src/app/_components");
  walk("src/app/api");
  walk("prisma");

  test("9. no schema model, seed, constant or prompt names a set of topics", () => {
    /* The taxonomy's own vocabulary, which is what a topic list would drift
       back into. A topic is named by the instructor's words each time; the
       moment a fixed set of them exists in the tree, it is the old list again
       under a friendlier word. */
    const vocabulary = ["TOPICS", "TOPIC_LIST", "KNOWN_TOPICS", "TopicType", "model Topic"];
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const v of vocabulary) if (src.includes(v)) offenders.push(`${f}: ${v}`);
    }
    expect(offenders).toEqual([]);
  });

  test("10. topic is not a query parameter, filter or export column", () => {
    /* The standing guard. Someone will want to filter the sheet by topic, and
       that is the door the taxonomy walks back through. */
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const pattern of [/sp\.get\(["']topic["']\)/, /searchParams\.get\(["']topic["']\)/, /["']topic["']\s*:\s*z\./]) {
        if (pattern.test(src)) offenders.push(`${f}: ${pattern}`);
      }
      // And never a column heading in an export.
      if (/"Topic"/.test(src) && /csv|Csv|CSV/.test(src)) offenders.push(`${f}: Topic column`);
    }
    expect(offenders).toEqual([]);
  });

  test("11. topic is absent from the canonical context, so it cannot move the hash", () => {
    const withTopic = JSON.stringify({ log_date: "2026-09-01", deliverable: "x", working_minutes: 60 });
    const a = contextHash(withTopic, PROMPT_VERSION_EXTRACT, "m");
    const b = contextHash(withTopic, PROMPT_VERSION_EXTRACT, "m");
    expect(a).toBe(b);

    const contextSrc = readFileSync("src/server/insights/context.ts", "utf8");
    const canonical = contextSrc.slice(contextSrc.indexOf("type CanonicalDay"), contextSrc.indexOf("export type CanonicalContext"));
    expect(canonical).not.toContain("topic");
  });

  test("12. the prompt versions were bumped, so every cached insight regenerates", () => {
    /* The shape of an extraction changed. The version lives inside the context
       hash, so an old-shaped cached answer stops matching and the next viewer
       gets a new one — no migration, no detection step. */
    expect(PROMPT_VERSION_EXTRACT).toBe("extract_v3");
    expect(PROMPT_VERSION_WEEK).toBe("week_v3");
    expect(PROMPT_VERSION_MONTH).toBe("month_v3");
    expect(contextHash("same", "extract_v1", "m")).not.toBe(contextHash("same", "extract_v2", "m"));
  });
});
