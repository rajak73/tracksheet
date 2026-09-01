import { beforeAll, describe, expect, test } from "vitest";
import { ACCOUNTS, ApiClient } from "./helpers/client";

/**
 * The Manager Portal's boundary.
 *
 * A manager's whole workspace is one roster, and every one of these tests
 * exists because the alternative — a manager reaching a colleague's people —
 * would be invisible in the UI and obvious only here. Nothing below trusts a
 * client-supplied `managerId`: the scope comes from the session, and the tests
 * try to widen it on purpose.
 *
 * The other half is that "remove" must never mean "delete". Removing an
 * instructor from a roster clears one column; their account, their activity and
 * their history all have to survive it.
 */

let admin: ApiClient, mgrA: ApiClient, mgrB: ApiClient, instructor: ApiClient, anon: ApiClient;
let northId: string, westId: string;
let managerAId: string, managerBId: string;
/** Two Northfield instructors on manager A's roster, plus one on B's. */
let a1: string, a2: string, b1: string;

async function rosterOf(client: ApiClient): Promise<string[]> {
  const res = await client.get("/api/instructors?limit=200");
  expect(res.status).toBe(200);
  return res.body.instructors.map((i: { id: string }) => i.id);
}

beforeAll(async () => {
  admin = new ApiClient("admin");
  await admin.login(ACCOUNTS.admin);

  mgrA = new ApiClient("manager-a");
  northId = (await mgrA.login(ACCOUNTS.managerNorth)).user.universityId!;
  managerAId = (await mgrA.get("/api/auth/me")).body.user.managerId;

  mgrB = new ApiClient("manager-b");
  westId = (await mgrB.login(ACCOUNTS.managerWest)).user.universityId!;
  managerBId = (await mgrB.get("/api/auth/me")).body.user.managerId;

  instructor = new ApiClient("instructor");
  await instructor.login(ACCOUNTS.instructorNorth1);

  anon = new ApiClient("anonymous");

  expect(managerAId).toBeTruthy();
  expect(managerBId).toBeTruthy();
  expect(northId).not.toBe(westId);

  const north = await admin.get(`/api/instructors?universityId=${northId}&limit=200`);
  const west = await admin.get(`/api/instructors?universityId=${westId}&limit=200`);
  [a1, a2] = north.body.instructors.map((i: { id: string }) => i.id);
  b1 = west.body.instructors[0].id;

  // The seed places each university's instructors on that university's manager,
  // which is the arrangement these tests assume.
  for (const id of [a1, a2]) {
    await admin.patch(`/api/instructors/${id}/manager`, { managerId: managerAId });
  }
  await admin.patch(`/api/instructors/${b1}/manager`, { managerId: managerBId });
});

describe("a manager sees exactly their own roster", () => {
  test("the instructor list is scoped without asking for it", async () => {
    const mine = await rosterOf(mgrA);
    expect(mine).toContain(a1);
    expect(mine).toContain(a2);
    expect(mine).not.toContain(b1);
  });

  test("another manager's roster is a different set", async () => {
    const theirs = await rosterOf(mgrB);
    expect(theirs).toContain(b1);
    expect(theirs).not.toContain(a1);
    expect(theirs).not.toContain(a2);
  });

  test("an unassigned instructor belongs to no roster", async () => {
    await admin.patch(`/api/instructors/${a2}/manager`, { managerId: null });
    const mine = await rosterOf(mgrA);
    expect(mine).not.toContain(a2);

    // …and the admin still sees them, as unassigned.
    const seen = await admin.get(`/api/instructors?universityId=${northId}&managerId=unassigned&limit=200`);
    expect(seen.body.instructors.map((i: { id: string }) => i.id)).toContain(a2);

    await admin.patch(`/api/instructors/${a2}/manager`, { managerId: managerAId });
  });

  test("a manager cannot widen to another manager's roster", async () => {
    const res = await mgrA.get(`/api/instructors?managerId=${managerBId}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("CROSS_MANAGER_DENIED");
  });

  test("the tracker is roster-scoped too", async () => {
    const res = await mgrA.get(`/api/universities/${northId}/tracker`);
    expect(res.status).toBe(200);
    const ids = res.body.tracker.rows.map((r: { instructorId: string }) => r.instructorId);
    expect(ids).not.toContain(b1);
  });

  test("a manager cannot read another manager's tracker", async () => {
    const res = await mgrA.get(`/api/universities/${northId}/tracker?managerId=${managerBId}`);
    expect(res.status).toBe(403);
  });

  test("a manager cannot reach another university at all", async () => {
    const res = await mgrA.get(`/api/universities/${westId}/tracker`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("CROSS_TENANT_DENIED");
  });
});

describe("activity is roster-scoped", () => {
  test("a manager sees only their own roster's activity", async () => {
    const res = await mgrA.get("/api/activities?limit=200");
    expect(res.status).toBe(200);
    const mine = await rosterOf(mgrA);
    for (const a of res.body.days) {
      expect(mine).toContain(a.instructorId);
    }
  });

  test("naming another manager is refused", async () => {
    const res = await mgrA.get(`/api/activities?managerId=${managerBId}`);
    expect(res.status).toBe(403);
  });

  test("naming another manager's instructor yields nothing, not their data", async () => {
    const res = await mgrA.get(`/api/activities?instructorId=${b1}&limit=200`);
    // Either refused outright or scoped to empty — never another roster's rows.
    if (res.status === 200) {
      expect(res.body.days).toEqual([]);
    } else {
      expect([403, 404]).toContain(res.status);
    }
  });

  test("another university's activity is refused", async () => {
    const res = await mgrA.get(`/api/activities?universityId=${westId}`);
    expect(res.status).toBe(403);
  });
});

describe("editing an instructor", () => {
  test("a manager can edit someone on their roster", async () => {
    const res = await mgrA.patch(`/api/instructors/${a1}`, { name: "Edited By Manager A" });
    expect(res.status).toBe(200);
    expect(res.body.instructor.user.name).toBe("Edited By Manager A");
  });

  test("a manager cannot edit another manager's instructor", async () => {
    const res = await mgrA.patch(`/api/instructors/${b1}`, { name: "Should Not Apply" });
    expect([403, 404]).toContain(res.status);

    const after = await admin.get(`/api/instructors?universityId=${westId}&limit=200`);
    const target = after.body.instructors.find((i: { id: string }) => i.id === b1);
    expect(target.user.name).not.toBe("Should Not Apply");
  });

  test("an instructor cannot edit anybody", async () => {
    const res = await instructor.patch(`/api/instructors/${a1}`, { name: "Nope" });
    expect(res.status).toBe(403);
  });

  test("editing cannot change tenant or roster", async () => {
    const res = await mgrA.patch(`/api/instructors/${a1}`, {
      name: "Still Mine",
      universityId: westId,
      managerId: managerBId,
    });
    expect(res.status).toBe(200);

    const mine = await rosterOf(mgrA);
    expect(mine).toContain(a1);
    const west = await admin.get(`/api/instructors?universityId=${westId}&limit=200`);
    expect(west.body.instructors.map((i: { id: string }) => i.id)).not.toContain(a1);
  });
});

describe("remove from roster is an unassignment, never a deletion", () => {
  let activityCountBefore: number;

  beforeAll(async () => {
    const acts = await admin.get(`/api/activities?instructorId=${a1}&limit=200`);
    activityCountBefore = acts.body.total;
  });

  test("a manager can remove someone from their own roster", async () => {
    const res = await mgrA.patch(`/api/instructors/${a1}/manager`, { managerId: null });
    expect(res.status).toBe(200);
    expect(res.body.instructor.managerId).toBeNull();
  });

  test("they disappear from the manager's roster", async () => {
    expect(await rosterOf(mgrA)).not.toContain(a1);
  });

  test("the instructor record still exists, and the admin sees them unassigned", async () => {
    const res = await admin.get(`/api/instructors?universityId=${northId}&limit=200`);
    const target = res.body.instructors.find((i: { id: string }) => i.id === a1);
    expect(target).toBeTruthy();
    expect(target.manager).toBeNull();
  });

  test("their activity history survives untouched", async () => {
    const acts = await admin.get(`/api/activities?instructorId=${a1}&limit=200`);
    expect(acts.body.total).toBe(activityCountBefore);
  });

  test("a manager cannot ASSIGN — only remove", async () => {
    // Put them back as the admin, then try to claim someone as the manager.
    await admin.patch(`/api/instructors/${a1}/manager`, { managerId: managerAId });

    const claim = await mgrA.patch(`/api/instructors/${a1}/manager`, { managerId: managerAId });
    expect(claim.status).toBe(403);
    expect(claim.body.error.code).toBe("ASSIGNMENT_IS_ADMIN_ONLY");
  });

  test("a manager cannot hand someone to another manager", async () => {
    const res = await mgrA.patch(`/api/instructors/${a1}/manager`, { managerId: managerBId });
    expect(res.status).toBe(403);
  });

  test("a manager cannot remove someone from another roster", async () => {
    const res = await mgrA.patch(`/api/instructors/${b1}/manager`, { managerId: null });
    expect([403, 404]).toContain(res.status);

    // B still has them.
    expect(await rosterOf(mgrB)).toContain(b1);
  });

  test("an instructor cannot remove anyone", async () => {
    const res = await instructor.patch(`/api/instructors/${a1}/manager`, { managerId: null });
    expect(res.status).toBe(403);
  });

  test("the removal was audited", async () => {
    const res = await mgrA.get(
      `/api/universities/${northId}/audit?action=INSTRUCTOR_MANAGER_UNASSIGNED`,
    );
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
  });
});

describe("a manager cannot reach admin surfaces", () => {
  test("the cross-university managers list is scoped, not global", async () => {
    const res = await mgrA.get("/api/managers");
    expect(res.status).toBe(200);
    for (const m of res.body.managers) expect(m.universityId).toBe(northId);
  });

  test("a manager cannot edit a manager profile", async () => {
    const res = await mgrA.patch(`/api/managers/${managerAId}`, { name: "Self Promote" });
    expect(res.status).toBe(403);
  });

  test("a manager cannot create a university", async () => {
    const res = await mgrA.post("/api/universities", {
      name: "Rogue University",
      slug: "rogue",
      code: "ROGUE1",
      timezone: "UTC",
      workingHours: [],
    });
    expect(res.status).toBe(403);
  });

  test("an unauthenticated caller reaches none of it", async () => {
    for (const path of ["/api/instructors", "/api/activities", "/api/managers"]) {
      expect((await anon.get(path)).status).toBe(401);
    }
  });
});

describe("roster metrics are real and roster-scoped", () => {
  test("the manager's own row reports their roster, not the university", async () => {
    const res = await mgrA.get("/api/managers?includeInstructors=true");
    expect(res.status).toBe(200);
    const me = res.body.managers.find((m: { id: string }) => m.id === managerAId);
    expect(me).toBeTruthy();

    // Like for like: `instructorCount` deliberately counts ACTIVE instructors,
    // while the roster list returns former staff too (they keep appearing so
    // their history stays reachable). Comparing the two raw numbers would fail
    // the moment any other suite deactivates somebody.
    const listed = await mgrA.get("/api/instructors?limit=200");
    const activeMine = listed.body.instructors.filter(
      (i: { user: { isActive: boolean } }) => i.user.isActive,
    );
    expect(me.instructorCount).toBe(activeMine.length);
    /* `deliverableHours` and `nonDeliverableHours` are gone. The first was
     * hours whose CATEGORY happened to be "Deliverable Work" and the second was
     * everything else — so a lecture counted as "non-deliverable", a name that
     * said the opposite of what it measured. What a roster reports now is the
     * student-facing figure and the every-recorded-minute one, each under the
     * name it actually has, and neither can be negative. */
    expect(me.workingHours).toBeGreaterThanOrEqual(0);
    expect(me.recordedHours).toBeGreaterThanOrEqual(0);
    // Working Hours is a subset of what was recorded, never more than it.
    expect(me.workingHours).toBeLessThanOrEqual(me.recordedHours);
  });

  test("the instructor rows it returns are only this manager's people", async () => {
    const res = await mgrA.get("/api/managers?includeInstructors=true");
    const mine = await rosterOf(mgrA);
    for (const i of res.body.instructors) {
      expect(mine).toContain(i.instructorId);
    }
  });
});
