import { beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/server/db";
import { computeAnalytics } from "@/server/analytics/engine";
import { ApiClient, ACCOUNTS } from "./helpers/client";
import { seedDayRow } from "./helpers/worklog";
import { RUN } from "./helpers/fixtures";
/**
 * Two arithmetic holes that had nothing to do with each other and one thing in
 * common: both were invisible because the code looked at a DAY instead of a
 * moment.
 */


let admin: ApiClient;
let northId = "";

beforeAll(async () => {
  admin = new ApiClient("admin");
  await admin.login(ACCOUNTS.admin);
  const north = new ApiClient("n1");
  northId = (await north.login(ACCOUNTS.instructorNorth1)).user.universityId!;
});

async function makeInstructor(tag: string): Promise<string> {
  const res = await admin.post("/api/instructors", {
    email: `${tag}.${RUN}@fixture.test`,
    name: `Instructor ${tag} ${RUN}`,
    password: "midnight-departure-pw-1234",
    universityId: northId,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.instructor.id;
}

describe("an activity that crosses midnight still collides", () => {
  /**
   * An activity is filed under the day its START falls in, and may run up to 24
   * hours. So 23:00–01:00 lives under Monday while occupying part of Tuesday.
   * The overlap query filtered `workDate` to the new row's own day and the
   * advisory lock was keyed the same way, so a Tuesday-morning entry was
   * compared against Tuesday's rows only — and never saw the Monday row it
   * genuinely overlapped. No concurrency was needed; the two writes could be
   * minutes apart.
   */
  test("a following entry that overlaps the tail is refused", async () => {
    const id = await makeInstructor("midnight");

    // 23:00 Tuesday -> 01:00 Wednesday, filed under Tuesday.
    const first = await admin.post(`/api/instructors/${id}/activities`, {
      activityTypeCode: "TEACHING",
      startTime: "2026-09-01T17:30:00Z",
      endTime: "2026-09-01T19:30:00Z",
    });
    expect(first.status, JSON.stringify(first.body)).toBe(201);

    // 00:30 -> 01:30 Wednesday. Overlaps the first by half an hour, and is
    // filed under a DIFFERENT day.
    const second = await admin.post(`/api/instructors/${id}/activities`, {
      activityTypeCode: "TEACHING",
      startTime: "2026-09-01T19:00:00Z",
      endTime: "2026-09-01T20:00:00Z",
    });
    expect(second.status, `overlapping across midnight should be refused: ${JSON.stringify(second.body)}`).toBe(409);
  });

  test("a genuinely separate entry the next morning is still allowed", async () => {
    const id = await makeInstructor("midnight-ok");

    expect(
      (
        await admin.post(`/api/instructors/${id}/activities`, {
          activityTypeCode: "TEACHING",
          startTime: "2026-09-01T17:30:00Z",
          endTime: "2026-09-01T19:30:00Z",
        })
      ).status,
    ).toBe(201);

    // Starts exactly when the first ends: touching, not overlapping.
    const after = await admin.post(`/api/instructors/${id}/activities`, {
      activityTypeCode: "TEACHING",
      startTime: "2026-09-01T19:30:00Z",
      endTime: "2026-09-01T20:30:00Z",
    });
    expect(after.status, JSON.stringify(after.body)).toBe(201);
  });
});

describe("someone who leaves keeps the days they worked", () => {
  /**
   * The metrics table is written by `upsert` with `update: data`, so it is
   * rewritten every time the rollup passes over a window. While the engine
   * dropped everyone deactivated, a day a departed instructor really worked was
   * rewritten as though they had not been there — silent, retroactive, and
   * repeated on every scheduled run.
   *
   * `includeInactive: true` is the wrong fix and this test says so: it would
   * charge their capacity for days after they left too.
   */
  test("their past hours survive their departure, and their future capacity does not", async () => {
    const id = await makeInstructor("departing");

    /* A Tuesday they worked: two hours.
    
       Written straight to the table rather than through the route, because this
       instructor is created moments earlier and the route refuses a day before
       their record began. `seedDayRow` throws on failure, so a refused write
       cannot pass as a silent zero — which is what the assertion below would
       then have measured. */
    const worked = await seedDayRow({
      instructorId: id,
      universityId: northId,
      date: "2026-09-01",
      deliverable: "Two hours of teaching",
      workingMinutes: 120,
    });
    expect(worked.workingMinutes, "the fixture must actually have written").toBe(120);

    const before = await computeAnalytics({
      universityId: northId,
      from: "2026-09-01",
      to: "2026-09-04",
      instructorId: id,
    });
    expect(before.instructors[0]?.productiveHours).toBeCloseTo(2, 6);
    const capacityWhileEmployed = before.instructors[0]!.capacityHours;
    expect(capacityWhileEmployed).toBeGreaterThan(0);

    // They leave at the end of that Tuesday.
    const user = await prisma.instructor.findUniqueOrThrow({
      where: { id },
      select: { userId: true },
    });
    await prisma.user.update({
      where: { id: user.userId },
      data: { isActive: false, deletedAt: new Date("2026-09-01T18:30:00Z") },
    });

    const after = await computeAnalytics({
      universityId: northId,
      from: "2026-09-01",
      to: "2026-09-04",
      instructorId: id,
    });

    // The work they did is still theirs…
    expect(
      after.instructors[0]?.productiveHours,
      "a departed instructor's recorded hours must not vanish from a past period",
    ).toBeCloseTo(2, 6);

    // …and they are not measured on the days after they left, so their
    // capacity is strictly smaller than it was while they were employed.
    expect(
      after.instructors[0]!.capacityHours,
      "capacity must stop at their last day, not continue past it",
    ).toBeLessThan(capacityWhileEmployed);
    expect(after.instructors[0]!.capacityHours).toBeGreaterThan(0);
  });
});
