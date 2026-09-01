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
