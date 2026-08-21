import { beforeAll, describe, expect, test } from "vitest";
import {
  MAX_NARRATIVE_CHARS,
  buildNarrativeInstruction,
  extractClockTimes,
  validateActivities,
} from "@/server/worklog/narrative";
import { loadTaxonomy, type Taxonomy } from "@/server/worklog/taxonomy";
import { ApiClient, ACCOUNTS } from "./helpers/client";

/**
 * Finding every activity in a paragraph, and being able to prove it.
 *
 * ── Why these tests hand the validator a reply instead of calling the model ──
 * What a model returns today is not what it returns tomorrow, and a suite that
 * asserts on its wording tests the provider rather than this code. What must
 * hold whatever comes back is the deterministic half: which replies are
 * accepted, which are refused, and what the figures are once they are.
 *
 * So the model's answers are written out here — including the ones it gets
 * wrong — and the checks run against them. The live model is exercised
 * separately by `npm run worklog:sample`, for the same reason the AI narration
 * has a script rather than a test: one that silently passes with no key is
 * worse than none.
 */

let taxonomy: Taxonomy;
beforeAll(async () => {
  // The real taxonomy, from the database the write will be checked against —
  // so a code accepted here is a code that can actually be stored.
  taxonomy = await loadTaxonomy();
});

/** The client's own example, verbatim from the specification. */
const NARRATIVE =
  "9 AM to 11 AM took DSA lecture on binary trees for Section A. " +
  "From 11:15 AM to 12 PM conducted a doubt clearing session. " +
  "From 1 PM to 2 PM checked 12 assignments. " +
  "From 3:15 PM to 4 PM prepared slides for next week's class. " +
  "4:30 PM to 5:15 PM attended a faculty coordination meeting.";

const READ = [
  { text: "9 AM to 11 AM took DSA lecture on binary trees for Section A", categoryCode: "TEACHING", deliverableCode: "LECTURE", startLocal: "09:00", endLocal: "11:00", quantity: null, subjectCode: "TECH", remark: "binary trees, Section A" },
  { text: "From 11:15 AM to 12 PM conducted a doubt clearing session", categoryCode: "STUDENT_SUPPORT", deliverableCode: null, startLocal: "11:15", endLocal: "12:00", quantity: null, subjectCode: null, remark: null },
  { text: "From 1 PM to 2 PM checked 12 assignments", categoryCode: "ASSESSMENT", deliverableCode: null, startLocal: "13:00", endLocal: "14:00", quantity: 12, subjectCode: null, remark: null },
  { text: "From 3:15 PM to 4 PM prepared slides for next week's class", categoryCode: "CONTENT_DEVELOPMENT", deliverableCode: null, startLocal: "15:15", endLocal: "16:00", quantity: null, subjectCode: null, remark: null },
  { text: "4:30 PM to 5:15 PM attended a faculty coordination meeting", categoryCode: "MEETING", deliverableCode: null, startLocal: "16:30", endLocal: "17:15", quantity: null, subjectCode: null, remark: null },
];

const minutesOf = (r: ReturnType<typeof validateActivities>) =>
  r.bullets.reduce((n, b) => n + (b.durationMinutes ?? 0), 0);

describe("one paragraph, five activities", () => {
  test("every activity in the client's example is found, with its own hours", () => {
    const result = validateActivities(NARRATIVE, READ, taxonomy);

    expect(result.bullets).toHaveLength(5);
    expect(result.dropped).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    // 120 + 45 + 60 + 45 + 45. The specification's own figure: 05h 15m.
    expect(minutesOf(result)).toBe(315);
  });

  test("the durations are computed from the clock, never taken from the reply", () => {
    // The model is not asked for a duration at all, so the only way a wrong one
    // could appear is if these two disagreed. They cannot.
    const result = validateActivities(NARRATIVE, READ, taxonomy);
    expect(result.bullets.map((b) => b.durationMinutes)).toEqual([120, 45, 60, 45, 45]);
  });

  test("a quantity written in the line is kept", () => {
    const result = validateActivities(NARRATIVE, READ, taxonomy);
    expect(result.bullets[2]!.quantity).toBe(12);
  });

  test("a quantity nobody wrote is not invented", () => {
    // The reply claims 30 assignments for a line that names no number.
    const result = validateActivities(
      "checked assignments 1 PM to 2 PM",
      [{ ...READ[2]!, text: "checked assignments 1 PM to 2 PM", quantity: 30 }],
      taxonomy,
    );
    expect(result.bullets[0]!.quantity, "falls back to one, never to the claim").toBe(1);
  });

  test("a quantity from a DIFFERENT activity cannot be borrowed", () => {
    // 12 is in the paragraph — but not in this activity's own words.
    const result = validateActivities(
      NARRATIVE,
      [{ ...READ[0]!, quantity: 12 }],
      taxonomy,
    );
    expect(result.bullets[0]!.quantity).toBe(1);
  });
});

describe("nothing is dropped", () => {
  test("a time the reply never accounts for raises a warning", () => {
    // The faculty meeting is gone. Its clock times are still in the paragraph,
    // which is how the omission is detectable at all.
    const result = validateActivities(NARRATIVE, READ.slice(0, 4), taxonomy);
    expect(result.warnings.map((w) => w.kind)).toContain("unaccounted_time");
  });

  test("a complete reading raises nothing", () => {
    expect(validateActivities(NARRATIVE, READ, taxonomy).warnings).toHaveLength(0);
  });

  test("a warning never costs the instructor the activities that were read", () => {
    const result = validateActivities(NARRATIVE, READ.slice(0, 4), taxonomy);
    expect(result.bullets, "the four that were found are still recorded").toHaveLength(4);
    expect(minutesOf(result)).toBe(270);
  });
});

describe("nothing is invented", () => {
  test("words the instructor never wrote are refused, not repaired", () => {
    const result = validateActivities(
      NARRATIVE,
      [{ ...READ[0]!, text: "conducted a laboratory practical on thermodynamics" }],
      taxonomy,
    );
    expect(result.bullets).toHaveLength(0);
    expect(result.dropped[0]!.reason).toMatch(/not in what you wrote/i);
  });

  test("the same words cannot be claimed by two activities", () => {
    // Both would be written, and the day would hold those minutes twice.
    const result = validateActivities(
      NARRATIVE,
      [READ[0]!, { ...READ[0]!, categoryCode: "MENTORING" }, READ[1]!],
      taxonomy,
    );
    expect(result.bullets).toHaveLength(2);
    expect(result.dropped[0]!.reason).toMatch(/read twice/i);
    expect(minutesOf(result), "120 once, not 240").toBe(165);
  });

  test("markup anywhere in a span is refused", () => {
    const result = validateActivities(
      NARRATIVE,
      [{ ...READ[0]!, text: "<img src=x onerror=alert(1)>" }],
      taxonomy,
    );
    expect(result.bullets).toHaveLength(0);
  });

  test("a category outside the taxonomy becomes OTHER, never itself", () => {
    const result = validateActivities(
      NARRATIVE,
      [{ ...READ[0]!, categoryCode: "SOMETHING_INVENTED" }],
      taxonomy,
    );
    expect(result.bullets[0]!.categoryCode).toBe("OTHER");
  });

  test("a deliverable belonging to another category is dropped, not reparented", () => {
    const meeting = taxonomy.categoryByCode.get("MEETING")!.deliverables[0]!;
    const result = validateActivities(
      NARRATIVE,
      [{ ...READ[0]!, categoryCode: "TEACHING", deliverableCode: meeting.code }],
      taxonomy,
    );
    expect(result.bullets[0]!.deliverableCode, "null, so the category decides").toBeNull();
  });
});

describe("time that was never written is never invented", () => {
  test("an activity with no clock range records no hours", () => {
    const text = "Worked on preparing tomorrow's lecture material and reviewed student projects.";
    const result = validateActivities(
      text,
      [
        { text: "preparing tomorrow's lecture material", categoryCode: "CONTENT_DEVELOPMENT", deliverableCode: null, startLocal: null, endLocal: null, quantity: null, subjectCode: null, remark: null },
        { text: "reviewed student projects", categoryCode: "MENTORING", deliverableCode: null, startLocal: null, endLocal: null, quantity: null, subjectCode: null, remark: null },
      ],
      taxonomy,
    );

    expect(result.bullets).toHaveLength(2);
    expect(minutesOf(result), "no hours, rather than plausible ones").toBe(0);
    expect(result.bullets.every((b) => b.problem !== null)).toBe(true);
    expect(result.warnings.map((w) => w.kind)).toContain("no_duration");
  });

  test("an end before its start is refused rather than flipped", () => {
    const result = validateActivities(
      NARRATIVE,
      [{ ...READ[0]!, startLocal: "11:00", endLocal: "09:00" }],
      taxonomy,
    );
    expect(result.bullets[0]!.durationMinutes).toBeNull();
    expect(result.bullets[0]!.problem).toMatch(/not after the start/i);
  });
});

describe("overlapping time is flagged, never counted twice", () => {
  const text = "Lecture 9:00 AM to 11:00 AM, assignment review 10:30 AM to 11:30 AM.";
  const read = [
    { text: "Lecture 9:00 AM to 11:00 AM", categoryCode: "TEACHING", deliverableCode: null, startLocal: "09:00", endLocal: "11:00", quantity: null, subjectCode: null, remark: null },
    { text: "assignment review 10:30 AM to 11:30 AM", categoryCode: "ASSESSMENT", deliverableCode: null, startLocal: "10:30", endLocal: "11:30", quantity: null, subjectCode: null, remark: null },
  ];

  test("the day holds two hours, not three", () => {
    const result = validateActivities(text, read, taxonomy);
    expect(minutesOf(result)).toBe(120);
  });

  test("the instructor is told which two disagree", () => {
    const result = validateActivities(text, read, taxonomy);
    const overlap = result.warnings.find((w) => w.kind === "overlap");
    expect(overlap?.message).toMatch(/overlap/i);
    expect(result.bullets[1]!.problem).toMatch(/09:00–11:00/);
  });

  test("the overlapping words are still kept", () => {
    // Refused for its hours, not erased. The instructor can see what they wrote.
    const result = validateActivities(text, read, taxonomy);
    expect(result.bullets[1]!.rawText).toContain("assignment review");
  });

  test("an overlap does not also masquerade as a missing activity", () => {
    // Clearing the refused activity's times must not make them look unaccounted
    // for — one problem, one warning.
    const kinds = validateActivities(text, read, taxonomy).warnings.map((w) => w.kind);
    expect(kinds).toEqual(["overlap"]);
  });
});

describe("a malformed reply is refused, never repaired", () => {
  test("the shapes a model gets wrong", () => {
    for (const bad of [
      {},
      { text: "" },
      { text: "   " },
      { text: 42 },
      { text: null },
    ]) {
      const result = validateActivities(NARRATIVE, [bad as never], taxonomy);
      expect(result.bullets, JSON.stringify(bad)).toHaveLength(0);
    }
  });

  test("a reply of nothing at all yields nothing at all", () => {
    const result = validateActivities(NARRATIVE, [], taxonomy);
    expect(result.bullets).toHaveLength(0);
    // No day is invented to fill the gap.
    expect(minutesOf(result)).toBe(0);
  });
});

describe("reading the clock out of a sentence", () => {
  test("the forms instructors actually write", () => {
    expect(extractClockTimes("9 AM to 11 AM")).toEqual([
      { hour12: 9, minute: 0 },
      { hour12: 11, minute: 0 },
    ]);
    expect(extractClockTimes("11:15 AM to 12 PM")).toEqual([
      { hour12: 11, minute: 15 },
      { hour12: 0, minute: 0 },
    ]);
    expect(extractClockTimes("took os class 9-11")).toEqual([
      { hour12: 9, minute: 0 },
      { hour12: 11, minute: 0 },
    ]);
  });

  test("a count is not a time", () => {
    // "checked 12 assignments" must not raise a warning about a missing midday
    // activity — the whole coverage check depends on this being conservative.
    expect(extractClockTimes("checked 12 assignments")).toEqual([]);
    expect(extractClockTimes("reviewed 10 project submissions")).toEqual([]);
  });

  test("an afternoon range and a morning one are the same written hour", () => {
    // Deliberate: resolving 2-3 to the afternoon needs context a regex has not
    // got, and guessing wrong would warn about a day that was read perfectly.
    expect(extractClockTimes("meeting 2-3")).toEqual([
      { hour12: 2, minute: 0 },
      { hour12: 3, minute: 0 },
    ]);
  });
});

describe("what is sent to the provider", () => {
  test("the instruction carries the day and the closed list, and nothing else", () => {
    const instruction = buildNarrativeInstruction(NARRATIVE, taxonomy);
    expect(instruction).toContain(NARRATIVE);
    expect(instruction).toContain("TEACHING");
    // No identity travels with a paragraph about somebody's work.
    for (const field of ["employeeCode", "instructorId", "universityId", "@"]) {
      expect(instruction, `${field} must not be sent`).not.toContain(field);
    }
  });

  test("the completeness rule is stated, not implied", () => {
    expect(buildNarrativeInstruction(NARRATIVE, taxonomy)).toMatch(/COMPLETENESS/);
  });
});

/* ── The endpoint ──────────────────────────────────────────────────────────
 * Parsing runs in the background and needs a provider, so these assert what
 * holds WHATEVER the provider does: the text is saved before anything reads it,
 * and it is the instructor's own. */

let instructor: ApiClient, colleague: ApiClient, admin: ApiClient;
let myId = "", theirId = "";

beforeAll(async () => {
  instructor = new ApiClient("me");
  myId = (await instructor.login(ACCOUNTS.instructorNorth1)).user.instructorId!;
  colleague = new ApiClient("colleague");
  theirId = (await colleague.login(ACCOUNTS.instructorNorth2)).user.instructorId!;
  admin = new ApiClient("admin");
  await admin.login(ACCOUNTS.admin);
});

const today = () => new Date().toISOString().slice(0, 10);

describe("the text is safe before anything reads it", () => {
  test("a paragraph is accepted and stored word for word", async () => {
    const date = today();
    const post = await instructor.post(`/api/instructors/${myId}/worklog`, {
      workDate: date,
      text: NARRATIVE,
    });
    expect(post.status, JSON.stringify(post.body).slice(0, 300)).toBe(202);

    // Read back IMMEDIATELY — before any parse can have finished. This is the
    // guarantee: a provider outage costs a reading, never somebody's typing.
    const get = await instructor.get(`/api/instructors/${myId}/worklog?date=${date}`);
    expect(get.status).toBe(200);
    const live = get.body.submissions.at(-1);
    expect(live.rawBullets.join("\n")).toBe(NARRATIVE);
    expect(live.inputMode).toBe("NARRATIVE");
    expect(["PENDING", "PROCESSING", "COMPLETED", "REVIEW_REQUIRED", "FAILED"]).toContain(
      live.processingState,
    );
  });

  test("submitting again replaces the day rather than adding to it", async () => {
    const date = today();
    await instructor.post(`/api/instructors/${myId}/worklog`, {
      workDate: date,
      text: "Took a class from 9 AM to 10 AM.",
    });
    const get = await instructor.get(`/api/instructors/${myId}/worklog?date=${date}`);
    expect(get.body.submissions, "only the live one comes back").toHaveLength(1);
    expect(get.body.submissions[0].rawBullets[0]).toBe("Took a class from 9 AM to 10 AM.");
  });

  test("a body carrying both shapes is refused", async () => {
    const res = await instructor.post(`/api/instructors/${myId}/worklog`, {
      workDate: today(),
      text: "a paragraph",
      bullets: ["a line"],
    });
    expect(res.status, "ambiguous, so neither is guessed at").toBe(400);
  });

  test("a body carrying neither is refused", async () => {
    const res = await instructor.post(`/api/instructors/${myId}/worklog`, {
      workDate: today(),
    });
    expect(res.status).toBe(400);
  });

  test("a paragraph longer than a day's worth is refused", async () => {
    const res = await instructor.post(`/api/instructors/${myId}/worklog`, {
      workDate: today(),
      text: "x".repeat(MAX_NARRATIVE_CHARS + 1),
    });
    expect(res.status).toBe(400);
  });
});

describe("it is their own day", () => {
  test("an instructor cannot write a colleague's worklog", async () => {
    const res = await instructor.post(`/api/instructors/${theirId}/worklog`, {
      workDate: today(),
      text: NARRATIVE,
    });
    expect([403, 404]).toContain(res.status);
  });

  test("an instructor cannot read a colleague's worklog", async () => {
    const res = await instructor.get(`/api/instructors/${theirId}/worklog?date=${today()}`);
    expect([403, 404]).toContain(res.status);
  });

  test("an admin may read it", async () => {
    const res = await admin.get(`/api/instructors/${myId}/worklog?date=${today()}`);
    expect(res.status).toBe(200);
  });
});
