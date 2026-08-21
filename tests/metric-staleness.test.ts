import { beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/server/db";
import { ApiClient, ACCOUNTS } from "./helpers/client";

/**
 * The stored metrics follow the activities they summarise.
 *
 * ── What went wrong ───────────────────────────────────────────────────────
 * The metric tables are a cache with no way to notice its source moved.
 * `computedAt` says when a row was written, not whether the activities beneath
 * it changed afterwards, and the scheduler only recomputes a short trailing
 * window — three days by default.
 *
 * So correcting or removing an activity on any older day left the summary
 * permanently wrong, with nothing in the data to show it. The admin dashboard
 * reads those rows and the live engine does not, so the two diverged silently
 * and only the dashboard was wrong.
 *
 * The day used here is deliberately far outside the trailing window: the point
 * is precisely the days the scheduler will never revisit.
 */

const RUN = Math.random()
  .toString(36)
  .slice(2, 10)
  .replace(/[0-9]/g, (d) => String.fromCharCode(103 + Number(d)));

/** Well past any rolling window. */
const OLD_DAY = "2026-05-12";

let admin: ApiClient;
let northId = "";

beforeAll(async () => {
  admin = new ApiClient("admin");
  await admin.login(ACCOUNTS.admin);
  const inst = new ApiClient("n1");
  northId = (await inst.login(ACCOUNTS.instructorNorth1)).user.universityId!;
});

async function storedProductiveMinutes(): Promise<number | null> {
  const row = await prisma.universityDailyMetric.findFirst({
    where: { universityId: northId, metricDate: new Date(`${OLD_DAY}T00:00:00.000Z`) },
    select: { productiveMinutes: true },
  });
  return row?.productiveMinutes ?? null;
}

describe("editing an old day updates its summary", () => {
  test("deleting an activity is reflected in the stored metrics", async () => {
    const created = await admin.post("/api/instructors", {
      email: `stale.${RUN}@example.edu`,
      name: `Stale ${RUN}`,
      password: "metric-staleness-pw-1234",
      universityId: northId,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const instructorId = created.body.instructor.id;

    const logged = await admin.post(`/api/instructors/${instructorId}/activities`, {
      activityTypeCode: "TEACHING",
      startTime: `${OLD_DAY}T04:30:00Z`,
      endTime: `${OLD_DAY}T07:30:00Z`,
    });
    expect(logged.status, JSON.stringify(logged.body)).toBe(201);
    const activityId = logged.body.activity.id;

    // Summarise the day, as the scheduler would have done when it was recent.
    expect((await admin.post(`/api/admin/rollup?from=${OLD_DAY}&to=${OLD_DAY}`, {})).status).toBe(200);

    const before = await storedProductiveMinutes();
    expect(before, "the day should be summarised before we change it").not.toBeNull();
    expect(before!).toBeGreaterThanOrEqual(180);

    // Remove the three hours. Nothing else runs a rollup for this day.
    const removed = await admin.delete(`/api/instructors/${instructorId}/activities/${activityId}`);
    expect([200, 204]).toContain(removed.status);

    const after = await storedProductiveMinutes();
    expect(
      after ?? 0,
      "the stored summary must not still be reporting hours that were deleted",
    ).toBe(before! - 180);
  });
});
