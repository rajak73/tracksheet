import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { ApiClient, ACCOUNTS } from "./helpers/client";
import { prisma } from "@/server/db";
import { toDateOnly } from "@/server/time/workday";
import { RUN } from "./helpers/fixtures";
/**
 * Writing up a day.
 *
 * ── Ported, not rewritten ─────────────────────────────────────────────────
 * Every assertion here survived the move to one row per day, except one that
 * asserted the opposite of the current design and is named below. The rest read
 * back from `WorklogEntry` instead of from a list of activity rows; what they
 * check is unchanged, because what the form promises is unchanged.
 *
 * ── The one that was deleted rather than ported ───────────────────────────
 * "a second entry on the same day sits after the first, not on top of it".
 *
 * That was true of the old model and is deliberately false now. A second save
 * REPLACES the day, because `(instructorId, logDate)` is unique and a save is an
 * upsert. Porting it would have meant either testing behaviour the product no
 * longer has, or quietly relaxing it until it passed. `worklog-day-uniqueness`
 * asserts the replacement directly.
 */

const PASSWORD = "quick-entry-password-1234";

let admin: ApiClient;
let instructor: ApiClient;
let colleague: ApiClient;
let myId = "";
let colleagueId = "";

/* Northfield is Asia/Kolkata, and a work day is judged in the UNIVERSITY's zone
 * — so that is the zone this date is built in, not the machine's. */
const TODAY = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

/** The day as it is stored, which is the only place worth reading it back from. */
const storedDay = (instructorId: string, date = TODAY) =>
  prisma.worklogEntry.findUnique({
    where: { instructorId_logDate: { instructorId, logDate: toDateOnly(date) } },
  });

const save = (client: ApiClient, instructorId: string, body: Record<string, unknown>) =>
  client.post(`/api/instructors/${instructorId}/worklog/entry`, { date: TODAY, ...body });

beforeAll(async () => {
  admin = new ApiClient("admin");
  await admin.login(ACCOUNTS.admin);

  const probe = new ApiClient("probe");
  const universityId = (await probe.login(ACCOUNTS.instructorNorth1)).user.universityId!;

  const mine = await admin.post("/api/instructors", {
    email: `quick.mine.${RUN}@fixture.test`,
    name: `Quick Mine ${RUN}`,
    password: PASSWORD,
    universityId,
  });
  expect(mine.status, JSON.stringify(mine.body)).toBe(201);
  myId = mine.body.instructor.id;

  const theirs = await admin.post("/api/instructors", {
    email: `quick.other.${RUN}@fixture.test`,
    name: `Quick Other ${RUN}`,
    password: PASSWORD,
    universityId,
  });
  expect(theirs.status, JSON.stringify(theirs.body)).toBe(201);
  colleagueId = theirs.body.instructor.id;

  instructor = new ApiClient("instructor");
  await instructor.login(`quick.mine.${RUN}@fixture.test`, PASSWORD);
  colleague = new ApiClient("colleague");
  await colleague.login(`quick.other.${RUN}@fixture.test`, PASSWORD);
});

beforeEach(async () => {
  await prisma.worklogEntry.deleteMany({ where: { instructorId: { in: [myId, colleagueId] } } });
});

describe("writing up a day", () => {
  test("four fields are enough", async () => {
    const res = await save(instructor, myId, {
      deliverable: "Java class - inheritance and interfaces",
      quantity: "2 classes",
      workingHours: "6h 30m",
      remarks: "covered interfaces",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const day = await storedDay(myId);
    expect(day, "the day should come back in their own log").toBeTruthy();
    expect(day!.deliverable).toBe("Java class - inheritance and interfaces");
    expect(day!.deliverableQuantity).toBe("2 classes");
    expect(Number(day!.workingHours)).toBe(6.5);
    expect(day!.remarks).toBe("covered interfaces");
  });

  test("the day's hours are what was typed, however it was typed", async () => {
    for (const [typed, expected] of [
      ["8", 8],
      ["8.5", 8.5],
      ["8h 30m", 8.5],
      ["8:30", 8.5],
      ["45m", 0.75],
      ["6 hours 30 minutes", 6.5],
    ] as const) {
      const res = await save(instructor, myId, { deliverable: "Teaching", workingHours: typed });
      expect(res.status, `${typed}: ${JSON.stringify(res.body)}`).toBe(201);
      const day = await storedDay(myId);
      expect(Number(day!.workingHours), `"${typed}" should be ${expected}h`).toBe(expected);
    }
  });

  test("an edit keeps the row and changes what it says", async () => {
    await save(instructor, myId, { deliverable: "The original", workingHours: "4" });
    const before = await storedDay(myId);

    await save(instructor, myId, { deliverable: "The correction", workingHours: "5" });
    const after = await storedDay(myId);

    /* The same row, not a new one. Its id is what an audit entry and anything
       else pointing at this day refers to. */
    expect(after!.id, "correcting a day must not replace its identity").toBe(before!.id);
    expect(after!.deliverable).toBe("The correction");
    expect(Number(after!.workingHours)).toBe(5);
  });

  test("quantity is stored exactly as typed, whatever it says", async () => {
    /* Free text. "half day" is not a number and never becomes one; junk is still
       what somebody wrote and is not tidied away. */
    for (const quantity of ["2 classes + 1 doubt", "half day", "gfddgh"]) {
      await save(instructor, myId, { deliverable: "Lab supervision", workingHours: "3", quantity });
      const day = await storedDay(myId);
      expect(day!.deliverableQuantity).toBe(quantity);
    }
  });

  test("an omitted quantity is absent rather than empty", async () => {
    await save(instructor, myId, { deliverable: "Marking", workingHours: "2" });
    const day = await storedDay(myId);
    // One value for "they wrote nothing", not two.
    expect(day!.deliverableQuantity).toBeNull();
  });
});

describe("what the form refuses", () => {
  test("no deliverable", async () => {
    const res = await save(instructor, myId, { deliverable: "   ", workingHours: "4" });
    expect(res.status).toBe(400);
  });

  test("hours that are not a length of time", async () => {
    for (const workingHours of ["", "abc", "2 classes"]) {
      const res = await save(instructor, myId, { deliverable: "Teaching", workingHours });
      expect(res.status, `"${workingHours}" should be refused`).toBe(400);
    }
  });

  test("a bare number that is longer than a working day", async () => {
    /* "45" in a box labelled Working Hours reads as forty-five hours. Almost
       nobody means that, so it is refused where the message can say so. */
    const res = await save(instructor, myId, { deliverable: "Teaching", workingHours: "45" });
    expect(res.status).toBe(400);
  });

  test("more hours than a day can hold", async () => {
    const res = await save(instructor, myId, { deliverable: "Teaching", workingHours: "30h" });
    expect(res.status).toBe(400);
  });

  test("a date that is not a date", async () => {
    const res = await instructor.post(`/api/instructors/${myId}/worklog/entry`, {
      date: "2026-02-31",
      deliverable: "Teaching",
      workingHours: "4",
    });
    expect(res.status).toBe(400);
  });
});

describe("it is their own log", () => {
  test("an instructor cannot write into a colleague's day", async () => {
    const res = await save(colleague, myId, { deliverable: "Not mine to write", workingHours: "4" });
    expect([403, 404]).toContain(res.status);

    const day = await storedDay(myId);
    expect(day, "nothing should have been written").toBeNull();
  });

  test("nor delete a colleague's day", async () => {
    await save(instructor, myId, { deliverable: "Mine", workingHours: "4" });

    const res = await colleague.delete(`/api/instructors/${myId}/worklog/entry?date=${TODAY}`);
    expect([403, 404]).toContain(res.status);

    const day = await storedDay(myId);
    expect(day, "the day must survive a refused delete").toBeTruthy();
  });

  test("removing your own day removes it, and saying so twice is not an error", async () => {
    await save(instructor, myId, { deliverable: "Mine to remove", workingHours: "4" });

    const first = await instructor.delete(`/api/instructors/${myId}/worklog/entry?date=${TODAY}`);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(await storedDay(myId)).toBeNull();

    /* Idempotent: the caller asked for the day to be absent and it is. A 404
       here would tell somebody clicking Delete twice they had done wrong. */
    const second = await instructor.delete(`/api/instructors/${myId}/worklog/entry?date=${TODAY}`);
    expect(second.status).toBe(200);
  });
});
