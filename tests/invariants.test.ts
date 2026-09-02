import { beforeAll, describe, expect, test } from "vitest";
import { ACCOUNTS, ApiClient } from "./helpers/client";
import { prisma } from "@/server/db";
import { toDateOnly } from "@/server/time/workday";
import { daysAgo, seedDayRow } from "./helpers/worklog";
import { RUN } from "./helpers/fixtures";

/**
 * Relationships that must hold no matter which table anything reads from.
 *
 * ── Why these exist, and why now ──────────────────────────────────────────
 * `workingHours <= recordedHours` caught a defect no unit test would have:
 * two names for one number, read from two different tables, one of which had
 * moved to `WorklogEntry` and one of which had not. Nothing was individually
 * wrong — each query returned exactly what it asked for. The bug was only
 * visible in the RELATIONSHIP between two answers.
 *
 * That is the characteristic bug of a table migration, and consumers are still
 * moving. An invariant added after a migration confirms the final state; one
 * added during it fails on the step that breaks it, while the cause is still a
 * single commit wide. So these are written mid-flight, deliberately.
 *
 * Every figure here is checked against the raw sum of `working_hours` over the
 * period's rows — the record itself, read directly, never through the code
 * under test.
 */

const admin = new ApiClient("invariants-admin");

let northId: string;
/** Seeded with a known week. */
let withDays: string;
/** Deliberately never given a single WorklogEntry row. */
let noDays: string;

/* A window entirely in the past, so no cell is "not yet reached" and every
 * absence is a real absence rather than a date that has not happened. */
const FROM = daysAgo(10);
const TO = daysAgo(4);
const SEEDED: Array<{ date: string; hours: number }> = [
  { date: daysAgo(9), hours: 3 },
  { date: daysAgo(8), hours: 2.5 },
  // Filed, and explicitly zero. Not the same as never filed, and the
  // difference is exactly what invariant 5 is about.
  { date: daysAgo(7), hours: 0 },
];
const RAW_TOTAL = 5.5;

async function makeInstructor(tag: string): Promise<string> {
  const res = await admin.post("/api/instructors", {
    email: `inv.${tag}.${RUN}@fixture.test`,
    name: `Invariant ${tag} ${RUN}`,
    password: "invariants-password-1234",
    universityId: northId,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.instructor.id;
}

/** The record, read directly. Never through anything under test. */
async function rawHours(instructorId: string): Promise<number> {
  const agg = await prisma.worklogEntry.aggregate({
    _sum: { workingHours: true },
    where: {
      instructorId,
      logDate: { gte: toDateOnly(FROM), lte: toDateOnly(TO) },
    },
  });
  return Number(agg._sum.workingHours ?? 0);
}

async function rawDaysLogged(instructorId: string): Promise<number> {
  return prisma.worklogEntry.count({
    where: {
      instructorId,
      logDate: { gte: toDateOnly(FROM), lte: toDateOnly(TO) },
    },
  });
}

type Breakdown = {
  instructorId: string;
  capacityHours: number;
  productiveHours: number;
  unutilizedHours: number;
  missingDataHours: number;
  days: Array<{ date: string; productiveHours: number }>;
};

async function analytics() {
  const res = await admin.get(`/api/universities/${northId}/analytics?from=${FROM}&to=${TO}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.analytics as {
    totals: { productiveHours: number; capacityHours: number };
    instructors: Breakdown[];
  };
}

async function trackerRows() {
  const res = await admin.get(`/api/universities/${northId}/tracker?from=${FROM}&to=${TO}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.tracker.rows as Array<{
    instructorId: string;
    totals: { daysLogged: number; totalWorkingHours: number };
  }>;
}

async function managerRows() {
  const res = await admin.get(`/api/manager/worklog?from=${FROM}&to=${TO}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.instructors as Array<{ instructorId: string; totalHours: number }>;
}

beforeAll(async () => {
  await admin.login(ACCOUNTS.admin);
  const north = new ApiClient("invariants-north");
  northId = (await north.login(ACCOUNTS.instructorNorth1)).user.universityId!;

  withDays = await makeInstructor("seeded");
  noDays = await makeInstructor("empty");

  const universityId = northId;
  for (const day of SEEDED) {
    await seedDayRow({
      instructorId: withDays,
      universityId,
      date: day.date,
      deliverable: `Invariant fixture ${day.date}`,
      workingHours: day.hours,
    });
  }
});

describe("invariants that hold regardless of which table a surface reads", () => {
  test("1. a period's hours equal the raw sum of working_hours over its rows", async () => {
    /* Catches a consumer still reading ActivityLog: it would return a number
     * that is defensible on its own and simply not this one. */
    const raw = await rawHours(withDays);
    expect(raw).toBe(RAW_TOTAL);

    const mine = (await analytics()).instructors.find((i) => i.instructorId === withDays);
    expect(mine, "the seeded instructor must appear in analytics").toBeDefined();
    expect(mine!.productiveHours).toBe(raw);

    const tracked = (await trackerRows()).find((r) => r.instructorId === withDays);
    expect(tracked, "the seeded instructor must appear in the tracker").toBeDefined();
    expect(tracked!.totals.totalWorkingHours).toBe(raw);
  });

  test("2. days logged is between zero and the number of days in the period", async () => {
    /* Catches a period-resolution or timezone error: a day counted twice, or a
     * boundary day attributed to the wrong side, shows up here before it shows
     * up as a wrong total. */
    const spanDays =
      Math.round((Date.parse(`${TO}T00:00:00Z`) - Date.parse(`${FROM}T00:00:00Z`)) / 86_400_000) + 1;

    const tracked = (await trackerRows()).find((r) => r.instructorId === withDays);
    const logged = tracked!.totals.daysLogged;

    expect(logged).toBeGreaterThanOrEqual(0);
    expect(logged).toBeLessThanOrEqual(spanDays);
    expect(logged).toBe(await rawDaysLogged(withDays));
  });

  test("3. no single day exceeds the instructor's total, and no instructor exceeds the university's", async () => {
    // Catches double counting: a day summed into two groups, or an instructor
    // counted under two managers, cannot survive both halves of this.
    const a = await analytics();
    const mine = a.instructors.find((i) => i.instructorId === withDays)!;

    for (const day of mine.days) {
      expect(day.productiveHours).toBeLessThanOrEqual(mine.productiveHours);
    }
    for (const inst of a.instructors) {
      expect(inst.productiveHours).toBeLessThanOrEqual(a.totals.productiveHours);
    }
  });

  test("4. productive + unutilized + missing accounts for the whole capacity", async () => {
    /* Loss or duplication in assembly shows up as a decomposition that no
     * longer adds to the whole.
     *
     * The identity holds only where a day's productive hours do not exceed its
     * capacity: `unutilizedHours` is clamped at zero (engine.ts), so overtime
     * is deliberately not carried as negative idle time. The fixture is seeded
     * well under capacity so the identity is exact here. */
    const mine = (await analytics()).instructors.find((i) => i.instructorId === withDays)!;
    const parts = mine.productiveHours + mine.unutilizedHours + mine.missingDataHours;
    expect(Number(parts.toFixed(2))).toBe(Number(mine.capacityHours.toFixed(2)));
  });

  test("5. an instructor with no rows reports zero hours and zero days on every surface", async () => {
    /* This is the exact shape of the defect that `workingHours <= recordedHours`
     * caught: one surface read a table where the instructor had a legacy row
     * and reported 1, while the surface that had moved reported 0. Pinned here
     * so it cannot come back through a different consumer. */
    expect(await rawHours(noDays)).toBe(0);
    expect(await rawDaysLogged(noDays)).toBe(0);

    const mine = (await analytics()).instructors.find((i) => i.instructorId === noDays);
    expect(mine, "an instructor with no rows still appears — as a zero, not an absence").toBeDefined();
    expect(mine!.productiveHours).toBe(0);

    const tracked = (await trackerRows()).find((r) => r.instructorId === noDays);
    expect(tracked).toBeDefined();
    expect(tracked!.totals.totalWorkingHours).toBe(0);
    expect(tracked!.totals.daysLogged).toBe(0);

    const managed = (await managerRows()).find((r) => r.instructorId === noDays);
    expect(managed).toBeDefined();
    expect(managed!.totalHours).toBe(0);
  });

  test("6. the same instructor-period read through any two surfaces returns the same hours", async () => {
    /* ── Restored from worklog-cross-view ────────────────────────────────
     * This was suspended, not dropped: the instructor's views read
     * `WorklogEntry` while the manager's still read `ActivityLog`, so the
     * comparison could only fail for a known reason or — worse — pass because
     * both fixtures had been written and neither side noticed it was reading a
     * different table. A consistency test that cannot tell agreement from
     * coincidence is worse than none, because it is believed.
     *
     * It comes back here because the surfaces have moved. The fixture is
     * written ONCE, to one table, and every surface is then asked the same
     * question — so agreement cannot be manufactured by seeding each side. */
    const raw = await rawHours(withDays);

    const fromAnalytics = (await analytics()).instructors.find((i) => i.instructorId === withDays)!
      .productiveHours;
    const fromTracker = (await trackerRows()).find((r) => r.instructorId === withDays)!.totals
      .totalWorkingHours;
    const fromManager = (await managerRows()).find((r) => r.instructorId === withDays)!.totalHours;

    expect({ fromAnalytics, fromTracker, fromManager }).toEqual({
      fromAnalytics: raw,
      fromTracker: raw,
      fromManager: raw,
    });
  });
});
