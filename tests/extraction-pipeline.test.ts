import { beforeAll, describe, expect, test } from "vitest";
import { ACCOUNTS, ApiClient } from "./helpers/client";
import { toDateOnly } from "@/server/time/workday";
import { daysAgo } from "./helpers/worklog";
import { RUN } from "./helpers/fixtures";
import {
  parseExtraction,
  runExtraction,
  serveDayExtraction,
  extractionInstruction,
} from "@/server/insights/extract";
import type { DayText } from "@/server/insights/extraction-checks";

/**
 * The pipeline that was built and never wired.
 *
 * `checkExtraction` had no caller and nothing wrote `DayExtraction`, which is
 * the whole gap between "built" and "working". These tests hold the parts that
 * cost money or lose data: a cached day must not pay again, a refused
 * extraction must not be stored in pieces, and a failed day must still
 * contribute its minutes to every total.
 */

const admin = new ApiClient("extract-admin");
let instructorId = "";
let universityId = "";
const DAY = daysAgo(6);

const dayText = (over: Partial<DayText> = {}): DayText => ({
  deliverable: "checked 25 quiz papers — 45 minutes",
  deliverableQuantity: null,
  workingMinutes: 360,
  ...over,
});

/** A provider that counts, so "zero calls" is measured rather than assumed. */
function provider(replies: string[]) {
  let calls = 0;
  return {
    calls: () => calls,
    call: async () => {
      const body = replies[Math.min(calls, replies.length - 1)]!;
      calls += 1;
      return { ok: true as const, text: body };
    },
  };
}

const GOOD = JSON.stringify({
  activities: [
    { label: "checked quiz papers", sessions: 25, duration_value: 45, duration_unit: "minutes" },
  ],
});

beforeAll(async () => {
  await admin.login(ACCOUNTS.admin);
  const probe = new ApiClient("extract-probe");
  universityId = (await probe.login(ACCOUNTS.instructorNorth1)).user.universityId!;
  const made = await admin.post("/api/instructors", {
    email: `extract.${RUN}@fixture.test`,
    name: `Extract ${RUN}`,
    password: "extraction-password-1234",
    universityId,
  });
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  instructorId = made.body.instructor.id;
});

describe("the prompt asks for what the text states", () => {
  test("it forbids conversion, addition, and reading a duration off a clock", () => {
    const text = extractionInstruction(dayText());
    expect(text).toContain("Never convert between units");
    expect(text).toContain("Never add durations together");
    expect(text).toContain("states WHEN something happened, not how long");
    expect(text).toContain("duration_value");
    expect(text).toContain("duration_unit");
    /* The recorded total is in the context so the model can see the shape of
       the day, and the prompt has to say out loud that it is not an answer. */
    expect(text).toContain("Do not use working_minutes for anything");
  });
});

describe("a reply is parsed strictly or not at all", () => {
  test("a well-formed reply parses", () => {
    expect(parseExtraction(GOOD)).toEqual([
      {
        label: "checked quiz papers",
        subtopic: null,
        topic: null,
        sessions_unit: null,
        sessions: 25,
        duration_value: 45,
        duration_unit: "minutes",
      },
    ]);
  });

  test("a value without a unit is refused", () => {
    // Nothing can convert it, so it is not an answer to the question asked.
    const reply = JSON.stringify({
      activities: [{ label: "x", sessions: null, duration_value: 45, duration_unit: null }],
    });
    expect(parseExtraction(reply)).toBeNull();
  });

  test("a unit without a value is refused", () => {
    const reply = JSON.stringify({
      activities: [{ label: "x", sessions: null, duration_value: null, duration_unit: "minutes" }],
    });
    expect(parseExtraction(reply)).toBeNull();
  });

  test("prose, or an unknown unit, is refused rather than coerced", () => {
    expect(parseExtraction("I think they marked some papers.")).toBeNull();
    expect(
      parseExtraction(
        JSON.stringify({
          activities: [{ label: "x", sessions: null, duration_value: 1, duration_unit: "days" }],
        }),
      ),
    ).toBeNull();
  });
});

describe("running an extraction", () => {
  test("a good reply converts once, in code", async () => {
    const p = provider([GOOD]);
    const result = await runExtraction(dayText(), p.call);
    expect(result.status).toBe("READY");
    if (result.status !== "READY") return;
    expect(result.items).toEqual([
      {
        label: "checked quiz papers",
        subtopic: null,
        topic: null,
        sessions_unit: null,
        sessions: 25,
        minutes: 45,
      },
    ]);
    expect(result.unallocatedMinutes).toBe(315);
    expect(p.calls()).toBe(1);
  });

  test("a refused extraction is retried exactly once, then FAILED", async () => {
    // 45 is in the text; 200 is not, so provenance refuses both attempts.
    const bad = JSON.stringify({
      activities: [
        { label: "checked quiz papers", sessions: null, duration_value: 200, duration_unit: "minutes" },
      ],
    });
    const p = provider([bad, bad]);
    const result = await runExtraction(dayText(), p.call);
    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") return;
    expect(result.lastError, "the failure names the check that refused it").toContain("check 1");
    expect(p.calls(), "one retry, not a loop").toBe(2);
  });

  test("a retry that succeeds is kept", async () => {
    const bad = JSON.stringify({ activities: "not an array" });
    const p = provider([bad, GOOD]);
    const result = await runExtraction(dayText(), p.call);
    expect(result.status).toBe("READY");
    expect(p.calls()).toBe(2);
  });

  test("nothing partial is ever returned", async () => {
    /* One good activity and one invented one. The good half is not kept: an
       extraction that drops what failed is a reading of the record that nobody
       can reproduce from the record. */
    const half = JSON.stringify({
      activities: [
        { label: "checked quiz papers", sessions: 25, duration_value: 45, duration_unit: "minutes" },
        { label: "capstone review", sessions: 3, duration_value: null, duration_unit: null },
      ],
    });
    const p = provider([half, half]);
    const result = await runExtraction(dayText(), p.call);
    expect(result.status).toBe("FAILED");
  });
});

describe("serving a day", () => {
  const logDate = () => toDateOnly(DAY);

  test("9. a day already extracted with a matching hash fires zero calls", async () => {
    const day = dayText();
    const first = provider([GOOD]);
    await serveDayExtraction({
      instructorId,
      logDate: logDate(),
      day,
      sourceHash: "a".repeat(64),
      call: first.call,
    });
    expect(first.calls()).toBe(1);

    const second = provider([GOOD]);
    const served = await serveDayExtraction({
      instructorId,
      logDate: logDate(),
      day,
      sourceHash: "a".repeat(64),
      call: second.call,
    });
    expect(second.calls(), "a matching source hash must not pay again").toBe(0);
    expect(served.status).toBe("READY");
    expect(served.unallocatedMinutes).toBe(315);
  });

  test("a changed day changes the hash and is extracted again", async () => {
    const p = provider([GOOD]);
    await serveDayExtraction({
      instructorId,
      logDate: logDate(),
      day: dayText(),
      sourceHash: "b".repeat(64),
      call: p.call,
    });
    expect(p.calls()).toBe(1);
  });

  test("15. a FAILED day stores no items and keeps its minutes unallocated", async () => {
    const bad = JSON.stringify({ activities: [{ label: "invented", sessions: 9, duration_value: null, duration_unit: null }] });
    const p = provider([bad, bad]);
    const row = await serveDayExtraction({
      instructorId,
      logDate: toDateOnly(daysAgo(5)),
      day: dayText({ workingMinutes: 480 }),
      sourceHash: "c".repeat(64),
      call: p.call,
    });
    expect(row.status).toBe("FAILED");
    expect(row.items).toEqual([]);
    expect(row.lastError).toBeTruthy();
    /* The day's minutes are untouched by the extraction failing. Totals read
       WorklogEntry, and a failed reading of a day must never remove the day. */
    expect(row.unallocatedMinutes).toBe(480);
  });
});
