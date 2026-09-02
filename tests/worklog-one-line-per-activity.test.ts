import { beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/server/db";
import { ApiClient, ACCOUNTS } from "./helpers/client";
import { toDateOnly } from "@/server/time/workday";
import { daysAgo } from "./helpers/worklog";
import { checkExtraction } from "@/server/insights/extraction-checks";
import { RUN } from "./helpers/fixtures";
/**
 * The day's work is written a line at a time, in one box.
 *
 * ── What this replaced, and why the form was the bug ──────────────────────
 * There were two boxes: what you did, and how many. They were joined by
 * nothing but position, and half the days in the dev database show what that
 * produces — nine descriptions beside "1, 1, 12, 1, 4, 1, 1, 1, 6". One day has
 * five descriptions and four numbers, so even counting them off fails.
 *
 * No instructor means to write that. The form asked for it, and extraction
 * cannot repair it: the pairing is destroyed before the data is stored.
 *
 * A line break is the one separator that cannot be mistaken for content.
 * Commas already appear inside descriptions, so splitting on them guesses; the
 * proximity check segments on newlines, so a number written on a line can only
 * ever vouch for that line's activity.
 *
 * ── The hint is a hint ────────────────────────────────────────────────────
 * Nothing validates the shape. No required separator, no parse at write time,
 * no rejection. An instructor mid-entry who writes one paragraph must be able
 * to save it — they get an extraction with null counts, which is honest, rather
 * than an error telling them their own description is malformed.
 */


let admin: ApiClient, instructor: ApiClient;
let instructorId = "", universityId = "";

beforeAll(async () => {
  admin = new ApiClient("admin");
  await admin.login(ACCOUNTS.admin);

  const probe = new ApiClient("probe");
  universityId = (await probe.login(ACCOUNTS.instructorNorth1)).user.universityId!;

  const created = await admin.post("/api/instructors", {
    email: `oneline.${RUN}@fixture.test`,
    name: `One Line ${RUN}`,
    password: "one-line-per-activity-pw",
    universityId,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  instructorId = created.body.instructor.id;

  instructor = new ApiClient("one-line");
  await instructor.login(`oneline.${RUN}@fixture.test`, "one-line-per-activity-pw");
});

const save = (date: string, deliverable: string, extra: Record<string, unknown> = {}) =>
  instructor.post(`/api/instructors/${instructorId}/worklog/entry`, {
    date,
    deliverable,
    workingHours: "8h",
    ...extra,
  });

const stored = (date: string) =>
  prisma.worklogEntry.findUnique({
    where: { instructorId_logDate: { instructorId, logDate: toDateOnly(date) } },
  });

describe("1. the form collects one text field for the day's work", () => {
  test("a day saved without a quantity stores null for it", async () => {
    const day = daysAgo(300);
    const res = await save(day, "Java class - inheritance - 2 classes - 4 hours");
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const row = await stored(day);
    /* Not "" and not "0". The form does not ask, so there is one value for
       "nobody said", which is what the column already meant. */
    expect(row!.deliverableQuantity).toBeNull();
  });

  test("and the four lines are stored exactly as typed, newlines and all", async () => {
    const day = daysAgo(301);
    const text = [
      "Java class - inheritance and interfaces - 2 classes - 4 hours",
      "Doubt solving session - 1 hour",
      "Department meeting - exam schedule",
      "Checked DSA assignments - batch A",
    ].join("\n");

    expect((await save(day, text)).status).toBe(201);
    const row = await stored(day);
    expect(row!.deliverable).toBe(text);
    expect(row!.deliverable.split("\n")).toHaveLength(4);
  });
});

describe("2. the hint never becomes a rule", () => {
  test("one paragraph, no line breaks, saves", async () => {
    /* THE test of this change. Somebody mid-entry who writes prose has to be
       able to save it. A form that refuses an instructor's own description of
       their day because it lacks a separator has made the guidance into a gate,
       which is the failure this whole redesign is about. */
    const day = daysAgo(302);
    const paragraph =
      "Spent the morning on the OOPs lecture for section A and then most of the " +
      "afternoon marking, plus a short catch-up with the lab team about next week.";

    const res = await save(day, paragraph);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await stored(day))!.deliverable).toBe(paragraph);
  });

  test("a single line with no counts and no hours saves", async () => {
    const day = daysAgo(303);
    expect((await save(day, "Department meeting")).status).toBe(201);
  });

  test("what is still refused is what was always refused", async () => {
    /* Emptiness and an unreadable duration. Nothing about the SHAPE of the
       text — only that there is some, and that the hours are a length of time. */
    expect((await save(daysAgo(304), "   ")).status).toBe(400);
    expect(
      (await save(daysAgo(304), "Real work", { workingHours: "not a duration" })).status,
    ).toBe(400);
  });
});

describe("3 & 4. a number on a line vouches for that line, and no other", () => {
  const FOUR_LINES = [
    "Java class - inheritance and interfaces - 2 classes - 4 hours",
    "Doubt solving session - 1 hour",
    "Department meeting - exam schedule",
    "Checked DSA assignments - batch A",
  ].join("\n");

  const day = { deliverable: FOUR_LINES, deliverableQuantity: null, workingHours: 8 };

  test("3. each line's own numbers pass against its own activity", () => {
    const result = checkExtraction(
      [
        { label: "Java class inheritance", sessions: 2, hours: 4 },
        { label: "Doubt solving session", sessions: null, hours: 1 },
        { label: "Department meeting", sessions: null, hours: null },
        { label: "Checked DSA assignments", sessions: null, hours: null },
      ],
      day,
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    // 4 + 1 stated against 8 recorded.
    expect(result.ok && result.unallocatedHours).toBe(3);
  });

  test("4. a number from one line fails against an activity from another", () => {
    /* The two boxes could not fail this. Every number really was present in the
       text, so presence passed it to whichever activity asked — which is how
       "40" attached itself to the wrong thing. */
    const wrong = checkExtraction(
      [{ label: "Department meeting", sessions: 2, hours: null }],
      day,
    );
    expect(!wrong.ok && wrong.failures.some((f) => f.check === 1)).toBe(true);

    const alsoWrong = checkExtraction(
      [{ label: "Doubt solving session", sessions: null, hours: 4 }],
      day,
    );
    expect(!alsoWrong.ok && alsoWrong.failures.some((f) => f.check === 1)).toBe(true);
  });

  test("a paragraph day extracts with null counts rather than failing", () => {
    /* The honest outcome for somebody who ignored the hint: no numbers are
       claimed, so none has to be proved, and the day is described rather than
       counted. */
    const paragraph = {
      deliverable: "Spent the morning on the OOPs lecture and the afternoon marking",
      deliverableQuantity: null,
      workingHours: 6,
    };
    const result = checkExtraction(
      [{ label: "OOPs lecture", sessions: null, hours: null }],
      paragraph,
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.ok && result.unallocatedHours).toBe(6);
  });
});

describe("5. days written before the merge keep their quantity", () => {
  test("a stored quantity still comes back through the explorer, verbatim", async () => {
    /* The column stays. Six days in dev hold a real value somebody typed, and
       the table still prints it for them — removing the field from the FORM is
       not the same as removing it from the record. */
    const day = daysAgo(305);
    await prisma.worklogEntry.create({
      data: {
        instructorId,
        universityId,
        logDate: toDateOnly(day),
        deliverable: "Live Class on binary search, Doubt clearing session",
        deliverableQuantity: "2 classes taken, 1 doubt session",
        workingHours: 7,
      },
    });

    const res = await instructor.get(
      `/api/activities?instructorId=${instructorId}&from=${day}&to=${day}&limit=10`,
    );
    expect(res.status).toBe(200);
    expect(res.body.days[0].deliverableQuantity).toBe("2 classes taken, 1 doubt session");
  });
});
