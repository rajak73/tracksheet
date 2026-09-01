import { beforeAll, describe, expect, test } from "vitest";
import { ACCOUNTS, ApiClient } from "./helpers/client";

/**
 * Employee lifecycle: create → active → deactivate → former → reactivate.
 *
 * The requirement this exists to protect is narrow and easy to break: ending
 * someone's employment must revoke their access and NOTHING else. Every
 * assertion about historical data below is there because the obvious
 * implementation — deleting the row, or filtering history by `isActive` —
 * would pass a naive test and silently destroy a year of reporting.
 *
 * Dates are in 2035 and touched by no other file; the suite shares one seeded
 * database, so isolation comes from picking an unused window.
 */

/* A past Monday. It was 2035 — isolated by being unreachable, which worked
   while this wrote to `ActivityLog`. A day that has not happened cannot be
   written to the worklog by anybody, so isolation comes from distance now. */
const MON = "2025-04-07";
const NEW_INSTRUCTOR = "lifecycle.instructor@example.edu";
const NEW_MANAGER = "lifecycle.manager@example.edu";
const PASSWORD = "Password123!";

let admin: ApiClient;
let manager: ApiClient;
let instructor: ApiClient;
let universityId: string;
let westUniversityId: string;

let createdUserId: string;
let createdInstructorId: string;

beforeAll(async () => {
  admin = new ApiClient("admin");
  manager = new ApiClient("managerNorth");
  instructor = new ApiClient("north1");
  await admin.login(ACCOUNTS.admin);
  const m = await manager.login(ACCOUNTS.managerNorth);
  await instructor.login(ACCOUNTS.instructorNorth1);
  universityId = m.user.universityId!;

  const west = new ApiClient("west");
  const w = await west.login(ACCOUNTS.managerWest);
  westUniversityId = w.user.universityId!;
});

describe("admin creates staff", () => {
  test("admin creates an instructor", async () => {
    const res = await admin.post("/api/instructors", {
      email: NEW_INSTRUCTOR,
      name: "Lifecycle Instructor",
      password: PASSWORD,
      employeeCode: "NF-LIFE-1",
      universityId,
    });
    expect(res.status).toBe(201);
    createdInstructorId = res.body.instructor.id;
    createdUserId = res.body.instructor.user.id;
  });

  test("admin creates a manager", async () => {
    const res = await admin.post(`/api/universities/${universityId}/managers`, {
      email: NEW_MANAGER,
      name: "Lifecycle Manager",
      password: PASSWORD,
      employeeCode: "NF-MGR-LIFE",
    });
    expect(res.status).toBe(201);
  });

  test("the plaintext password is never returned", async () => {
    const res = await admin.get(`/api/staff?status=all&search=Lifecycle`);
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(PASSWORD);
    expect(body.toLowerCase()).not.toContain("passwordhash");
    expect(body).not.toContain("scrypt$");
  });

  test("an instructor cannot create staff", async () => {
    const res = await instructor.post("/api/instructors", {
      email: "nope@example.edu",
      name: "Nope",
      password: PASSWORD,
      universityId,
    });
    expect(res.status).toBe(403);
  });

  test("a manager cannot create staff in another university", async () => {
    const res = await manager.post("/api/instructors", {
      email: "cross@example.edu",
      name: "Cross Tenant",
      password: PASSWORD,
      universityId: westUniversityId,
    });
    expect(res.status).toBe(403);
  });

  test("a duplicate email is refused rather than creating a second account", async () => {
    const res = await admin.post("/api/instructors", {
      email: NEW_INSTRUCTOR,
      name: "Duplicate",
      password: PASSWORD,
      universityId,
    });
    expect(res.status).toBe(409);
  });
});

describe("the staff directory", () => {
  test("lists instructors and managers together", async () => {
    const res = await admin.get("/api/staff?status=all&limit=200");
    expect(res.status).toBe(200);
    const roles = new Set(res.body.staff.map((s: { role: string }) => s.role));
    expect(roles.has("INSTRUCTOR")).toBe(true);
    expect(roles.has("MANAGER")).toBe(true);
  });

  test("never includes an administrator", async () => {
    const res = await admin.get("/api/staff?status=all&limit=200");
    const roles = res.body.staff.map((s: { role: string }) => s.role);
    expect(roles).not.toContain("ADMIN");
  });

  test("status filter is validated", async () => {
    expect((await admin.get("/api/staff?status=banana")).status).toBe(400);
    expect((await admin.get("/api/staff?role=WIZARD")).status).toBe(400);
  });

  test("search matches name, email and employee code", async () => {
    const byCode = await admin.get("/api/staff?status=all&search=NF-LIFE-1");
    expect(byCode.body.staff.length).toBeGreaterThan(0);
    const byEmail = await admin.get(`/api/staff?status=all&search=${NEW_INSTRUCTOR}`);
    expect(byEmail.body.staff.length).toBeGreaterThan(0);
  });

  test("a manager sees only their own university", async () => {
    const res = await manager.get("/api/staff?status=all&limit=200");
    expect(res.status).toBe(200);
    for (const s of res.body.staff) {
      expect(s.universityId).toBe(universityId);
    }
  });

  test("a manager cannot request another university", async () => {
    const res = await manager.get(`/api/staff?universityId=${westUniversityId}`);
    expect(res.status).toBe(403);
  });

  test("an instructor cannot read the staff directory", async () => {
    expect((await instructor.get("/api/staff")).status).toBe(403);
  });

  test("an unauthenticated caller is refused", async () => {
    const anon = new ApiClient("anon-staff");
    expect((await anon.get("/api/staff")).status).toBe(401);
  });
});

describe("deactivation preserves history and revokes access", () => {
  beforeAll(async () => {
    // Give the new instructor real history to protect.
    const them = new ApiClient("lifecycle");
    await them.login(NEW_INSTRUCTOR, PASSWORD);
    /* Written through the worklog route, which is what the tracker and its CSV
       read. The activity post this replaced went to a table neither looks at,
       so "hours unchanged" would have compared zero to zero. */
    const act = await them.post(`/api/instructors/${createdInstructorId}/worklog/entry`, {
      date: MON,
      deliverable: "Four hours of teaching",
      workingHours: "4h",
    });
    expect(act.status, JSON.stringify(act.body)).toBe(201);

    const deliverable = await admin.post(`/api/instructors/${createdInstructorId}/deliverables`, {
      title: "Lifecycle Deliverable",
      category: "Content",
      targetQuantity: 2,
      targetHours: 3,
      dueDate: MON,
    });
    expect(deliverable.status).toBe(201);
    const log = await them.post(
      `/api/instructors/${createdInstructorId}/deliverables/${deliverable.body.deliverable.id}/logs`,
      { workDate: MON, quantityCompleted: 2, hoursSpent: 3, remarks: "Before leaving" },
    );
    expect(log.status).toBe(201);
  });

  test("only an admin may deactivate", async () => {
    expect(
      (await manager.patch(`/api/staff/${createdUserId}`, { isActive: false })).status,
    ).toBe(403);
    expect(
      (await instructor.patch(`/api/staff/${createdUserId}`, { isActive: false })).status,
    ).toBe(403);
  });

  test("an administrator account cannot be deactivated through this route", async () => {
    const me = await admin.get("/api/auth/me");
    const res = await admin.patch(`/api/staff/${me.body.user.id}`, { isActive: false });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("NOT_STAFF");
  });

  test("admin deactivates the employee", async () => {
    const res = await admin.patch(`/api/staff/${createdUserId}`, {
      isActive: false,
      reason: "Left the organisation",
    });
    expect(res.status).toBe(200);
    expect(res.body.staff.isActive).toBe(false);
  });

  test("the deactivated employee can no longer log in", async () => {
    const them = new ApiClient("gone");
    const res = await them.post("/api/auth/login", {
      email: NEW_INSTRUCTOR,
      password: PASSWORD,
    });
    expect(res.status).toBe(401);
  });

  test("historical worklog survives", async () => {
    /* The claim is unchanged — a departed person's record stays readable — and
       only where it is read from moved. The explorer answers days now, so
       `activities` is `days` and the count is of instructor-days. */
    const res = await admin.get(
      `/api/activities?instructorId=${createdInstructorId}&from=${MON}&to=${MON}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.days.length).toBeGreaterThan(0);
  });

  test("historical deliverable logs survive", async () => {
    const res = await admin.get(`/api/instructors/${createdInstructorId}/deliverables`);
    expect(res.status).toBe(200);
    const mine = res.body.deliverables.find(
      (d: { title: string }) => d.title === "Lifecycle Deliverable",
    );
    expect(mine).toBeDefined();
    expect(mine.logs.length).toBeGreaterThan(0);
  });

  test("the tracker still shows them, with hours unchanged and marked former", async () => {
    const res = await admin.get(
      `/api/universities/${universityId}/tracker?from=${MON}&to=${MON}`,
    );
    const row = res.body.tracker.rows.find(
      (r: { instructorId: string }) => r.instructorId === createdInstructorId,
    );
    expect(row).toBeDefined();
    expect(row.isActive).toBe(false);
    expect(row.totals.totalWorkingHours).toBe(4);
    /* One instructor-day, and the row says so. `deliverableHours` — hours on
       entries that named a deliverable — went with the taxonomy. */
    expect(row.totals.daysLogged).toBe(1);
    expect(row.employeeCode).toBe("NF-LIFE-1");
  });

  test("they are excluded from analytics for a period AFTER they left", async () => {
    /* The engine's rule, stated precisely: somebody who left in September did
       real work in August, so August includes them and September does not. It
       is a DATE test, not an isActive test.
       
       The old version of this asserted plain exclusion and passed only because
       its window sat in 2035 — after a deactivation that happens today. Moving
       the fixture into the past made the engine correctly INCLUDE them, and the
       assertion failed while the rule it meant to check still held. So the
       window is now explicitly after the departure, and says why. */
    const afterTheyLeft = new Date();
    afterTheyLeft.setUTCDate(afterTheyLeft.getUTCDate() + 30);
    const after = afterTheyLeft.toISOString().slice(0, 10);

    const res = await admin.get(
      `/api/universities/${universityId}/analytics?from=${after}&to=${after}`,
    );
    const present = res.body.analytics.instructors.some(
      (i: { instructorId: string }) => i.instructorId === createdInstructorId,
    );
    expect(present, "a departed person carries no capacity into later periods").toBe(false);
  });

  test("and INCLUDED for a period they actually worked", async () => {
    /* The other half, which the old test never had. Dropping them from a window
       they worked would rewrite history — and the rollup upserts, so it would
       rewrite the stored figures too. */
    const res = await admin.get(
      `/api/universities/${universityId}/analytics?from=${MON}&to=${MON}`,
    );
    const present = res.body.analytics.instructors.some(
      (i: { instructorId: string }) => i.instructorId === createdInstructorId,
    );
    expect(present, "a period they worked must still show them").toBe(true);
  });

  test("they appear under the 'former' filter, not the default 'active' one", async () => {
    const active = await admin.get(`/api/staff?search=${NEW_INSTRUCTOR}`);
    expect(active.body.staff).toHaveLength(0);
    const former = await admin.get(`/api/staff?status=former&search=${NEW_INSTRUCTOR}`);
    expect(former.body.staff).toHaveLength(1);
    expect(former.body.staff[0].isActive).toBe(false);
  });

  test("the CSV export marks them Former and carries no credential", async () => {
    const res = await admin.get(
      `/api/universities/${universityId}/tracker?from=${MON}&to=${MON}&export=csv`,
    );
    expect(res.status).toBe(200);
    const csv = String(res.body);
    expect(csv).toContain("Lifecycle Instructor");
    expect(csv).toContain("Former");
    expect(csv).not.toContain(PASSWORD);
    expect(csv).not.toContain("scrypt$");
  });

  test("the audit log records the change without any credential", async () => {
    const res = await admin.get(
      `/api/universities/${universityId}/audit?action=STAFF_DEACTIVATED&limit=50`,
    );
    expect(res.status).toBe(200);
    const entry = res.body.entries.find(
      (e: { entityId: string }) => e.entityId === createdUserId,
    );
    expect(entry).toBeDefined();
    const serialised = JSON.stringify(entry);
    expect(serialised).not.toContain(PASSWORD);
    expect(serialised.toLowerCase()).not.toContain("passwordhash");
    expect(serialised).not.toContain("scrypt$");
  });
});

describe("reactivation", () => {
  test("admin reactivates the employee", async () => {
    const res = await admin.patch(`/api/staff/${createdUserId}`, { isActive: true });
    expect(res.status).toBe(200);
    expect(res.body.staff.isActive).toBe(true);
  });

  test("the reactivated employee can log in again", async () => {
    const them = new ApiClient("back");
    const res = await them.post("/api/auth/login", {
      email: NEW_INSTRUCTOR,
      password: PASSWORD,
    });
    expect(res.status).toBe(200);
  });

  test("no duplicate account was created", async () => {
    const res = await admin.get(`/api/staff?status=all&search=${NEW_INSTRUCTOR}`);
    expect(res.body.staff).toHaveLength(1);
    expect(res.body.staff[0].userId).toBe(createdUserId);
  });

  test("historical hours are unchanged by the round trip", async () => {
    const res = await admin.get(
      `/api/universities/${universityId}/tracker?from=${MON}&to=${MON}`,
    );
    const row = res.body.tracker.rows.find(
      (r: { instructorId: string }) => r.instructorId === createdInstructorId,
    );
    expect(row.totals.totalWorkingHours).toBe(4);
    /* One instructor-day, and the row says so. `deliverableHours` — hours on
       entries that named a deliverable — went with the taxonomy. */
    expect(row.totals.daysLogged).toBe(1);
    expect(row.isActive).toBe(true);
  });

  test("repeating the same state is idempotent, not an error", async () => {
    const res = await admin.patch(`/api/staff/${createdUserId}`, { isActive: true });
    expect(res.status).toBe(200);
    expect(res.body.staff.isActive).toBe(true);
  });

  test("an unknown user is a 404", async () => {
    expect(
      (await admin.patch("/api/staff/does-not-exist", { isActive: false })).status,
    ).toBe(404);
  });

  test("a malformed body is a 400", async () => {
    expect((await admin.patch(`/api/staff/${createdUserId}`, { isActive: "yes" })).status).toBe(
      400,
    );
  });
});
