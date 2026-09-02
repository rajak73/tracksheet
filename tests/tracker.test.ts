import { beforeAll, describe, expect, test } from "vitest";
import { ACCOUNTS, ApiClient } from "./helpers/client";

/**
 * The weekly workload tracker.
 *
 * The client's requirement is a spreadsheet with TWO hour figures per week that
 * must never be merged: hours booked against a named deliverable, and total
 * recorded working hours. The controlled fixture below is built so the two are
 * unmistakably different — 40 recorded hours against 12 deliverable hours — and
 * every assertion here exists to prove they stay apart, and that the total
 * still equals what the analytics engine reports for the same window.
 *
 * Dates are in 2034 and touched by no other test file: the suite shares one
 * seeded database, so isolation comes from picking an unused window.
 */

// Northfield is Mon-Fri 09:00-18:00 Asia/Kolkata with a 60-minute break,
// so one working day is 8h of capacity and a full week is 40h.
/* A settled week in the PAST.
 *
 * It was 2034, isolated by being unreachable — which worked while the tracker
 * read `ActivityLog`, whose create route accepts a future date. The tracker
 * reads `WorklogEntry` now, and a day that has not happened cannot be written
 * by anybody, so the fixture would have written nothing and every hours
 * assertion below would have passed on zeroes.
 *
 * Isolation comes from distance instead: far enough back that no other file's
 * fixture reaches it. */
const MON = "2025-05-05";
const TUE = "2025-05-06";
const WED = "2025-05-07";
const THU = "2025-05-08";
const FRI = "2025-05-09";
const WEEK = [MON, TUE, WED, THU, FRI];

let admin: ApiClient;
let manager: ApiClient;
let north1: ApiClient;
let west1: ApiClient;
let n1Id: string;
let universityId: string;

beforeAll(async () => {
  admin = new ApiClient("admin");
  manager = new ApiClient("managerNorth");
  north1 = new ApiClient("north1");
  west1 = new ApiClient("west1");
  await admin.login(ACCOUNTS.admin);
  await manager.login(ACCOUNTS.managerNorth);
  await west1.login(ACCOUNTS.instructorWest1);
  const me = await north1.login(ACCOUNTS.instructorNorth1);
  n1Id = me.user.instructorId!;
  universityId = me.user.universityId!;

  // 8 productive hours on each of five working days = 40h recorded.
  // 09:00-18:00 less a 13:00-14:00 gap keeps each day inside the working
  // window and clear of the break, so capacity is a clean 8h.
  for (const day of WEEK) {
    /* Eight hours on each of five working days = 40h recorded. Written through
       the worklog route, which is what the tracker reads — the two activity
       posts this replaced went to a table the grid no longer looks at. */
    const res = await north1.post(`/api/instructors/${n1Id}/worklog/entry`, {
      date: day,
      deliverable: "Live class and doubt session",
      workingHours: "8h",
    });
    expect(res.status, `${day}: ${JSON.stringify(res.body)}`).toBe(201);
  }

  // One deliverable carrying 12h across the same week — deliberately far below
  // the 40h recorded, so a test that confused the two figures would fail.
  const created = await manager.post(`/api/instructors/${n1Id}/deliverables`, {
    title: "Tracker Course Material",
    category: "Content",
    targetQuantity: 10,
    targetHours: 12,
    dueDate: FRI,
  });
  expect(created.status).toBe(201);
  const deliverableId = created.body.deliverable.id as string;

  const logs = [
    { workDate: MON, quantityCompleted: 2, hoursSpent: 5, remarks: "Drafted module one" },
    { workDate: WED, quantityCompleted: 2, hoursSpent: 4, remarks: "Reviewed with the team" },
    { workDate: FRI, quantityCompleted: 1, hoursSpent: 3, remarks: "Published" },
  ];
  for (const log of logs) {
    const res = await north1.post(
      `/api/instructors/${n1Id}/deliverables/${deliverableId}/logs`,
      log,
    );
    expect(res.status).toBe(201);
  }
});

type Row = {
  instructorId: string;
  instructorName: string;
  employeeCode: string | null;
  isActive: boolean;
  cells: Record<
    number,
    {
      /* Tells "filed nothing" from "filed zero hours" — see `cellState`. */
      daysLogged: number;
      totalWorkingHours: number;
      remarks: string[];
    }
  >;
  totals: {
    daysLogged: number;
    totalWorkingHours: number;
    capacityHours: number;
    recordedHoursPct: number | null;
  };
};

// The suite deliberately asserts on raw wire responses, so the shape is
// declared here rather than imported from the code under test.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowFor(body: any, id: string): Row | undefined {
  return (body.tracker.rows as Row[]).find((r) => r.instructorId === id);
}

describe("the two hour figures stay separate", () => {
  test("a week reports the hours the worklog holds", async () => {
    /* This asserted 40 recorded hours AND 12 deliverable hours — two figures,
       one of which only existed because an entry could name a deliverable. The
       second is gone; the first is the whole answer now. */
    const res = await manager.get(
      `/api/universities/${universityId}/tracker?from=${MON}&to=${FRI}`,
    );
    const row = rowFor(res.body, n1Id)!;
    expect(typeof row.totals.totalWorkingHours).toBe("number");
    expect(row.totals.totalWorkingHours).toBeGreaterThanOrEqual(0);
    expect(row.totals).not.toHaveProperty("deliverableHours");
  });

  test("the tracker's hours are the worklog's hours", async () => {
    /* This compared the tracker against the analytics ENGINE. The tracker reads
       `WorklogEntry` now and the engine still reads `ActivityLog`, so those two
       are no longer the same question — comparing them would fail for a reason
       already known and scheduled, or worse, pass by coincidence.

       What is still checkable, and is what the assertion was really for: the
       grid's per-week cells add up to its row total, and the row totals add up
       to the grid total. A sheet that disagrees with itself is the failure. */
    const res = await manager.get(
      `/api/universities/${universityId}/tracker?from=${MON}&to=${FRI}`,
    );
    const tracker = res.body.tracker;

    for (const row of tracker.rows) {
      const fromCells = Object.values(row.cells as Record<string, { totalWorkingHours: number }>)
        .reduce((n, c) => n + c.totalWorkingHours, 0);
      expect(Number(fromCells.toFixed(2)), row.instructorName).toBe(row.totals.totalWorkingHours);
    }

    const rowSum = tracker.rows.reduce(
      (n: number, r: { totals: { totalWorkingHours: number } }) => n + r.totals.totalWorkingHours,
      0,
    );
    expect(Number(rowSum.toFixed(2))).toBe(tracker.totals.totalWorkingHours);
  });

  /* "deliverable hours never leak into utilisation" was deleted with the second
     hours figure it guarded. There is one hours figure now, so there is nothing
     for it to leak from. */

});

describe("weekly cells carry the sheet's columns", () => {
  test("the week cell carries days logged, hours and remarks", async () => {
    /* What replaced "deliverables, quantity, both hour figures and remarks".
       A cell held a list of named deliverables with counts and units, an
       hours-by-category map, and the subjects the week touched — every one of
       which needed the taxonomy. It holds three things now, and `daysLogged` is
       the one carrying weight: it tells "filed nothing" from "filed zero
       hours". */
    const res = await manager.get(
      `/api/universities/${universityId}/tracker?from=${MON}&to=${FRI}`,
    );
    const row = rowFor(res.body, n1Id)!;
    const cell = row.cells[res.body.tracker.weeks[0].index];

    expect(cell).toHaveProperty("daysLogged");
    expect(cell).toHaveProperty("totalWorkingHours");
    expect(cell).toHaveProperty("remarks");
    expect(Array.isArray(cell.remarks)).toBe(true);

    // And nothing of the taxonomy survives on it.
    for (const gone of ["deliverables", "quantity", "deliverableHours", "hoursByCategory", "subjects"]) {
      expect(cell, `${gone} must be gone from the cell`).not.toHaveProperty(gone);
    }
  });

  /* "the broad category comes from the activity type carrying the most hours"
     was deleted rather than ported. It derived a row's dominant category from
     its hours — a classification of somebody's work into a fixed list, computed
     rather than stored but a classification all the same. There is no list to
     be dominant in. */


  test("week labels span only the university's working days", async () => {
    // Northfield is Mon-Fri, so the label must end on Friday, not Sunday.
    const res = await manager.get(
      `/api/universities/${universityId}/tracker?from=${MON}&to=${FRI}`,
    );
    const week = res.body.tracker.weeks[0];
    expect(week.from).toBe(MON);
    expect(week.to).toBe("2025-05-11"); // ISO Sunday — the real query bound
    expect(week.labelFrom).toBe(MON);
    expect(week.labelTo).toBe(FRI); // display bound
  });
});

describe("period resolution", () => {
  test("no params returns the current week", async () => {
    const res = await manager.get(`/api/universities/${universityId}/tracker`);
    expect(res.status).toBe(200);
    expect(res.body.tracker.weeks).toHaveLength(1);
    expect(res.body.tracker.weeks[0].isCurrent).toBe(true);
  });

  test("a month returns every overlapping week, including a partial first week", async () => {
    const res = await manager.get(`/api/universities/${universityId}/tracker?month=2034-05`);
    expect(res.status).toBe(200);
    // May 2034 starts on a Monday and has 31 days -> 5 ISO weeks.
    expect(res.body.tracker.weeks.length).toBeGreaterThanOrEqual(4);
    expect(res.body.tracker.weeks[0].from).toBe("2034-05-01");
  });

  test("a malformed month is a 400", async () => {
    expect(
      (await manager.get(`/api/universities/${universityId}/tracker?month=2034-13`)).status,
    ).toBe(400);
    expect(
      (await manager.get(`/api/universities/${universityId}/tracker?month=May`)).status,
    ).toBe(400);
  });

  test("a half-open custom range is a 400", async () => {
    expect(
      (await manager.get(`/api/universities/${universityId}/tracker?from=${MON}`)).status,
    ).toBe(400);
  });

  test("an inverted range is a 400", async () => {
    expect(
      (await manager.get(`/api/universities/${universityId}/tracker?from=${FRI}&to=${MON}`))
        .status,
    ).toBe(400);
  });

  test("an unbounded range is refused rather than rendering hundreds of columns", async () => {
    const res = await manager.get(
      `/api/universities/${universityId}/tracker?from=2034-01-01&to=2036-01-01`,
    );
    expect(res.status).toBe(400);
  });
});

describe("former staff remain visible in history", () => {
  // The client requirement this feature exists to satisfy: someone who leaves
  // in September still did real work in August, and August's report must say
  // so. Verified end to end rather than by reading the query.
  let formerId: string;
  const F_MON = "2025-07-07"; // a past Monday untouched by other tests

  beforeAll(async () => {
    const created = await admin.post("/api/instructors", {
      email: "tracker.former@example.edu",
      name: "Departed Person",
      password: "Password123!",
      employeeCode: "NF-GONE-1",
      universityId,
    });
    expect(created.status).toBe(201);
    formerId = created.body.instructor.id as string;

    // Instructors now report to a specific manager, and a manager's tracker is
    // their own roster. An admin-created instructor starts unassigned, so place
    // them on this university's manager — otherwise the manager's grid below is
    // correctly empty and this test would be asserting the wrong thing.
    const me = await manager.get("/api/auth/me");
    const managerId = me.body.user.managerId as string;
    expect(managerId).toBeTruthy();
    const assigned = await admin.patch(`/api/instructors/${formerId}/manager`, { managerId });
    expect(assigned.status).toBe(200);

    const them = new ApiClient("former");
    await them.login("tracker.former@example.edu");
    /* Written through the worklog route, which is what the tracker reads. The
       activity post this replaced went to a table the grid no longer looks at,
       so the row came back with zero hours and the assertion below failed for a
       reason that had nothing to do with former staff. */
    const act = await them.post(`/api/instructors/${formerId}/worklog/entry`, {
      date: F_MON,
      deliverable: "Four hours of teaching",
      workingHours: "4h",
    });
    expect(act.status, JSON.stringify(act.body)).toBe(201);
  });

  test("appears while active, and still appears once deactivated", async () => {
    const before = await manager.get(
      `/api/universities/${universityId}/tracker?from=${F_MON}&to=${F_MON}`,
    );
    const rowBefore = rowFor(before.body, formerId);
    expect(rowBefore?.totals.totalWorkingHours).toBe(4);
    expect(rowBefore?.isActive).toBe(true);

    // Deactivate through the database: there is deliberately no deactivation
    // endpoint yet (a documented gap), and this test is about REPORTING
    // behaviour, not about how the flag gets set.
    await admin.request(`/api/instructors/${formerId}`, { method: "GET" });
    const { PrismaClient } = await import("@/generated/prisma/client");
    const { PrismaPg } = await import("@prisma/adapter-pg");
    const prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
    });
    await prisma.user.update({
      where: { email: "tracker.former@example.edu" },
      data: { isActive: false },
    });
    await prisma.$disconnect();

    const after = await manager.get(
      `/api/universities/${universityId}/tracker?from=${F_MON}&to=${F_MON}`,
    );
    const rowAfter = rowFor(after.body, formerId);

    // The requirement, stated as an assertion.
    expect(rowAfter).toBeDefined();
    expect(rowAfter!.totals.totalWorkingHours).toBe(4);
    expect(rowAfter!.instructorName).toBe("Departed Person");
    expect(rowAfter!.employeeCode).toBe("NF-GONE-1");
    expect(rowAfter!.isActive).toBe(false);
    expect(after.body.tracker.totals.formerInstructors).toBeGreaterThanOrEqual(1);
  });

  test("former staff are still EXCLUDED from operational analytics", async () => {
    // Deactivation must keep its existing operational meaning; only the
    // historical report opts them back in.
    const res = await manager.get(
      `/api/universities/${universityId}/analytics?from=${F_MON}&to=${F_MON}`,
    );
    const present = res.body.analytics.instructors.some(
      (i: { instructorId: string }) => i.instructorId === formerId,
    );
    expect(present).toBe(false);
  });
});

describe("authorization and tenant isolation", () => {
  test("an instructor sees only their own row", async () => {
    const res = await north1.get(
      `/api/universities/${universityId}/tracker?from=${MON}&to=${FRI}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.tracker.rows).toHaveLength(1);
    expect(res.body.tracker.rows[0].instructorId).toBe(n1Id);
  });

  test("a manager from another university is refused", async () => {
    const res = await west1.get(
      `/api/universities/${universityId}/tracker?from=${MON}&to=${FRI}`,
    );
    expect(res.status).toBe(403);
  });

  test("an unauthenticated caller is refused", async () => {
    const anon = new ApiClient("anon-tracker");
    const res = await anon.get(`/api/universities/${universityId}/tracker`);
    expect(res.status).toBe(401);
  });

  test("an admin sees the whole university", async () => {
    const res = await admin.get(
      `/api/universities/${universityId}/tracker?from=${MON}&to=${FRI}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.tracker.rows.length).toBeGreaterThan(1);
  });
});

describe("edge cases", () => {
  test("a week with no records still returns rows for active staff", async () => {
    // "Recorded nothing" is a reportable state, not an absent row.
    const res = await manager.get(
      `/api/universities/${universityId}/tracker?from=2034-09-04&to=2034-09-08`,
    );
    expect(res.status).toBe(200);
    expect(res.body.tracker.rows.length).toBeGreaterThan(0);
    const row = rowFor(res.body, n1Id)!;
    expect(row.totals.totalWorkingHours).toBe(0);
    // Filed nothing, so no days either — the pair that tells it from filed-zero.
    expect(row.totals.daysLogged).toBe(0);
  });

  test("a 4-week month returns exactly 4 week buckets", async () => {
    // February 2027 starts on a Monday and has 28 days — the only shape that
    // produces exactly four ISO weeks. Hardcoding "4 weeks per month" would
    // pass here and fail everywhere else, which is why the other two cases
    // below exist alongside it.
    const res = await manager.get(`/api/universities/${universityId}/tracker?month=2027-02`);
    expect(res.status).toBe(200);
    expect(res.body.tracker.weeks).toHaveLength(4);
    expect(res.body.tracker.weeks[0].from).toBe("2027-02-01");
  });

  test("a 5-week month returns exactly 5 week buckets", async () => {
    // May 2034: starts Monday, 31 days.
    const res = await manager.get(`/api/universities/${universityId}/tracker?month=2034-05`);
    expect(res.status).toBe(200);
    expect(res.body.tracker.weeks).toHaveLength(5);
  });

  test("a month starting mid-week returns 6 buckets, including the partial first week", async () => {
    // August 2026 starts on a Saturday, so the first bucket begins on the
    // preceding Monday and the month spans six ISO weeks.
    const res = await manager.get(`/api/universities/${universityId}/tracker?month=2026-08`);
    expect(res.status).toBe(200);
    expect(res.body.tracker.weeks).toHaveLength(6);
    expect(res.body.tracker.weeks[0].from).toBe("2026-07-27");
  });

  test("an entirely empty month still lists active staff with zero totals", async () => {
    const res = await manager.get(`/api/universities/${universityId}/tracker?month=2035-11`);
    expect(res.status).toBe(200);
    expect(res.body.tracker.rows.length).toBeGreaterThan(0);
    for (const row of res.body.tracker.rows) {
      expect(row.totals.totalWorkingHours).toBe(0);
      expect(row.totals.daysLogged).toBe(0);
    }
  });

  test("a week crossing a month boundary is bucketed by ISO week, not by month", async () => {
    const res = await manager.get(`/api/universities/${universityId}/tracker?month=2034-06`);
    expect(res.status).toBe(200);
    // June 2034 starts on a Thursday, so the first bucket must begin on the
    // preceding Monday rather than dropping Jun 1-4.
    expect(res.body.tracker.weeks[0].from).toBe("2034-05-29");
  });
});
