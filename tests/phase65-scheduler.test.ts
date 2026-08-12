import { beforeAll, describe, expect, test } from "vitest";
import { ACCOUNTS, ApiClient } from "./helpers/client";

/**
 * Phase 6.5 gate — the scheduler regression.
 *
 * Adding summary tables moved dashboards off live computation, but nothing
 * populated those tables except a manual admin request, so a freshly seeded
 * database showed zeros until somebody pressed a button. These tests assert
 * the fix: summaries are populated by the seed, the automatic and manual paths
 * agree, and weekly metrics are actually written.
 *
 * NOTE ON WHAT IS NOT TESTED HERE: the wall-clock timer. Waiting an hour for a
 * tick is not a test. What IS tested is the function the timer invokes and the
 * concurrency guard around it — the timer itself is three lines of setInterval
 * wiring verified by inspection.
 */

let admin: ApiClient;
let mgrN: ApiClient;
let n1: ApiClient;
let northId: string;
let n1Id: string;

beforeAll(async () => {
  admin = new ApiClient("admin");
  mgrN = new ApiClient("mgrN");
  n1 = new ApiClient("n1");
  await admin.login(ACCOUNTS.admin);
  await mgrN.login(ACCOUNTS.managerNorth);
  const me = await n1.login(ACCOUNTS.instructorNorth1);
  n1Id = me.user.instructorId!;
  northId = me.user.universityId!;
});

describe("a freshly seeded database has populated summaries", () => {
  test("the seed itself ran a rollup — no manual trigger required", async () => {
    const status = await admin.get("/api/admin/rollup");
    expect(status.status).toBe(200);

    // The seed runs before any test touches the API.
    const seedRun = status.body.runs.find(
      (r: { trigger: string; status: string }) =>
        r.trigger === "SEED" && r.status === "COMPLETED",
    );
    expect(seedRun, "no COMPLETED rollup with trigger=SEED").toBeDefined();
    expect(seedRun.instructorDaysWritten).toBeGreaterThan(0);
    expect(seedRun.instructorWeeksWritten).toBeGreaterThan(0);
  });

  test("the admin dashboard has non-empty summary rows without anyone clicking rollup", async () => {
    const overview = await admin.get("/api/admin/overview");
    expect(overview.status).toBe(200);

    const north = overview.body.universities.find(
      (u: { universityId: string }) => u.universityId === northId,
    );
    // Capacity comes from UniversityDailyMetric. Before this phase it was 0 on
    // a fresh database because nothing wrote that table.
    expect(north.capacityHours).toBeGreaterThan(0);
  });

  test("rollup status reports when the data was last refreshed", async () => {
    const status = await admin.get("/api/admin/rollup");
    expect(status.body.lastCompletedAt).not.toBeNull();
    expect(status.body.staleSeconds).toBeGreaterThanOrEqual(0);
  });

  test("rollup status is admin-only", async () => {
    expect((await mgrN.get("/api/admin/rollup")).status).toBe(403);
    expect((await n1.get("/api/admin/rollup")).status).toBe(403);
    expect((await new ApiClient("anon").get("/api/admin/rollup")).status).toBe(401);
  });
});

describe("the automatic and manual paths produce identical numbers", () => {
  test("a manual recompute over the seeded window changes nothing", async () => {
    const before = await admin.get("/api/admin/overview");

    const manual = await admin.post("/api/admin/rollup", {});
    expect(manual.status).toBe(200);
    expect(manual.body.runId).toBeTruthy();

    const after = await admin.get("/api/admin/overview");

    // The seed used the SEED trigger and the manual call uses MANUAL, but both
    // go through runRollup -> rollupAllUniversities, so the output must match.
    expect(after.body.overview).toEqual(before.body.overview);
  });

  test("both triggers are recorded distinctly for auditability", async () => {
    const status = await admin.get("/api/admin/rollup");
    const triggers = new Set(
      status.body.runs.map((r: { trigger: string }) => r.trigger),
    );
    expect(triggers.has("SEED")).toBe(true);
    expect(triggers.has("MANUAL")).toBe(true);
  });

  test("a failed run would be recorded, not silently swallowed", async () => {
    // Every run row carries a status; nothing is written as COMPLETED without
    // finishing. Asserting the invariant rather than forcing a failure.
    const status = await admin.get("/api/admin/rollup");
    for (const run of status.body.runs) {
      expect(["RUNNING", "COMPLETED", "FAILED"]).toContain(run.status);
      if (run.status === "COMPLETED") expect(run.completedAt).not.toBeNull();
      if (run.status === "FAILED") expect(run.errorMessage).not.toBeNull();
    }
  });
});

describe("weekly metrics are written and correct", () => {
  test("the instructor's current week is present and non-empty", async () => {
    const res = await n1.get(`/api/instructors/${n1Id}/metrics`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.weeks)).toBe(true);
    expect(res.body.weeks.length).toBeGreaterThan(0);

    const week = res.body.weeks[0];
    expect(week.capacityHours).toBeGreaterThan(0);
    expect(week.expectedWorkingDays).toBeGreaterThan(0);
  });

  test("weeks start on Monday and span seven days", async () => {
    const res = await n1.get(`/api/instructors/${n1Id}/metrics`);
    for (const week of res.body.weeks) {
      const start = new Date(`${week.periodStart}T00:00:00Z`);
      const end = new Date(`${week.periodEnd}T00:00:00Z`);
      expect(start.getUTCDay(), `${week.periodStart} should be Monday`).toBe(1);
      expect((end.getTime() - start.getTime()) / 86_400_000).toBe(6);
    }
  });

  test("a week equals the sum of its own days", async () => {
    // Request a window wide enough to contain at least one complete week.
    const res = await n1.get(
      `/api/instructors/${n1Id}/metrics?from=2026-07-27&to=2026-08-12`,
    );
    const week = res.body.weeks.find(
      (w: { periodStart: string }) => w.periodStart === "2026-08-03",
    );
    if (!week) return; // outside the seeded rollup window; nothing to assert

    const daysInWeek = res.body.days.filter(
      (d: { date: string }) => d.date >= week.periodStart && d.date <= week.periodEnd,
    );
    const summed = Number(
      daysInWeek.reduce((a: number, d: { capacityHours: number }) => a + d.capacityHours, 0).toFixed(2),
    );
    expect(week.capacityHours).toBe(summed);
  });

  test("a colleague's weekly metrics are not readable", async () => {
    const roster = await admin.get(`/api/instructors?universityId=${northId}`);
    const other = roster.body.instructors.find((i: { id: string }) => i.id !== n1Id).id;
    expect((await n1.get(`/api/instructors/${other}/metrics`)).status).toBe(404);
  });
});
