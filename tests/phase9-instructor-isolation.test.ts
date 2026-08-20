import { beforeAll, describe, expect, test } from "vitest";
import { ACCOUNTS, ApiClient } from "./helpers/client";

/**
 * Regression gate for the instructor-vs-colleague leak.
 *
 * The original bug: routes called `assertCanAccessUniversity`, which only
 * compares the tenant. An instructor's scope is `self`, so the check passed for
 * every colleague in the same university. These tests plant a record belonging
 * to one instructor and then attempt to reach it as a different instructor.
 *
 * Raw HTTP only — nothing here imports application code.
 */

let admin: ApiClient;
let managerNorth: ApiClient;
let managerWest: ApiClient;
let north1: ApiClient;
let north2: ApiClient;

let northId: string;
let westId: string;
let north1Id: string;
let north2Id: string;
let west1Id: string;

const CONFIDENTIAL = "CONFIDENTIAL-COLLEAGUE-NOTE";

beforeAll(async () => {
  admin = new ApiClient("admin");
  managerNorth = new ApiClient("mgrN");
  managerWest = new ApiClient("mgrW");
  north1 = new ApiClient("north1");
  north2 = new ApiClient("north2");

  await admin.login(ACCOUNTS.admin);
  await managerNorth.login(ACCOUNTS.managerNorth);
  await managerWest.login(ACCOUNTS.managerWest);
  const a = await north1.login(ACCOUNTS.instructorNorth1);
  const b = await north2.login(ACCOUNTS.instructorNorth2);

  north1Id = a.user.instructorId!;
  north2Id = b.user.instructorId!;
  northId = a.user.universityId!;

  const unis = await admin.get("/api/universities");
  westId = unis.body.universities.find((u: { slug: string }) => u.slug === "westbrook").id;
  const west = await admin.get(`/api/instructors?universityId=${westId}`);
  west1Id = west.body.instructors[0].id;

  /* Plant a distinctive activity log and deliverable owned by north2.
   *
   * The statuses are ASSERTED, which they were not before. Everything below
   * this line checks that a colleague cannot see these two records — so if a
   * plant silently fails, every one of those tests passes while proving
   * nothing: there is no secret in the database to leak. A vacuous security
   * test is worse than a failing one, because it reports safety it never
   * established.
   *
   * They are planted by the ADMIN rather than by north2's manager. A manager
   * may only act on their own roster — correctly — so planting as the manager
   * made this fixture depend on who north2 reported to at the moment the file
   * ran, and other files move instructors between rosters as part of what they
   * test. The admin can always act, so the fixture no longer has an opinion
   * about roster state. What is under test here is who can READ these rows,
   * not who created them. */
  const plantedLog = await admin.post(`/api/instructors/${north2Id}/activities`, {
    activityTypeCode: "TEACHING",
    startTime: "2026-09-02T10:00:00Z",
    endTime: "2026-09-02T11:00:00Z",
    remarks: CONFIDENTIAL,
  });
  expect(plantedLog.status, `planting the activity log failed: ${JSON.stringify(plantedLog.body)}`).toBe(201);

  const plantedDeliverable = await admin.post(`/api/instructors/${north2Id}/deliverables`, {
    title: "COLLEAGUE-PRIVATE-DELIVERABLE",
    targetQuantity: 10,
    targetHours: 12,
    dueDate: "2026-12-01",
  });
  expect(plantedDeliverable.status, `planting the deliverable failed: ${JSON.stringify(plantedDeliverable.body)}`).toBe(201);
});

describe("activity logs are not visible to a colleague", () => {
  test("the university-wide endpoint returns only the caller's own rows", async () => {
    const res = await north1.get(`/api/universities/${northId}/activities`);
    expect(res.status).toBe(200);

    const foreign = res.body.activities.filter(
      (a: { instructor: { id: string } }) => a.instructor.id !== north1Id,
    );
    expect(foreign).toHaveLength(0);

    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toContain(CONFIDENTIAL);
    expect(serialised).not.toContain(ACCOUNTS.instructorNorth2);
  });

  test("the colleague themselves can still see their own row", async () => {
    const res = await north2.get(`/api/universities/${northId}/activities`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain(CONFIDENTIAL);
  });

  test("a manager sees the rows of an instructor on their own roster", async () => {
    /* This used to be called "a manager sees every instructor in their
     * university", and that is no longer the rule. `/api/activities` narrowed a
     * manager to their roster while this endpoint returned the whole tenant, so
     * the same manager asking the same question about the same table got two
     * answers depending on the URL. Both narrow now.
     *
     * The premise is asserted rather than assumed: this passes only because
     * north2 is on THIS manager's roster, and other files move the seeded
     * instructors around. Without the check, a drifted roster would look like a
     * broken endpoint. */
    const roster = await managerNorth.get("/api/instructors?limit=200");
    expect(
      roster.body.instructors.map((i: { id: string }) => i.id),
      "north2 is expected to be on the seeded North manager's roster",
    ).toContain(north2Id);

    const res = await managerNorth.get(`/api/universities/${northId}/activities`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain(CONFIDENTIAL);
  });

  test("a manager from another university is refused", async () => {
    const res = await managerWest.get(`/api/universities/${northId}/activities`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("CROSS_TENANT_DENIED");
  });

  test("the per-instructor endpoint refuses a colleague", async () => {
    const res = await north1.get(`/api/instructors/${north2Id}/activities`);
    expect(res.status).toBe(404);
  });
});

describe("deliverables are not visible to a colleague", () => {
  test("an instructor cannot read a colleague's deliverables", async () => {
    const res = await north1.get(`/api/instructors/${north2Id}/deliverables`);
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain("COLLEAGUE-PRIVATE-DELIVERABLE");
  });

  test("an instructor can read their own deliverables", async () => {
    const res = await north2.get(`/api/instructors/${north2Id}/deliverables`);
    expect(res.status).toBe(200);
    /* Presence, not position. This asserted on `deliverables[0]` and broke the
     * moment another test file gave this instructor a deliverable of its own —
     * the suite shares one database, so index 0 belongs to whichever file ran
     * last, not to this one. The claim in the test's name is that the
     * instructor can READ their own deliverable, which is what is checked. */
    const titles = res.body.deliverables.map((d: { title: string }) => d.title);
    expect(titles).toContain("COLLEAGUE-PRIVATE-DELIVERABLE");
  });

  test("an instructor cannot create a deliverable on a colleague", async () => {
    const res = await north1.post(`/api/instructors/${north2Id}/deliverables`, {
      title: "FORGED-BY-COLLEAGUE",
      targetQuantity: 1,
      targetHours: 1,
      dueDate: "2026-12-02",
    });
    expect(res.status).toBe(403);

    // …and nothing was written.
    const check = await north2.get(`/api/instructors/${north2Id}/deliverables`);
    expect(JSON.stringify(check.body)).not.toContain("FORGED-BY-COLLEAGUE");
  });

  test("an instructor cannot assign work even to themselves", async () => {
    const res = await north1.post(`/api/instructors/${north1Id}/deliverables`, {
      title: "SELF-ASSIGNED",
      targetQuantity: 1,
      targetHours: 1,
      dueDate: "2026-12-03",
    });
    expect(res.status).toBe(403);
  });

  test("a manager from another university cannot read or write", async () => {
    expect((await managerWest.get(`/api/instructors/${north2Id}/deliverables`)).status).toBe(404);
    expect(
      (
        await managerWest.post(`/api/instructors/${north2Id}/deliverables`, {
          title: "CROSS-TENANT",
          targetQuantity: 1,
          targetHours: 1,
          dueDate: "2026-12-04",
        })
      ).status,
    ).toBe(404);
  });

  test("an admin can read across universities", async () => {
    expect((await admin.get(`/api/instructors/${north2Id}/deliverables`)).status).toBe(200);
    expect((await admin.get(`/api/instructors/${west1Id}/deliverables`)).status).toBe(200);
  });
});

describe("insights are a management artifact, not a self-service one", () => {
  // PATCH /api/insights/[id] previously had no role gate — an instructor's
  // `self` scope passed the tenant-only `assertCanAccessUniversity` check
  // used inside it, so they could mutate (and read back) a university-scoped
  // insight belonging to their own tenant. The role gate now rejects the
  // role BEFORE the handler runs, so this holds even against a made-up id —
  // the fix does not depend on a real insight existing to be provable.
  test("an instructor is refused before the handler ever looks up the id", async () => {
    const res = await north1.patch("/api/insights/does-not-exist", { status: "DISMISSED" });
    expect(res.status).toBe(403);
  });

  test("a manager can reach the same route", async () => {
    // Still refused, but for a DIFFERENT reason: the id itself is unknown.
    // A manager passing the role gate and landing on 404 (not 403) proves the
    // gate is role-based, not a blanket lockout.
    const res = await managerNorth.patch("/api/insights/does-not-exist", { status: "DISMISSED" });
    expect(res.status).toBe(404);
  });

  test("an admin can reach the same route", async () => {
    const res = await admin.patch("/api/insights/does-not-exist", { status: "DISMISSED" });
    expect(res.status).toBe(404);
  });
});
