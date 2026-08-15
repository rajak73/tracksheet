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
const MON = "2034-05-01";
const TUE = "2034-05-02";
const WED = "2034-05-03";
const THU = "2034-05-04";
const FRI = "2034-05-05";
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
    const a = await north1.post(`/api/instructors/${n1Id}/activities`, {
      activityTypeCode: "TEACHING",
      local: { date: day, start: "09:00", end: "13:00" },
    });
    expect(a.status).toBe(201);
    const b = await north1.post(`/api/instructors/${n1Id}/activities`, {
      activityTypeCode: "TEACHING",
      local: { date: day, start: "14:00", end: "18:00" },
    });
    expect(b.status).toBe(201);
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
  category: string | null;
  categories: string[];
  cells: Record<
    number,
    {
      deliverables: Array<{ title: string; quantity: number; hours: number }>;
      quantity: number;
      deliverableHours: number;
      totalWorkingHours: number;
      remarks: string[];
    }
  >;
  totals: {
    quantity: number;
    deliverableHours: number;
    totalWorkingHours: number;
    capacityHours: number;
    utilizationPct: number | null;
  };
};

// The suite deliberately asserts on raw wire responses, so the shape is
// declared here rather than imported from the code under test.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowFor(body: any, id: string): Row | undefined {
  return (body.tracker.rows as Row[]).find((r) => r.instructorId === id);
}

describe("the two hour figures stay separate", () => {
  test("a week reports 40 recorded hours and 12 deliverable hours", async () => {
    const res = await manager.get(
      `/api/universities/${universityId}/tracker?from=${MON}&to=${FRI}`,
    );
    expect(res.status).toBe(200);

    const row = rowFor(res.body, n1Id)!;
    expect(row).toBeDefined();

    // The whole point of the feature: two numbers, never merged.
    expect(row.totals.totalWorkingHours).toBe(40);
    expect(row.totals.deliverableHours).toBe(12);
    expect(row.totals.quantity).toBe(5);

    // 40h against a 40h week.
    expect(row.totals.capacityHours).toBe(40);
    expect(row.totals.utilizationPct).toBe(100);
  });

  test("the total matches the analytics engine exactly for the same window", async () => {
    // Reconciliation is the requirement: the tracker must not become a second
    // source of truth for recorded hours.
    const tracker = await manager.get(
      `/api/universities/${universityId}/tracker?from=${MON}&to=${FRI}`,
    );
    const analytics = await manager.get(
      `/api/universities/${universityId}/analytics?from=${MON}&to=${FRI}`,
    );

    const row = rowFor(tracker.body, n1Id)!;
    const engineRow = analytics.body.analytics.instructors.find(
      (i: { instructorId: string }) => i.instructorId === n1Id,
    );

    expect(row.totals.totalWorkingHours).toBe(engineRow.productiveHours);
    expect(row.totals.capacityHours).toBe(engineRow.capacityHours);
    expect(row.totals.utilizationPct).toBe(engineRow.utilizationPct);
  });

  test("deliverable hours never leak into utilisation", async () => {
    // 12 deliverable hours must not push a 40/40 week to 130%.
    const res = await manager.get(
      `/api/universities/${universityId}/tracker?from=${MON}&to=${FRI}`,
    );
    const row = rowFor(res.body, n1Id)!;
    expect(row.totals.utilizationPct).toBe(100);
    expect(row.totals.utilizationPct).not.toBe(130);
  });
});

describe("weekly cells carry the sheet's columns", () => {
  test("the week cell has deliverables, quantity, both hour figures and remarks", async () => {
    const res = await manager.get(
      `/api/universities/${universityId}/tracker?from=${MON}&to=${FRI}`,
    );
    const row = rowFor(res.body, n1Id)!;
    const week = res.body.tracker.weeks[0];
    const cell = row.cells[week.index];

    expect(cell.deliverables).toHaveLength(1);
    expect(cell.deliverables[0].title).toBe("Tracker Course Material");
    expect(cell.deliverables[0].quantity).toBe(5);
    expect(cell.deliverables[0].hours).toBe(12);
    expect(cell.quantity).toBe(5);
    expect(cell.deliverableHours).toBe(12);
    expect(cell.totalWorkingHours).toBe(40);
    // Remarks stay individual, never concatenated into one blob.
    expect(cell.remarks).toEqual([
      "Drafted module one",
      "Reviewed with the team",
      "Published",
    ]);
  });

  test("the broad category comes from the activity type carrying the most hours", async () => {
    const res = await manager.get(
      `/api/universities/${universityId}/tracker?from=${MON}&to=${FRI}`,
    );
    const row = rowFor(res.body, n1Id)!;
    expect(row.category).toBe("TEACHING");
    expect(row.categories).toContain("TEACHING");
  });

  test("week labels span only the university's working days", async () => {
    // Northfield is Mon-Fri, so the label must end on Friday, not Sunday.
    const res = await manager.get(
      `/api/universities/${universityId}/tracker?from=${MON}&to=${FRI}`,
    );
    const week = res.body.tracker.weeks[0];
    expect(week.from).toBe(MON);
    expect(week.to).toBe("2034-05-07"); // ISO Sunday — the real query bound
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
  const F_MON = "2034-07-03"; // a Monday untouched by other tests

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

    const them = new ApiClient("former");
    await them.login("tracker.former@example.edu");
    const act = await them.post(`/api/instructors/${formerId}/activities`, {
      activityTypeCode: "TEACHING",
      local: { date: F_MON, start: "09:00", end: "13:00" },
    });
    expect(act.status).toBe(201);
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
    expect(row.totals.deliverableHours).toBe(0);
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
      expect(row.totals.deliverableHours).toBe(0);
      expect(row.totals.quantity).toBe(0);
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
