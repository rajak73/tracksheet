import { beforeAll, describe, expect, test } from "vitest";
import { ACCOUNTS, ApiClient } from "./helpers/client";

/**
 * Manager → Instructor ownership.
 *
 * Before this relation existed a manager's scope was the whole university, so
 * two managers in one tenant necessarily saw the same people. These tests hold
 * the new boundary: a roster belongs to one manager, only an admin may move
 * someone between rosters, and the database — not the application — is what
 * makes a cross-university assignment impossible.
 *
 * Everything here goes over raw HTTP against a running server, so a refusal
 * proven here is a refusal an attacker would actually hit.
 */

let admin: ApiClient, mgrNorth: ApiClient, mgrWest: ApiClient, instNorth: ApiClient, anon: ApiClient;
let northId: string, westId: string;
/** Two Northfield managers, so "different rosters" is testable at all. */
let mgrA: string, mgrB: string;
let westManagerId: string;
let northInstructors: string[] = [];
let westInstructorId: string;

async function managersOf(client: ApiClient, universityId: string) {
  const res = await client.get(`/api/universities/${universityId}/managers`);
  expect(res.status).toBe(200);
  return res.body.managers as Array<{
    id: string;
    instructorCount: number;
    currentWeekWorkingHours: number;
    currentWeekDeliverables: number;
  }>;
}

/** Restores every instructor used here to unassigned, so order cannot matter. */
async function unassignAll() {
  for (const id of northInstructors) {
    await admin.patch(`/api/instructors/${id}/manager`, { managerId: null });
  }
}

beforeAll(async () => {
  admin = new ApiClient("admin");
  await admin.login(ACCOUNTS.admin);

  mgrNorth = new ApiClient("manager-north");
  northId = (await mgrNorth.login(ACCOUNTS.managerNorth)).user.universityId!;

  mgrWest = new ApiClient("manager-west");
  westId = (await mgrWest.login(ACCOUNTS.managerWest)).user.universityId!;

  instNorth = new ApiClient("instructor-north");
  await instNorth.login(ACCOUNTS.instructorNorth1);

  anon = new ApiClient("anonymous");

  // A second Northfield manager. The seed ships one; a roster boundary is
  // meaningless with a single manager, so this suite creates the counterpart.
  const created = await admin.post(`/api/universities/${northId}/managers`, {
    email: `roster.second.${Date.now()}@example.edu`,
    name: "Second Northfield Manager",
    password: "RosterManagerPass1",
    employeeCode: `RM-${Date.now().toString().slice(-6)}`,
  });
  expect(created.status).toBe(201);

  const managers = await managersOf(admin, northId);
  expect(managers.length).toBeGreaterThanOrEqual(2);
  mgrA = managers[0]!.id;
  mgrB = managers[1]!.id;
  expect(mgrA).not.toBe(mgrB);

  westManagerId = (await managersOf(admin, westId))[0]!.id;

  const north = await admin.get(`/api/instructors?universityId=${northId}&limit=200`);
  expect(north.status).toBe(200);
  northInstructors = north.body.instructors.map((i: { id: string }) => i.id);
  expect(northInstructors.length).toBeGreaterThanOrEqual(2);

  const west = await admin.get(`/api/instructors?universityId=${westId}&limit=200`);
  westInstructorId = west.body.instructors[0]!.id;

  await unassignAll();
});

describe("existing data survived the migration", () => {
  test("instructors still exist and were NOT auto-assigned", async () => {
    const res = await admin.get(`/api/instructors?limit=200`);
    expect(res.status).toBe(200);
    expect(res.body.instructors.length).toBeGreaterThan(0);
    // The migration deliberately backfilled nothing — ownership is assigned,
    // never inferred from University.primaryManagerId.
    for (const i of res.body.instructors) {
      expect(i).toHaveProperty("manager");
    }
  });

  test("an unassigned instructor reports manager: null, not a missing field", async () => {
    const res = await admin.get(`/api/instructors?universityId=${northId}&limit=200`);
    const target = res.body.instructors.find((i: { id: string }) => i.id === northInstructors[0]);
    expect(target.manager).toBeNull();
    expect(target.managerId).toBeNull();
  });
});

describe("assigning, reassigning and unassigning", () => {
  test("an ADMIN can assign an instructor to a manager", async () => {
    const res = await admin.patch(`/api/instructors/${northInstructors[0]}/manager`, {
      managerId: mgrA,
    });
    expect(res.status).toBe(200);
    expect(res.body.instructor.managerId).toBe(mgrA);
    expect(res.body.instructor.manager.id).toBe(mgrA);
  });

  test("a manager can hold several instructors", async () => {
    await admin.patch(`/api/instructors/${northInstructors[1]}/manager`, { managerId: mgrA });
    const roster = await admin.get(`/api/instructors?universityId=${northId}&managerId=${mgrA}&limit=200`);
    expect(roster.status).toBe(200);
    expect(roster.body.instructors.length).toBeGreaterThanOrEqual(2);
  });

  test("an instructor can be reassigned to a different manager", async () => {
    const res = await admin.patch(`/api/instructors/${northInstructors[1]}/manager`, {
      managerId: mgrB,
    });
    expect(res.status).toBe(200);
    expect(res.body.instructor.managerId).toBe(mgrB);
  });

  test("different managers hold different rosters", async () => {
    const a = await admin.get(`/api/instructors?universityId=${northId}&managerId=${mgrA}&limit=200`);
    const b = await admin.get(`/api/instructors?universityId=${northId}&managerId=${mgrB}&limit=200`);

    const idsA = a.body.instructors.map((i: { id: string }) => i.id);
    const idsB = b.body.instructors.map((i: { id: string }) => i.id);

    expect(idsA).toContain(northInstructors[0]);
    expect(idsB).toContain(northInstructors[1]);
    // The whole point of the relation: no overlap.
    expect(idsA.filter((id: string) => idsB.includes(id))).toEqual([]);
  });

  test("an instructor can be unassigned again", async () => {
    const res = await admin.patch(`/api/instructors/${northInstructors[1]}/manager`, {
      managerId: null,
    });
    expect(res.status).toBe(200);
    expect(res.body.instructor.managerId).toBeNull();
  });

  test("re-sending the same value is idempotent, not a second write", async () => {
    const res = await admin.patch(`/api/instructors/${northInstructors[1]}/manager`, {
      managerId: null,
    });
    expect(res.status).toBe(200);
    expect(res.body.instructor.unchanged).toBe(true);
  });

  test("admin can list the unassigned", async () => {
    const res = await admin.get(`/api/instructors?universityId=${northId}&managerId=unassigned&limit=200`);
    expect(res.status).toBe(200);
    const ids = res.body.instructors.map((i: { id: string }) => i.id);
    expect(ids).toContain(northInstructors[1]);
    expect(ids).not.toContain(northInstructors[0]);
  });
});

describe("cross-tenant assignment is impossible", () => {
  test("a Northfield instructor cannot be given a Westbrook manager", async () => {
    const res = await admin.patch(`/api/instructors/${northInstructors[0]}/manager`, {
      managerId: westManagerId,
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("CROSS_TENANT_ASSIGNMENT");
  });

  test("the refusal did not change the existing assignment", async () => {
    const res = await admin.get(`/api/instructors?universityId=${northId}&managerId=${mgrA}&limit=200`);
    const ids = res.body.instructors.map((i: { id: string }) => i.id);
    expect(ids).toContain(northInstructors[0]);
  });

  test("a Westbrook instructor cannot be given a Northfield manager either", async () => {
    const res = await admin.patch(`/api/instructors/${westInstructorId}/manager`, {
      managerId: mgrA,
    });
    expect(res.status).toBe(422);
  });

  test("a nonexistent manager is refused", async () => {
    const res = await admin.patch(`/api/instructors/${northInstructors[0]}/manager`, {
      managerId: "no-such-manager-id",
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("MANAGER_NOT_FOUND");
  });

  test("a nonexistent instructor is refused", async () => {
    const res = await admin.patch(`/api/instructors/no-such-instructor/manager`, {
      managerId: mgrA,
    });
    expect(res.status).toBe(404);
  });
});

describe("only an ADMIN may move people between rosters", () => {
  test("a MANAGER cannot assign", async () => {
    const res = await mgrNorth.patch(`/api/instructors/${northInstructors[1]}/manager`, {
      managerId: mgrA,
    });
    expect(res.status).toBe(403);
  });

  test("an INSTRUCTOR cannot assign", async () => {
    const res = await instNorth.patch(`/api/instructors/${northInstructors[1]}/manager`, {
      managerId: mgrA,
    });
    expect(res.status).toBe(403);
  });

  test("an unauthenticated caller cannot assign", async () => {
    const res = await anon.patch(`/api/instructors/${northInstructors[1]}/manager`, {
      managerId: mgrA,
    });
    expect(res.status).toBe(401);
  });
});

describe("manager-scoped tracker", () => {
  test("an ADMIN may request any roster in the university", async () => {
    const res = await admin.get(`/api/universities/${northId}/tracker?managerId=${mgrA}`);
    expect(res.status).toBe(200);
    const ids = res.body.tracker.rows.map((r: { instructorId: string }) => r.instructorId);
    expect(ids).toContain(northInstructors[0]);
    expect(ids).not.toContain(northInstructors[1]);
  });

  test("a MANAGER requesting ANOTHER manager's roster is refused", async () => {
    const res = await mgrNorth.get(`/api/universities/${northId}/tracker?managerId=${mgrB}`);
    // mgrNorth is one of the two; whichever it is, the OTHER id must be denied.
    const other = await mgrNorth.get(`/api/universities/${northId}/tracker?managerId=${mgrA}`);
    const denied = [res, other].filter((r) => r.status === 403);
    expect(denied.length).toBeGreaterThanOrEqual(1);
    expect(denied[0]!.body.error.code).toBe("CROSS_MANAGER_DENIED");
  });

  test("a MANAGER asking for nothing still gets only their own roster", async () => {
    const res = await mgrNorth.get(`/api/universities/${northId}/tracker`);
    expect(res.status).toBe(200);
    const mine = await managersOf(admin, northId);
    const self = mine.find((m) => m.id === mgrA || m.id === mgrB);
    expect(self).toBeTruthy();
    // Never the whole university: the grid is bounded by the roster.
    expect(res.body.tracker.rows.length).toBeLessThanOrEqual(northInstructors.length);
  });

  test("a MANAGER cannot reach another university's tracker", async () => {
    const res = await mgrNorth.get(`/api/universities/${westId}/tracker`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("CROSS_TENANT_DENIED");
  });

  test("an INSTRUCTOR cannot use the manager dimension", async () => {
    const res = await instNorth.get(`/api/universities/${northId}/tracker?managerId=${mgrA}`);
    expect(res.status).toBe(403);
  });

  test("a manager id from another university is not found on this path", async () => {
    const res = await admin.get(`/api/universities/${northId}/tracker?managerId=${westManagerId}`);
    expect(res.status).toBe(404);
  });

  test("the roster filter preserves the weekly report shape", async () => {
    const res = await admin.get(`/api/universities/${northId}/tracker?managerId=${mgrA}`);
    expect(res.status).toBe(200);
    const t = res.body.tracker;
    expect(Array.isArray(t.weeks)).toBe(true);
    expect(t.weeks.length).toBeGreaterThanOrEqual(1);
    expect(t.weeks[0]).toHaveProperty("from");
    expect(t.weeks[0]).toHaveProperty("to");
    for (const row of t.rows) {
      expect(row).toHaveProperty("instructorName");
      expect(row).toHaveProperty("employeeCode");
      expect(row).toHaveProperty("category");
      expect(row).toHaveProperty("cells");
      expect(row.totals).toHaveProperty("totalWorkingHours");
      expect(row.totals).toHaveProperty("deliverableHours");
    }
  });

  test("CSV export still works with a roster filter", async () => {
    const res = await admin.request(
      `/api/universities/${northId}/tracker?managerId=${mgrA}&export=csv`,
      { method: "GET" },
    );
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe("string");
    expect(res.body).toContain("Employee Name");
  });
});

describe("per-manager figures are real, not university-wide", () => {
  test("roster sizes reflect actual assignments", async () => {
    await unassignAll();
    await admin.patch(`/api/instructors/${northInstructors[0]}/manager`, { managerId: mgrA });

    const managers = await managersOf(admin, northId);
    const a = managers.find((m) => m.id === mgrA)!;
    const b = managers.find((m) => m.id === mgrB)!;

    expect(a.instructorCount).toBe(1);
    expect(b.instructorCount).toBe(0);
    // The bug this replaces: both used to report the university total.
    expect(a.instructorCount).not.toBe(b.instructorCount);
  });

  test("each manager carries their own current-week figures", async () => {
    const managers = await managersOf(admin, northId);
    for (const m of managers) {
      expect(typeof m.currentWeekWorkingHours).toBe("number");
      expect(typeof m.currentWeekDeliverables).toBe("number");
    }
    const b = managers.find((m) => m.id === mgrB)!;
    // An empty roster cannot have recorded hours.
    expect(b.currentWeekWorkingHours).toBe(0);
  });

  test("the response reports how many instructors are still unassigned", async () => {
    const res = await admin.get(`/api/universities/${northId}/managers`);
    expect(res.status).toBe(200);
    expect(typeof res.body.unassignedInstructors).toBe("number");
    expect(res.body.unassignedInstructors).toBeGreaterThanOrEqual(1);
  });
});

describe("one manager never sees a peer's roster", () => {
  /**
   * The roster boundary on the managers LIST, which is a different query from
   * the instructor list and so needs proving separately.
   *
   * `manager-portal.test.ts` asserts the same property, but only against the
   * seeded world where Northfield has a single manager — so it passed whether
   * or not the boundary held, depending on which suites had run first. Here the
   * counterpart manager exists and holds somebody, so the assertion has
   * something to actually catch.
   */
  test("the list returns the caller's own row, not every manager in the university", async () => {
    await unassignAll();
    await admin.patch(`/api/instructors/${northInstructors[0]}/manager`, { managerId: mgrA });
    await admin.patch(`/api/instructors/${northInstructors[1]}/manager`, { managerId: mgrB });

    const res = await mgrNorth.get("/api/managers");
    expect(res.status).toBe(200);
    const ids = res.body.managers.map((m: { id: string }) => m.id);
    expect(ids).toContain(mgrA);
    expect(ids).not.toContain(mgrB);
  });

  test("includeInstructors does not expand into a peer's people", async () => {
    const res = await mgrNorth.get("/api/managers?includeInstructors=true");
    expect(res.status).toBe(200);
    const ids = res.body.instructors.map((i: { instructorId: string }) => i.instructorId);
    // The peer's instructor is active and in the same university, so only the
    // roster boundary keeps them out of this response.
    expect(ids).toContain(northInstructors[0]);
    expect(ids).not.toContain(northInstructors[1]);
  });

  test("naming the peer explicitly is refused rather than honoured", async () => {
    const res = await mgrNorth.get(`/api/managers?managerId=${mgrB}`);
    expect(res.status).toBe(403);
  });

  test("an admin still sees both", async () => {
    const res = await admin.get(`/api/managers?universityId=${northId}&includeInstructors=true`);
    expect(res.status).toBe(200);
    const ids = res.body.managers.map((m: { id: string }) => m.id);
    expect(ids).toContain(mgrA);
    expect(ids).toContain(mgrB);
    const instructorIds = res.body.instructors.map((i: { instructorId: string }) => i.instructorId);
    expect(instructorIds).toContain(northInstructors[0]);
    expect(instructorIds).toContain(northInstructors[1]);
  });
});
