import { beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/server/db";
import { ApiClient, ACCOUNTS } from "./helpers/client";

/**
 * Instructor Category and Subjects Covered, proved apart.
 *
 * ── Why every case here uses a deliberate mismatch ────────────────────────
 * These two fields agreeing proves nothing — a single field would look
 * identical. So the fixture files somebody under ENGLISH and then has them do
 * a week of TECH work, and every assertion below turns on the two answers
 * being different.
 *
 * That is not a contrived case. It is the ordinary one: an instructor is filed
 * under what they were hired to teach, and a report is read for what they
 * actually did. The single column that tried to be both is what produced the
 * contradiction these fields resolve.
 */

const RUN = Math.random()
  .toString(36)
  .slice(2, 10)
  .replace(/[0-9]/g, (d) => String.fromCharCode(103 + Number(d)));

let admin: ApiClient, manager: ApiClient;
let northId = "";
let subjectId: Record<string, string> = {};
let instructorId = "";
let managerId = "";

/** Two subjects on one day, so "Tech, Maths" has something to be built from. */
const DAY = new Date();
DAY.setUTCHours(0, 0, 0, 0);
const DATE = DAY.toISOString().slice(0, 10);

async function logEntry(subjectCode: string, startHourUtc: number, hours: number) {
  const type = await prisma.activityType.findFirstOrThrow({ where: { code: "TEACHING" } });
  const start = new Date(`${DATE}T00:00:00.000Z`);
  start.setUTCHours(startHourUtc, 0, 0, 0);
  await prisma.activityLog.create({
    data: {
      instructorId,
      universityId: northId,
      activityTypeId: type.id,
      broadCategoryId: subjectId[subjectCode]!,
      workDate: new Date(`${DATE}T00:00:00.000Z`),
      startTime: start,
      endTime: new Date(start.getTime() + hours * 3_600_000),
      quantity: 1,
      rawText: `${subjectCode} work ${RUN}`,
    },
  });
}

beforeAll(async () => {
  admin = new ApiClient("admin");
  await admin.login(ACCOUNTS.admin);
  manager = new ApiClient("manager");
  await manager.login(ACCOUNTS.managerNorth);

  const north = new ApiClient("n1");
  northId = (await north.login(ACCOUNTS.instructorNorth1)).user.universityId!;

  const categories = await prisma.instructorCategory.findMany({ select: { id: true, code: true } });
  subjectId = Object.fromEntries(categories.map((c) => [c.code, c.id]));

  const created = await admin.post("/api/instructors", {
    email: `twofields.${RUN}@example.edu`,
    name: `Two Fields ${RUN}`,
    password: "two-fields-pw-12345",
    universityId: northId,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  instructorId = created.body.instructor.id;

  // Filed under English…
  const assigned = await admin.patch(`/api/instructors/${instructorId}`, { categoryCode: "ENGLISH" });
  expect(assigned.status, JSON.stringify(assigned.body)).toBe(200);

  // …and then a day of Technical and Mathematics work.
  await logEntry("TECH", 4, 2);
  await logEntry("MATH", 7, 1);

  // On the manager's roster, so the manager views can see them.
  const me = await manager.get("/api/auth/me");
  managerId = me.body.user.managerId!;
  const assign = await admin.patch(`/api/instructors/${instructorId}`, { managerId });
  expect([200, 400]).toContain(assign.status);
  if (assign.status !== 200) {
    await prisma.instructor.update({ where: { id: instructorId }, data: { managerId } });
  }
});

describe("the instructor's own view carries both, independently", () => {
  test("each entry carries the subject it was about", async () => {
    const res = await admin.get(
      `/api/activities?from=${DATE}&to=${DATE}&limit=200`,
    );
    expect(res.status).toBe(200);
    const mine = res.body.activities.filter(
      (a: { instructorId: string }) => a.instructorId === instructorId,
    );
    expect(mine.length, "the two entries logged above").toBe(2);
    expect(new Set(mine.map((a: { broadCategory: { code: string } }) => a.broadCategory.code)))
      .toEqual(new Set(["TECH", "MATH"]));
  });

  test("and the person's own assigned category, which is neither of them", async () => {
    const res = await admin.get(`/api/activities?from=${DATE}&to=${DATE}&limit=200`);
    const mine = res.body.activities.filter(
      (a: { instructorId: string }) => a.instructorId === instructorId,
    );
    for (const row of mine) {
      expect(row.instructorCategory?.code, "assigned, not inferred").toBe("ENGLISH");
    }
  });

  test("the two fields do not track each other", async () => {
    /* The whole point. If one field were driving both, these would agree. */
    const res = await admin.get(`/api/activities?from=${DATE}&to=${DATE}&limit=200`);
    const row = res.body.activities.find(
      (a: { instructorId: string }) => a.instructorId === instructorId,
    );
    expect(row.instructorCategory.code).toBe("ENGLISH");
    expect(row.broadCategory.code).not.toBe("ENGLISH");
  });
});

describe("the manager's day and week sheets carry both", () => {
  test("the roster row names the assigned category", async () => {
    const res = await manager.get(`/api/manager/worklog?from=${DATE}&to=${DATE}`);
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
    const person = res.body.instructors.find(
      (i: { instructorId: string }) => i.instructorId === instructorId,
    );
    expect(person, "the instructor should be on the roster payload").toBeTruthy();
    expect(person.category?.code).toBe("ENGLISH");
  });

  test("and the activities carry what was actually worked on", async () => {
    const res = await manager.get(`/api/manager/worklog?from=${DATE}&to=${DATE}`);
    const person = res.body.instructors.find(
      (i: { instructorId: string }) => i.instructorId === instructorId,
    );
    const subjects = new Set(
      person.activities.map((a: { broadCategory: { code: string } | null }) => a.broadCategory?.code),
    );
    expect(subjects).toEqual(new Set(["TECH", "MATH"]));
    expect(subjects.has("ENGLISH"), "never the assigned one, unless they taught it").toBe(false);
  });
});

describe("the manager's month spreadsheet puts each where it belongs", () => {
  test("the assigned category is one fixed value on the row", async () => {
    // The sticky left column: a property of the person, not of a week.
    const res = await admin.get(
      `/api/universities/${northId}/tracker?from=${DATE}&to=${DATE}`,
    );
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
    const row = res.body.tracker.rows.find(
      (r: { instructorId: string }) => r.instructorId === instructorId,
    );
    expect(row, "the instructor should appear").toBeTruthy();
    expect(row.broadCategory?.code, "assigned, on the row").toBe("ENGLISH");
  });

  test("subjects covered sit inside the week, not on the row", async () => {
    /* They vary week to week for the same person, which is exactly why they
     * cannot live in a sticky identity column. */
    const res = await admin.get(
      `/api/universities/${northId}/tracker?from=${DATE}&to=${DATE}`,
    );
    const row = res.body.tracker.rows.find(
      (r: { instructorId: string }) => r.instructorId === instructorId,
    );
    // `cells` is keyed by week index, not an array.
    const cell = Object.values(row.cells as Record<string, { subjects?: string[] }>).find(
      (c) => c?.subjects?.length,
    );
    expect(cell, "the week holding the work should carry its subjects").toBeTruthy();
    expect(new Set(cell!.subjects)).toEqual(new Set(["Technical", "Mathematics"]));
    expect(cell!.subjects, "never the assigned category").not.toContain("English");
  });

  test("the row carries no subjects of its own", async () => {
    // If it did, there would be two places to read the same thing from, and
    // one column pretending to be both fields again.
    const res = await admin.get(
      `/api/universities/${northId}/tracker?from=${DATE}&to=${DATE}`,
    );
    const row = res.body.tracker.rows.find(
      (r: { instructorId: string }) => r.instructorId === instructorId,
    );
    expect(row.subjects, "subjects belong to a week, not to a person").toBeUndefined();
  });
});
