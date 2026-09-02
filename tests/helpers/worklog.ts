import { expect } from "vitest";
import type { ApiClient } from "./client";

/**
 * Writing days into the fixture.
 *
 * ── Why a helper, and why it goes through the API ─────────────────────────
 * Nearly every test that reads worklog data has to put some there first, and
 * each was doing it its own way: some posting activities, some writing rows
 * with Prisma, some relying on rows another file happened to leave behind. The
 * last of those is how a suite gets tests that pass in one order and fail in
 * another — one file's `beforeEach` cleanup silently emptying another file's
 * fixture.
 *
 * These go through the same POST the instructor's dialog uses, so a fixture
 * cannot be written in a shape the product cannot produce. A test that seeds
 * straight into the table can assert on rows no user could ever create, which
 * is the quiet way a suite stops describing the product.
 */

export type DaySpec = {
  /** `YYYY-MM-DD`. */
  date: string;
  deliverable: string;
  /** Free text, exactly as typed. Omitted means the box was left empty. */
  quantity?: string;
  /** `8`, `8.5`, `8h 30m`, `8:30`, `45m` — whatever the box accepts. */
  workingHours: string;
  remarks?: string;
};

/**
 * Writes each day and asserts it landed.
 *
 * Sequential, not `Promise.all`: two writes for the same instructor race on the
 * same unique key, and a fixture that occasionally loses a day would show up as
 * an unrelated assertion failing somewhere downstream.
 */
export async function seedDays(client: ApiClient, instructorId: string, days: DaySpec[]) {
  for (const day of days) {
    const res = await client.post(`/api/instructors/${instructorId}/worklog/entry`, {
      date: day.date,
      deliverable: day.deliverable,
      quantity: day.quantity,
      workingHours: day.workingHours,
      remarks: day.remarks,
    });
    expect(res.status, `seeding ${day.date}: ${JSON.stringify(res.body)}`).toBe(201);
  }
}

/** `YYYY-MM-DD`, n days before today, in the zone the university judges days in. */
export function daysAgo(n: number, timeZone = "Asia/Kolkata"): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toLocaleDateString("en-CA", { timeZone });
}

/**
 * Writes one day directly, for fixtures the product route cannot express.
 *
 * ── When to use this, and when not to ─────────────────────────────────────
 * `seedDays` goes through the POST an instructor uses, and that is the default:
 * a fixture written any other way can assert on a shape no user could create.
 *
 * This exists for the cases the route refuses on purpose — a day in the far
 * past before the fixture's instructor existed, a day belonging to somebody who
 * has since been deactivated, a deliberately zero-hour day. Those are real
 * states the database can hold and the route will not write.
 *
 * ── It throws rather than returning ───────────────────────────────────────
 * The failure this guards against has now happened twice: a fixture writing to
 * a date the route refuses, the write silently doing nothing, and every hours
 * assertion downstream passing on zeroes. A green suite proving nothing is
 * worse than a red one. So this returns the row it wrote, and a caller that
 * ignores it still cannot get a silent no-op — `create` throws.
 */
export async function seedDayRow(input: {
  instructorId: string;
  universityId: string;
  /** `YYYY-MM-DD`. */
  date: string;
  deliverable?: string;
  /** WHOLE MINUTES, the way the column stores them. */
  workingMinutes: number;
  remarks?: string | null;
}) {
  const { prisma } = await import("@/server/db");
  const { toDateOnly } = await import("@/server/time/workday");
  return prisma.worklogEntry.upsert({
    where: {
      instructorId_logDate: {
        instructorId: input.instructorId,
        logDate: toDateOnly(input.date),
      },
    },
    create: {
      instructorId: input.instructorId,
      universityId: input.universityId,
      logDate: toDateOnly(input.date),
      deliverable: input.deliverable ?? "Recorded work",
      workingMinutes: input.workingMinutes,
      remarks: input.remarks ?? null,
    },
    update: {
      deliverable: input.deliverable ?? "Recorded work",
      workingMinutes: input.workingMinutes,
      remarks: input.remarks ?? null,
    },
  });
}
