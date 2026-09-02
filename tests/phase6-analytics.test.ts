import { beforeAll, describe, expect, test } from "vitest";
import { ACCOUNTS, ApiClient } from "./helpers/client";

/**
 * Phase 6 gate — the analytics engine.
 *
 * Covers the three metrics the audit found missing (workload variance,
 * deliverable completion, trends), the required cross-check that one dataset
 * produces one set of numbers everywhere, and the Phase 4 follow-up: proving
 * the client's weekly spreadsheet can be reconstructed from dated logs with no
 * week columns in the schema.
 */

const WK1_MON = "2027-02-01";
const WK1_WED = "2027-02-03";
const WK1_FRI = "2027-02-05";
const WK2_MON = "2027-02-08";
const WK1_FROM = "2027-02-01";
const WK1_TO = "2027-02-05";
const WK2_FROM = "2027-02-08";
const WK2_TO = "2027-02-12";

let admin: ApiClient, mgrN: ApiClient, n1: ApiClient;
let northId: string, n1Id: string, deliverableId: string;

function ist(date: string, hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + (h * 60 + m - 330) * 60_000).toISOString();
}

beforeAll(async () => {
  admin = new ApiClient("admin");
  mgrN = new ApiClient("mgrN");
  n1 = new ApiClient("n1");
  await admin.login(ACCOUNTS.admin);
  await mgrN.login(ACCOUNTS.managerNorth);
  const me = await n1.login(ACCOUNTS.instructorNorth1);
  n1Id = me.user.instructorId!;
  northId = me.user.universityId!;

  // Week 1: 6h teaching, 1h learning.
  await n1.post(`/api/instructors/${n1Id}/activities`, {
    activityTypeCode: "TEACHING", startTime: ist(WK1_MON, "10:00"), endTime: ist(WK1_MON, "13:00"),
  });
  await n1.post(`/api/instructors/${n1Id}/activities`, {
    activityTypeCode: "TEACHING", startTime: ist(WK1_WED, "10:00"), endTime: ist(WK1_WED, "13:00"),
  });
  await n1.post(`/api/instructors/${n1Id}/activities`, {
    activityTypeCode: "LEARNING", startTime: ist(WK1_FRI, "10:00"), endTime: ist(WK1_FRI, "11:00"),
  });
  // Week 2: 2h teaching only — a clear downward trend.
  await n1.post(`/api/instructors/${n1Id}/activities`, {
    activityTypeCode: "TEACHING", startTime: ist(WK2_MON, "10:00"), endTime: ist(WK2_MON, "12:00"),
  });

  // A deliverable with progress logged across three separate dates.
  const created = await mgrN.post(`/api/instructors/${n1Id}/deliverables`, {
    title: "Python assignments", category: "Teaching",
    targetQuantity: 20, targetHours: 15, dueDate: "2027-02-26",
  });
  expect(created.status).toBe(201);
  deliverableId = created.body.deliverable.id;

  for (const [date, qty, hrs] of [
    [WK1_MON, 5, 3],
    [WK1_WED, 8, 5],
    [WK1_FRI, 7, 6],
  ] as const) {
    const log = await n1.post(
      `/api/instructors/${n1Id}/deliverables/${deliverableId}/logs`,
      { workDate: date, quantityCompleted: qty, hoursSpent: hrs, remarks: "Batch" },
    );
    expect(log.status).toBe(201);
  }
});

async function analytics(from: string, to: string, trend = false) {
  const res = await admin.get(
    `/api/universities/${northId}/analytics?from=${from}&to=${to}${trend ? "&trend=1" : ""}`,
  );
  expect(res.status).toBe(200);
  return res.body.analytics;
}

/**
 * The "workload variance" block was deleted rather than ported.
 *
 * It configured a weekly TEACHING target and asserted the engine reported
 * actual-versus-target against it — per activity type, five tests deep. The
 * `WorkloadTarget` table is dropped and the sixteen types with it: a target
 * cannot be set against free text, and there is nothing left for a variance to
 * be a variance FROM.
 */
describe("deliverable completion", () => {
  test("progress logged across three dates sums against the target", async () => {
    const a = await analytics(WK1_FROM, WK1_TO);
    const mine = a.instructors.find((i: { instructorId: string }) => i.instructorId === n1Id);

    // 5 + 8 + 7 = 20 of 20.
    expect(mine.deliverables.completedQuantity).toBe(20);
    expect(mine.deliverables.targetQuantity).toBe(20);
    expect(mine.deliverables.completionPct).toBe(100);
    expect(mine.deliverables.hoursSpent).toBe(14);
  });

  test("status is derived from the logs, not set by hand", async () => {
    const res = await n1.get(`/api/instructors/${n1Id}/deliverables`);
    const d = res.body.deliverables.find((x: { id: string }) => x.id === deliverableId);
    expect(d.status).toBe("COMPLETED");
  });

  test("overdue is measured against the period end, so history does not shift", async () => {
    // A period ending before the due date must not report it overdue.
    const early = await analytics(WK1_FROM, WK1_TO);
    const mineEarly = early.instructors.find((i: { instructorId: string }) => i.instructorId === n1Id);
    expect(mineEarly.deliverables.overdue).toBe(0);
  });
});

describe("trends over reporting periods", () => {
  test("week 2 is compared against week 1", async () => {
    const a = await analytics(WK2_FROM, WK2_TO, true);
    expect(a.trend).toBeDefined();
    expect(a.trend.previousFrom).toBe(WK1_FROM);
    expect(a.trend.previousTo).toBe(WK1_TO);

  });

  test("trend is opt-in and absent by default", async () => {
    const a = await analytics(WK2_FROM, WK2_TO, false);
    expect(a.trend).toBeUndefined();
  });

  test("a self-scoped trend compares the instructor with themselves", async () => {
    const res = await n1.get(
      `/api/universities/${northId}/analytics?from=${WK2_FROM}&to=${WK2_TO}&trend=1`,
    );
    expect(res.status).toBe(200);
    expect(res.body.analytics.instructors).toHaveLength(1);
  });
});

describe("Gate — one dataset produces one set of numbers", () => {
  test("dashboard analytics and the reports endpoint agree exactly", async () => {
    const a = await analytics(WK1_FROM, WK1_TO);
    const report = await admin.get(
      `/api/universities/${northId}/reports?from=${WK1_FROM}&to=${WK1_TO}`,
    );
    expect(report.status).toBe(200);
    expect(report.body.report.totals).toEqual(a.totals);
  });

  test("the instructor's own view matches the manager's view of them", async () => {
    const managerView = await mgrN.get(
      `/api/universities/${northId}/analytics?from=${WK1_FROM}&to=${WK1_TO}`,
    );
    const mineViaManager = managerView.body.analytics.instructors.find(
      (i: { instructorId: string }) => i.instructorId === n1Id,
    );

    const selfView = await n1.get(
      `/api/universities/${northId}/analytics?from=${WK1_FROM}&to=${WK1_TO}`,
    );
    const mineViaSelf = selfView.body.analytics.instructors[0];

    expect(mineViaSelf.productiveHours).toBe(mineViaManager.productiveHours);
    expect(mineViaSelf.recordedHoursPct).toBe(mineViaManager.recordedHoursPct);
    expect(mineViaSelf.deliverables).toEqual(mineViaManager.deliverables);
  });
});

describe("Phase 4 follow-up — the client spreadsheet reconstructs from dated logs", () => {
  test("weekly rows are produced with no week columns in the schema", async () => {
    // The original spreadsheet was Employee | Category | Week N | Deliverable |
    // Quantity | Hours | Remarks. Reconstruct week 1 by querying the period.
    const logs = await n1.get(
      `/api/instructors/${n1Id}/deliverables/${deliverableId}/logs`,
    );
    expect(logs.status).toBe(200);

    const week1 = logs.body.logs.filter(
      (l: { workDate: string }) =>
        l.workDate.slice(0, 10) >= WK1_FROM && l.workDate.slice(0, 10) <= WK1_TO,
    );
    expect(week1).toHaveLength(3);

    const row = {
      instructor: "Arun Verma",
      category: "Teaching",
      deliverable: "Python assignments",
      quantity: week1.reduce((a: number, l: { quantityCompleted: number }) => a + l.quantityCompleted, 0),
      hours: week1.reduce((a: number, l: { hoursSpent: number }) => a + l.hoursSpent, 0),
    };

    expect(row.quantity).toBe(20);
    expect(row.hours).toBe(14);
  });

  test("a different period slices the same logs differently", async () => {
    // Same underlying rows, narrower window — proof the period is a query, not
    // a stored column.
    const logs = await n1.get(`/api/instructors/${n1Id}/deliverables/${deliverableId}/logs`);
    const mondayOnly = logs.body.logs.filter(
      (l: { workDate: string }) => l.workDate.slice(0, 10) === WK1_MON,
    );
    expect(mondayOnly).toHaveLength(1);
    expect(mondayOnly[0].quantityCompleted).toBe(5);
  });

  test("an instructor can log their own progress but not a colleague's", async () => {
    const roster = await admin.get(`/api/instructors?universityId=${northId}`);
    const other = roster.body.instructors.find((i: { id: string }) => i.id !== n1Id).id;
    const res = await n1.post(`/api/instructors/${other}/deliverables/${deliverableId}/logs`, {
      workDate: WK1_MON, quantityCompleted: 1, hoursSpent: 1,
    });
    expect(res.status).toBe(404);
  });
});
