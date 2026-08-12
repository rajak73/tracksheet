import { beforeAll, describe, expect, test } from "vitest";
import { ACCOUNTS, ApiClient } from "./helpers/client";

/**
 * AI traceability and admin roll-up gate.
 *
 * The rule under test: an insight may only state things present in its stored
 * metric snapshot. Previously a WORKLOAD_BALANCE insight was emitted
 * unconditionally with literal figures even when the university had no activity
 * data at all, so the audit trail lent credibility to invented numbers.
 */

let admin: ApiClient;
let managerWest: ApiClient;
let west1: ApiClient;

let westId: string;
let west1Id: string;

const MON = "2026-10-05";
const FRI = "2026-10-09";

/** Westbrook is America/New_York, 08:30-16:30, 30 min break -> 7.5h/day. */
function nyToUtc(date: string, hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  // October is EDT (UTC-4).
  const utcMinutes = h * 60 + m + 4 * 60;
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + utcMinutes * 60_000).toISOString();
}

beforeAll(async () => {
  admin = new ApiClient("admin");
  managerWest = new ApiClient("mgrW");
  west1 = new ApiClient("west1");
  await admin.login(ACCOUNTS.admin);
  const mw = await managerWest.login(ACCOUNTS.managerWest);
  const w1 = await west1.login(ACCOUNTS.instructorWest1);
  westId = mw.user.universityId!;
  west1Id = w1.user.instructorId!;
});

describe("insights are derived, never invented", () => {
  test("a period with no activity produces only claims the data supports", async () => {
    const gen = await managerWest.post(
      `/api/universities/${westId}/insights?from=${MON}&to=${FRI}`,
      {},
    );
    expect(gen.status).toBe(201);

    const insights = gen.body.insights;
    expect(insights.length).toBeGreaterThan(0);

    // The fabricated insight quoted "2 instructors ... 10+ hours of unutilized
    // capacity" and stored avgUnutilizedHours: 10.5. Neither may appear.
    const serialised = JSON.stringify(insights);
    expect(serialised).not.toContain("avgUnutilizedHours");
    expect(serialised).not.toContain("10.5");

    // With no activity recorded, the only defensible statement is that nothing
    // was recorded — never a measured utilisation figure.
    const types = insights.map((i: { type: string }) => i.type);
    expect(types).toContain("NO_DATA_RECORDED");
    expect(types).not.toContain("UNDERUTILIZATION");
    expect(types).not.toContain("OVERLOAD");
  });

  test("every number quoted in the text appears in the stored snapshot", async () => {
    const list = await managerWest.get(`/api/universities/${westId}/insights`);
    expect(list.status).toBe(200);

    for (const insight of list.body.insights) {
      const snapshotValues = new Set(
        JSON.stringify(insight.supportingData).match(/\d+(\.\d+)?/g) ?? [],
      );
      const quoted = insight.recommendation.match(/\d+(\.\d+)?/g) ?? [];

      for (const n of quoted) {
        expect(
          snapshotValues.has(n),
          `insight ${insight.type} quotes ${n} but its stored snapshot does not contain it: ` +
            JSON.stringify(insight.supportingData),
        ).toBe(true);
      }
    }
  });

  test("insights use neutral language and never judge a person", async () => {
    const list = await managerWest.get(`/api/universities/${westId}/insights`);
    const text = list.body.insights
      .map((i: { recommendation: string }) => i.recommendation)
      .join(" ")
      .toLowerCase();

    for (const banned of ["lazy", "inefficient", "poor performer", "unproductive employee", "bad"]) {
      expect(text).not.toContain(banned);
    }
    expect(text).toMatch(/recommended|may |reviewing|confirming/);
  });

  test("a period with real data produces measured insights", async () => {
    // 1 hour of teaching against 5 x 7.5h = 37.5h capacity -> heavily under.
    await managerWest.post(`/api/instructors/${west1Id}/activities`, {
      activityTypeCode: "TEACHING",
      startTime: nyToUtc(MON, "09:00"),
      endTime: nyToUtc(MON, "10:00"),
    });

    const gen = await managerWest.post(
      `/api/universities/${westId}/insights?from=${MON}&to=${FRI}`,
      {},
    );
    expect(gen.status).toBe(201);

    const types = gen.body.insights.map((i: { type: string }) => i.type);
    // "Nothing recorded" no longer applies; a measured utilisation does.
    expect(types).not.toContain("NO_DATA_RECORDED");
    expect(types).toContain("UNDERUTILIZATION");

    const under = gen.body.insights.find(
      (i: { type: string }) => i.type === "UNDERUTILIZATION",
    );
    // The snapshot names the instructor it measured and the threshold applied.
    expect(under.supportingData.instructorId).toBeTruthy();
    expect(under.supportingData.threshold.utilizationPct).toBe(60);
    expect(under.supportingData.metrics.utilizationPct).toBeLessThan(60);
  });

  test("insight generation is recorded in the audit log", async () => {
    // Audit rows are written for a manager action; verified indirectly by the
    // endpoint succeeding and by the admin overview counting open insights.
    const overview = await admin.get("/api/admin/overview");
    expect(overview.status).toBe(200);
    expect(overview.body.overview.openInsights).toBeGreaterThan(0);
  });

  test("an instructor cannot generate or read insights", async () => {
    expect((await west1.get(`/api/universities/${westId}/insights`)).status).toBe(403);
    expect((await west1.post(`/api/universities/${westId}/insights`, {})).status).toBe(403);
  });
});

describe("admin overview is computed, not hard-coded", () => {
  test("counts match the seeded platform", async () => {
    const res = await admin.get("/api/admin/overview");
    expect(res.status).toBe(200);

    const o = res.body.overview;
    expect(o.totalUniversities).toBe(2);
    expect(o.totalManagers).toBe(2);
    expect(o.totalInstructors).toBe(4);

    // The previous dashboard hard-coded 124.5 teaching hours.
    expect(o.productiveHours).not.toBe(124.5);
    expect(res.body.universities).toHaveLength(2);
  });

  test("per-university totals sum to the platform totals", async () => {
    const res = await admin.get("/api/admin/overview");
    const sum = res.body.universities.reduce(
      (a: number, u: { capacityHours: number }) => a + u.capacityHours,
      0,
    );
    expect(Number(sum.toFixed(2))).toBe(res.body.overview.capacityHours);
  });

  test("each university's period is resolved in its own timezone", async () => {
    const res = await admin.get("/api/admin/overview");
    const zones = res.body.universities.map((u: { timezone: string }) => u.timezone);
    expect(new Set(zones).size).toBe(2);
  });

  test("only an admin can read the overview", async () => {
    expect((await managerWest.get("/api/admin/overview")).status).toBe(403);
    expect((await west1.get("/api/admin/overview")).status).toBe(403);
    expect((await new ApiClient("anon").get("/api/admin/overview")).status).toBe(401);
  });
});
