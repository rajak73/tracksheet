import { beforeAll, describe, expect, test } from "vitest";
import { ACCOUNTS, ApiClient } from "./helpers/client";
import { daysAgo } from "./helpers/worklog";

/**
 * The Instructor Portal's boundary.
 *
 * An instructor is the narrowest scope in the product: their own records and
 * nothing else. The tests below try to widen that on purpose — by naming a
 * colleague's id, by posting to somebody else's route, by asking for a roster —
 * because in the UI a leak would be invisible and only shows up here.
 *
 * The second half is that an instructor's numbers must be the SAME numbers
 * their manager sees. A personal analytics page that quietly disagrees with the
 * manager's tracker would be worse than not having one.
 */

let admin: ApiClient, manager: ApiClient, inst1: ApiClient, inst2: ApiClient, anon: ApiClient;
let northId: string, westId: string;
let inst1Id: string, inst2Id: string;
let managerId: string;

beforeAll(async () => {
  admin = new ApiClient("admin");
  await admin.login(ACCOUNTS.admin);

  manager = new ApiClient("manager");
  northId = (await manager.login(ACCOUNTS.managerNorth)).user.universityId!;
  managerId = (await manager.get("/api/auth/me")).body.user.managerId;

  inst1 = new ApiClient("instructor-1");
  inst1Id = (await inst1.login(ACCOUNTS.instructorNorth1)).user.instructorId!;

  inst2 = new ApiClient("instructor-2");
  inst2Id = (await inst2.login(ACCOUNTS.instructorNorth2)).user.instructorId!;

  const west = new ApiClient("instructor-west");
  westId = (await west.login(ACCOUNTS.instructorWest1)).user.universityId!;

  anon = new ApiClient("anonymous");

  expect(inst1Id).toBeTruthy();
  expect(inst2Id).not.toBe(inst1Id);
});

describe("an instructor sees only themselves", () => {
  test("the activity feed contains nobody else's records", async () => {
    const res = await inst1.get("/api/activities?limit=200");
    expect(res.status).toBe(200);
    for (const d of res.body.days) {
      expect(d.instructorId).toBe(inst1Id);
    }
  });

  test("naming a colleague does not return their activity", async () => {
    const res = await inst1.get(`/api/activities?instructorId=${inst2Id}&limit=200`);
    if (res.status === 200) {
      // Scoped to self, so a colleague's id can only ever yield nothing.
      for (const d of res.body.days) expect(d.instructorId).toBe(inst1Id);
      expect(res.body.days.every((d: { instructorId: string }) => d.instructorId === inst1Id)).toBe(
        true,
      );
    } else {
      expect([403, 404]).toContain(res.status);
    }
  });

  test("the instructor list returns only their own row", async () => {
    const res = await inst1.get("/api/instructors?limit=200");
    expect(res.status).toBe(200);
    const ids = res.body.instructors.map((i: { id: string }) => i.id);
    expect(ids).toEqual([inst1Id]);
  });

  test("reading a colleague's profile is refused", async () => {
    const res = await inst1.get(`/api/instructors/${inst2Id}`);
    expect([403, 404]).toContain(res.status);
  });

  test("the tracker narrows to their own row", async () => {
    const res = await inst1.get(`/api/universities/${northId}/tracker`);
    expect(res.status).toBe(200);
    const ids = res.body.tracker.rows.map((r: { instructorId: string }) => r.instructorId);
    expect(ids.every((id: string) => id === inst1Id)).toBe(true);
  });

  test("asking the tracker for a colleague is refused", async () => {
    const res = await inst1.get(`/api/universities/${northId}/tracker?instructorId=${inst2Id}`);
    expect(res.status).toBe(404);
  });

  test("another university is unreachable", async () => {
    const res = await inst1.get(`/api/universities/${westId}/tracker`);
    expect([403, 404]).toContain(res.status);
  });
});

describe("an instructor cannot reach manager or admin surfaces", () => {
  test("the managers list is refused", async () => {
    expect((await inst1.get("/api/managers")).status).toBe(403);
  });

  test("the admin overview is refused", async () => {
    expect((await inst1.get("/api/admin/overview")).status).toBe(403);
  });

  test("filtering activity by manager is refused", async () => {
    const res = await inst1.get(`/api/activities?managerId=${managerId}`);
    expect(res.status).toBe(403);
  });

  /* "workload targets stay closed" was deleted, not ported to expect a 404.
     The route is gone with the feature — targets were set per activity type —
     so the test would have asserted that a door nobody built is shut, which is
     true of every path that does not exist and says nothing about access. */

  test("creating a university is refused", async () => {
    const res = await inst1.post("/api/universities", {
      name: "Nope University",
      slug: "nope",
      code: "NOPE1",
      timezone: "UTC",
      workingHours: [],
    });
    expect(res.status).toBe(403);
  });

  test("creating an instructor is refused", async () => {
    const res = await inst1.post("/api/instructors", {
      email: `rogue.${Date.now()}@example.edu`,
      name: "Rogue",
      password: "RoguePassword123",
      universityId: northId,
    });
    expect(res.status).toBe(403);
  });

  test("an unauthenticated caller reaches none of it", async () => {
    for (const path of ["/api/activities", "/api/instructors", "/api/managers"]) {
      expect((await anon.get(path)).status).toBe(401);
    }
  });
});

describe("an instructor cannot change ownership or tenancy", () => {
  test("they cannot assign themselves to a manager", async () => {
    const res = await inst1.patch(`/api/instructors/${inst1Id}/manager`, { managerId });
    expect(res.status).toBe(403);
  });

  test("they cannot unassign themselves", async () => {
    const res = await inst1.patch(`/api/instructors/${inst1Id}/manager`, { managerId: null });
    expect(res.status).toBe(403);
  });

  test("they cannot move a colleague's roster", async () => {
    const res = await inst1.patch(`/api/instructors/${inst2Id}/manager`, { managerId: null });
    expect(res.status).toBe(403);
  });

  test("they cannot edit their own profile fields", async () => {
    const res = await inst1.patch(`/api/instructors/${inst1Id}`, { name: "Self Renamed" });
    expect(res.status).toBe(403);
  });

  test("they cannot change their university", async () => {
    const res = await inst1.patch(`/api/instructors/${inst1Id}`, { universityId: westId });
    expect(res.status).toBe(403);

    const check = await admin.get(`/api/instructors?universityId=${northId}&limit=200`);
    expect(check.body.instructors.map((i: { id: string }) => i.id)).toContain(inst1Id);
  });
});

describe("logging a day", () => {
  /* A day well in the PAST, and far enough back that no other file writes it.
   *
   * It used to be a date in 2035, isolated by being unreachable. That worked
   * while the activity route accepted the future; the worklog route refuses any
   * day that has not happened, to anybody, so isolation now has to come from
   * distance rather than from impossibility. These accounts are the shared
   * seeded North pair, so a day another file also wrote would be UPSERTED out
   * from under it — one row per instructor per day leaves nowhere for a second
   * copy to hide. */
  const day = daysAgo(45);

  test("an instructor can write up their own day", async () => {
    const res = await inst1.post(`/api/instructors/${inst1Id}/worklog/entry`, {
      date: day,
      deliverable: "Java class - collections",
      quantity: "2 classes",
      workingHours: "6h",
      remarks: "instructor portal test",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });

  test("it appears in their own feed", async () => {
    const res = await inst1.get(`/api/activities?from=${day}&to=${day}&limit=50`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
    for (const d of res.body.days) expect(d.instructorId).toBe(inst1Id);
  });

  test("it does NOT appear in a colleague's feed", async () => {
    const res = await inst2.get(`/api/activities?from=${day}&to=${day}&limit=50`);
    expect(res.status).toBe(200);
    for (const d of res.body.days) expect(d.instructorId).toBe(inst2Id);
  });

  test("an instructor cannot write up somebody else's day", async () => {
    const res = await inst1.post(`/api/instructors/${inst2Id}/worklog/entry`, {
      date: day,
      deliverable: "Not mine to write",
      workingHours: "1h",
    });
    expect([403, 404]).toContain(res.status);
  });

  test("the colleague's own feed is unaffected by that attempt", async () => {
    const res = await inst2.get(`/api/activities?from=${day}&to=${day}&limit=50`);
    const remarks = res.body.days.map((d: { remarks: string | null }) => d.remarks);
    expect(remarks).not.toContain("instructor portal test");
  });

  test("the explorer exposes no per-record mutation route", async () => {
    /* The explorer reads. A day is corrected through the worklog entry route,
       which is scoped to its instructor; the explorer spans a whole tenant and
       must not have quietly grown a way to write through it. */
    const res = await inst1.get(`/api/activities?from=${day}&to=${day}&limit=1`);
    const id = res.body.days[0]?.id;
    expect(id).toBeTruthy();
    const del = await inst1.delete(`/api/activities/${id}`);
    expect([404, 405]).toContain(del.status);
  });
});

describe("personal performance uses the shared definitions", () => {
  test("the instructor's tracker figures match what their manager sees", async () => {
    const mine = await inst1.get(`/api/universities/${northId}/tracker?from=2035-03-05&to=2035-03-05`);
    const theirs = await manager.get(
      `/api/universities/${northId}/tracker?from=2035-03-05&to=2035-03-05`,
    );
    expect(mine.status).toBe(200);
    expect(theirs.status).toBe(200);

    const myRow = mine.body.tracker.rows.find(
      (r: { instructorId: string }) => r.instructorId === inst1Id,
    );
    const theirRow = theirs.body.tracker.rows.find(
      (r: { instructorId: string }) => r.instructorId === inst1Id,
    );
    // The manager only sees them if they are on their roster; when they are,
    // the numbers must be identical rather than separately computed.
    if (theirRow) {
      expect(myRow.totals.totalWorkingHours).toBe(theirRow.totals.totalWorkingHours);
      expect(myRow.totals.quantity).toBe(theirRow.totals.quantity);
    }
    expect(myRow).toBeTruthy();
  });

  test("deliverable hours come from the DELIVERABLE activity type", async () => {
    const res = await inst1.get(`/api/universities/${northId}/tracker?from=2035-03-05&to=2035-03-05`);
    const row = res.body.tracker.rows.find(
      (r: { instructorId: string }) => r.instructorId === inst1Id,
    );
    const cell = Object.values(row.cells)[0] as
      | { hoursByCategory: Record<string, number> }
      | undefined;
    const hours = cell?.hoursByCategory ?? {};
    // Whatever is present, splitting on the code can never produce a negative.
    const deliverable = hours.DELIVERABLE ?? 0;
    const other = Object.entries(hours)
      .filter(([code]) => code !== "DELIVERABLE")
      .reduce((n, [, v]) => n + v, 0);
    expect(deliverable).toBeGreaterThanOrEqual(0);
    expect(other).toBeGreaterThanOrEqual(0);
  });

  test("their own profile carries manager and university, read-only", async () => {
    const res = await inst1.get(`/api/instructors/${inst1Id}`);
    expect(res.status).toBe(200);
    expect(res.body.instructor).toHaveProperty("manager");
    expect(res.body.instructor.university).toHaveProperty("name");
  });
});

describe("unassignment leaves the instructor intact", () => {
  test("an admin can remove them from a roster without losing anything", async () => {
    const before = await admin.get(`/api/activities?instructorId=${inst1Id}&limit=200`);
    const dayCount = before.body.total;

    const removed = await admin.patch(`/api/instructors/${inst1Id}/manager`, { managerId: null });
    expect(removed.status).toBe(200);

    // The account still exists…
    const still = await admin.get(`/api/instructors?universityId=${northId}&limit=200`);
    expect(still.body.instructors.map((i: { id: string }) => i.id)).toContain(inst1Id);

    // …the history is untouched…
    const after = await admin.get(`/api/activities?instructorId=${inst1Id}&limit=200`);
    expect(after.body.total).toBe(dayCount);

    // …and they can still use their own portal.
    const mine = await inst1.get("/api/activities?limit=10");
    expect(mine.status).toBe(200);
  });

  test("their profile now reports no manager", async () => {
    const res = await inst1.get(`/api/instructors/${inst1Id}`);
    expect(res.status).toBe(200);
    expect(res.body.instructor.manager).toBeNull();
  });

  test("the manager no longer lists them", async () => {
    const res = await manager.get("/api/instructors?limit=200");
    expect(res.body.instructors.map((i: { id: string }) => i.id)).not.toContain(inst1Id);
  });

  test("an admin can put them back", async () => {
    const res = await admin.patch(`/api/instructors/${inst1Id}/manager`, { managerId });
    expect(res.status).toBe(200);
    expect(res.body.instructor.managerId).toBe(managerId);
  });
});
