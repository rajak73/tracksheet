import { beforeAll, describe, expect, test } from "vitest";
import { ApiClient, ACCOUNTS } from "./helpers/client";
import { RUN } from "./helpers/fixtures";
/**
 * An instructor records a day that HAS HAPPENED — never one still to come.
 *
 * ── What changed, and what the file used to pin ──────────────────────────
 * This was the today-only rule: an instructor could write today and nothing
 * else, and a missed Tuesday had to go through a manager. The client has
 * dropped that half. People miss days, and routing every one of them through a
 * manager makes the manager the bottleneck on their own roster's paperwork.
 * The audit trail survives it — `createdAt` says when a row was written,
 * `workDate` says which day it describes, and the two differing is visible to
 * anyone reading the record.
 *
 * The future half is unchanged and is a different kind of rule: a day that has
 * not happened cannot be reported on by anybody, at any level, however they
 * ask. That is what these tests are now mostly about.
 *
 * ── Why more than one route is exercised ─────────────────────────────────
 * The reason the file exists at all: the rule was once enforced by
 * `verifyEntry` for the narrative paragraph while the four-field quick entry
 * and the activity edit/delete routes grew up beside it without picking it up,
 * so one screen refused what the pencil next to it allowed. Whatever the rule
 * says, every route that writes a day has to say the same thing — so each is
 * exercised here rather than trusted.
 *
 * The per-activity edit and delete routes are gone; the day route is the
 * correction path now, and it is held to the same rule below.
 */


let admin: ApiClient, instructor: ApiClient;
let myId = "";

/* Northfield is Asia/Kolkata. The rule is judged in the UNIVERSITY's zone, so
 * that is the zone these dates are built in — not the machine's. */
const TODAY = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

const shift = (days: number) => {
  const d = new Date(`${TODAY}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const YESTERDAY = shift(-1);
const TOMORROW = shift(1);

const PASSWORD = "today-only-test-pw-1234";

beforeAll(async () => {
  admin = new ApiClient("admin");
  await admin.login(ACCOUNTS.admin);

  const probe = new ApiClient("probe");
  const northId = (await probe.login(ACCOUNTS.instructorNorth1)).user.universityId!;

  const created = await admin.post("/api/instructors", {
    email: `today-only.${RUN}@fixture.test`,
    name: `Today Only ${RUN}`,
    password: PASSWORD,
    universityId: northId,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  myId = created.body.instructor.id;

  instructor = new ApiClient("me");
  await instructor.login(created.body.instructor.user.email, PASSWORD);
});

const entry = (date: string) => ({
  date,
  deliverable: `Live class ${RUN}`,
  quantity: 1,
  workingHours: 1,
  remarks: null,
});

describe("the four-field quick entry", () => {
  test("today is accepted", async () => {
    const res = await instructor.post(`/api/instructors/${myId}/worklog/entry`, entry(TODAY));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });

  test("yesterday is accepted — a missed day is the instructor's own to file", async () => {
    const res = await instructor.post(`/api/instructors/${myId}/worklog/entry`, entry(YESTERDAY));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });

  test("a day last week is accepted too — the rule is not a grace period", async () => {
    const res = await instructor.post(`/api/instructors/${myId}/worklog/entry`, entry(shift(-7)));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });

  test("tomorrow is refused as not having happened", async () => {
    const res = await instructor.post(`/api/instructors/${myId}/worklog/entry`, entry(TOMORROW));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("WORKLOG_DATE_NOT_ALLOWED");
  });

  test("and the refusal no longer tells them to ask a manager", async () => {
    /* The message was "ask your manager to record anything from an earlier
     * day". For the future that advice was never true — a manager cannot
     * record tomorrow either — and now that the past is allowed there is
     * nothing left to ask anybody for. */
    const res = await instructor.post(`/api/instructors/${myId}/worklog/entry`, entry(TOMORROW));
    expect(res.body.error.message).not.toContain("manager");
  });
});

describe("the activity routes take any day that has happened", () => {
  /* This asymmetry used to need explaining: the create route accepted a past
   * day while PATCH and DELETE refused one, so an instructor could put a row
   * on yesterday and then not be able to touch it. That was the cost of a
   * today-only rule applied to some verbs and not others, and it is gone —
   * every verb now draws the line in the same place, at the future. */
  const local = (date: string) => ({
    activityTypeCode: "TEACHING",
    local: { date, start: "14:00", end: "15:00" },
  });

  test("today is accepted", async () => {
    const res = await instructor.post(`/api/instructors/${myId}/activities`, local(TODAY));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });

  test("a past day is accepted", async () => {
    const res = await instructor.post(`/api/instructors/${myId}/activities`, local(YESTERDAY));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });

  test("a future day is NOT refused by create — stated, not silently true", async () => {
    /* The one hole left, pinned so it cannot widen unnoticed. Guarding this
     * route was tried and broke thirteen suites: fixtures across the codebase
     * use a far-future date as an isolated sandbox, and this is also the route
     * a manager records history through. No instructor SCREEN offers a future
     * date into it, so reaching this needs a hand-written call against one's
     * own record. If that ever stops being true, this test is where to look. */
    const res = await instructor.post(`/api/instructors/${myId}/activities`, local(TOMORROW));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });
});

describe("editing and removing a day that is not today", () => {
  /* Its own date, deliberately. The describes above WRITE to yesterday and
     today — that is the point of them — and a fixture sharing either would
     collide and fail for a reason that has nothing to do with what is tested
     here.

     These used to go through `PATCH`/`DELETE` on
     `/instructors/:id/activities/:activityId`, moving one activity's clock
     around. That route is gone with the model it belonged to: a day is
     corrected by saving it again, and the rule about which days may be written
     has to hold on THAT route, which is what these now check. */
  const DAY = shift(-3);

  test("the instructor may write up a past day", async () => {
    const res = await instructor.post(`/api/instructors/${myId}/worklog/entry`, {
      date: DAY,
      deliverable: "A day I forgot to file at the time",
      workingHours: "4h",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });

  test("and correct it afterwards, in place", async () => {
    const res = await instructor.post(`/api/instructors/${myId}/worklog/entry`, {
      date: DAY,
      deliverable: "The correction",
      workingHours: "5h",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });

  test("moving the correction onto today is allowed — that day has happened", async () => {
    const res = await instructor.post(`/api/instructors/${myId}/worklog/entry`, {
      date: TODAY,
      deliverable: "Today's own work",
      workingHours: "2h",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });

  test("moving it into the future is not", async () => {
    const res = await instructor.post(`/api/instructors/${myId}/worklog/entry`, {
      date: TOMORROW,
      deliverable: "Work I have not done",
      workingHours: "2h",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error.code).toBe("WORKLOG_DATE_NOT_ALLOWED");
  });

  test("and it may be deleted", async () => {
    const res = await instructor.delete(`/api/instructors/${myId}/worklog/entry?date=${DAY}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  test("a day removed through the worklog route leaves the explorer too", async () => {
    /* This used to delete the activity above and check the explorer no longer
       listed it. The explorer reads `WorklogEntry` now, and an ActivityLog row
       was never in it — so that assertion had become true for the wrong reason
       and would have passed however badly the delete worked.
   
       The statement worth holding is the same one, made where it is still
       falsifiable: a day is written, seen, removed, and gone. */
    const DELETE_DAY = shift(-4);
    const write = await instructor.post(`/api/instructors/${myId}/worklog/entry`, {
      date: DELETE_DAY,
      deliverable: "A day to be removed",
      workingHours: "3h",
    });
    expect(write.status, JSON.stringify(write.body)).toBe(201);

    const listed = async () => {
      const res = await admin.get(
        `/api/activities?instructorId=${myId}&from=${DELETE_DAY}&to=${DELETE_DAY}&limit=50`,
      );
      expect(res.status).toBe(200);
      return res.body.days as Array<{ logDate: string }>;
    };

    expect((await listed()).map((d) => d.logDate)).toContain(DELETE_DAY);

    const gone = await instructor.delete(
      `/api/instructors/${myId}/worklog/entry?date=${DELETE_DAY}`,
    );
    expect(gone.status, JSON.stringify(gone.body)).toBe(200);

    expect(await listed()).toEqual([]);
  });
});
