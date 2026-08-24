import { beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/server/db";
import { ApiClient, ACCOUNTS } from "./helpers/client";

/**
 * Broad Category is read from the work, and the assigned category is not a
 * report column.
 *
 * ── Why every case here uses a deliberate mismatch ────────────────────────
 * The fixture files somebody under ENGLISH and then has them do a week of TECH
 * and MATH work, so that every assertion turns on which of the two answers a
 * given surface gives. If a report ever went back to printing the assigned
 * value, "English" would appear where "Technical, Mathematics" belongs and
 * these tests would say so.
 *
 * That is not a contrived case. It is the ordinary one: an instructor is filed
 * under what they were hired to teach, and a report is read for what they
 * actually did.
 *
 * ── This file used to prove the opposite ──────────────────────────────────
 * It was written when Broad Category had been split in two — an assigned
 * "Instructor Category" beside an inferred "Subjects Covered" — and it proved
 * the two apart. The client has since asked for the assigned column to go and
 * the inferred one to take the Broad Category name, so the assertions now run
 * the other way: the assigned value must NOT reach a report row.
 *
 * `Instructor.category` itself is untouched. It is still assigned in the admin
 * screens and still travels on the instructor's own record; it simply is not a
 * column on any sheet.
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

describe("the manager's day and week sheets read the work", () => {
  test("the assigned category still travels on the person's record", async () => {
    const res = await manager.get(`/api/manager/worklog?from=${DATE}&to=${DATE}`);
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
    const person = res.body.instructors.find(
      (i: { instructorId: string }) => i.instructorId === instructorId,
    );
    expect(person, "the instructor should be on the roster payload").toBeTruthy();
    /* The API still carries it — it is a real property of the person, assigned
     * in the admin screens. What changed is that no sheet prints it. */
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

describe("the manager's month spreadsheet reads Broad Category from the week", () => {
  test("the row carries no assigned category at all", async () => {
    /* The sticky identity column that held it is gone, and so is the per-render
     * query that fetched it. A field left on the row would be one more thing a
     * future screen could print by reaching for the wrong name. */
    const res = await admin.get(
      `/api/universities/${northId}/tracker?from=${DATE}&to=${DATE}`,
    );
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
    const row = res.body.tracker.rows.find(
      (r: { instructorId: string }) => r.instructorId === instructorId,
    );
    expect(row, "the instructor should appear").toBeTruthy();
    expect(row.broadCategory, "the assigned category is not on the row").toBeUndefined();
  });

  test("Broad Category sits inside the week, not on the row", async () => {
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
    // If it did, there would be two places to read the same thing from, and a
    // week-varying value frozen onto a person again.
    const res = await admin.get(
      `/api/universities/${northId}/tracker?from=${DATE}&to=${DATE}`,
    );
    const row = res.body.tracker.rows.find(
      (r: { instructorId: string }) => r.instructorId === instructorId,
    );
    expect(row.subjects, "subjects belong to a week, not to a person").toBeUndefined();
  });
});

describe("the manager's roster is decided by the server, not the request", () => {
  /**
   * Requirement 4, at the API rather than through the screen.
   *
   * A hidden row is not an absent one. What matters is whether the manager can
   * reach somebody off their roster by asking for them directly — and every
   * one of these asks directly.
   */

  test("the roster payload holds their own people, and nobody else's", async () => {
    /* ── What "their roster" actually means ──────────────────────────────
     * Their assigned instructors, PLUS the ones nobody leads yet when they are
     * the university's primary manager. That second half is deliberate and
     * documented: an unassigned instructor would otherwise belong to no
     * roster, appear in no queue, and be seen by nobody — which is the failure
     * the escape hatch exists to prevent, not a leak.
     *
     * This test asserted the narrower rule first and caught the wider one,
     * which is worth recording: the boundary is "mine, or nobody's and I am
     * primary", never "anyone in my university". */
    const res = await manager.get(`/api/manager/worklog?from=${DATE}&to=${DATE}`);
    expect(res.status).toBe(200);

    const university = await prisma.university.findUniqueOrThrow({
      where: { id: northId },
      select: { primaryManagerId: true },
    });
    const isPrimary = university.primaryManagerId === managerId;

    const reachable = await prisma.instructor.findMany({
      where: isPrimary
        ? { universityId: northId, OR: [{ managerId }, { managerId: null }] }
        : { managerId },
      select: { id: true },
    });
    const allowed = new Set(reachable.map((i) => i.id));

    for (const id of res.body.instructors.map((i: { instructorId: string }) => i.instructorId)) {
      expect(allowed.has(id), `${id} is neither theirs nor unassigned`).toBe(true);
    }
  });

  test("somebody on ANOTHER manager's roster never appears", async () => {
    // The half of the boundary the escape hatch does not widen.
    const res = await manager.get(`/api/manager/worklog?from=${DATE}&to=${DATE}`);
    const returned: string[] = res.body.instructors.map(
      (i: { instructorId: string }) => i.instructorId,
    );
    const someoneElses = await prisma.instructor.findMany({
      where: { universityId: northId, managerId: { not: null, notIn: [managerId] } },
      select: { id: true },
    });
    for (const other of someoneElses) {
      expect(returned, `${other.id} is on another roster`).not.toContain(other.id);
    }
  });

  test("asking for somebody else's instructor by id is refused", async () => {
    // Somebody in the same university, on nobody's roster or another's.
    // Assigned to somebody else — not merely unassigned, which the primary
    // manager may legitimately reach.
    const outsider = await prisma.instructor.findFirst({
      where: { universityId: northId, managerId: { not: null, notIn: [managerId] } },
      select: { id: true },
    });
    if (!outsider) return; // nothing to prove against
    const res = await manager.get(`/api/instructors/${outsider.id}/activities`);
    expect(
      [403, 404],
      "an off-roster id answers as an unknown one does",
    ).toContain(res.status);
  });

  test("and neither is their worklog", async () => {
    const outsider = await prisma.instructor.findFirst({
      where: { universityId: northId, managerId: { not: null, notIn: [managerId] } },
      select: { id: true },
    });
    if (!outsider) return;
    const res = await manager.get(`/api/instructors/${outsider.id}/worklog?date=${DATE}`);
    expect([403, 404]).toContain(res.status);
  });

  test("a manager cannot reach another university at all", async () => {
    const elsewhere = await prisma.instructor.findFirst({
      where: { universityId: { not: northId } },
      select: { id: true },
    });
    expect(elsewhere, "the seed has a second university").toBeTruthy();
    const res = await manager.get(`/api/instructors/${elsewhere!.id}/activities`);
    expect([403, 404]).toContain(res.status);
  });
});
