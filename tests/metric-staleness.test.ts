import { beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/server/db";
import { ApiClient, ACCOUNTS } from "./helpers/client";
import { seedDayRow } from "./helpers/worklog";
import { RUN } from "./helpers/fixtures";
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
 *
 * ── The route this file was written about is gone, and so is the fix ──────
 * The per-activity DELETE recomputed the day it touched, which is what made
 * the assertion below true. It has been removed with the model it belonged to,
 * and the day route that replaced it CANNOT do the same job: `recomputeDay`
 * summarises `ActivityLog`, and a day written through `/worklog/entry` never
 * touches that table. Calling it there would be maintenance theatre — a call
 * that looks like it keeps two things in step and cannot.
 *
 * So the staleness this file exists to prevent is currently REAL for every day
 * written through the new path, and it is stated here rather than papered over.
 * It closes when the rollup moves onto `WorklogEntry` in the analytics commit;
 * the `test.todo` at the foot is what says so out loud until then.
 */


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
  test("a summary written for an old day does not follow its data on its own", async () => {
    /* What is still true and still worth pinning: the metric tables are a cache
       with no way to notice its source moved. This writes a day well outside
       the scheduler's trailing window, summarises it, changes the data
       underneath, and shows the summary standing still.

       That is the DEFECT, asserted as a defect. The old version of this test
       asserted the fix — a write route recomputing the day it touched — and
       the route that did it no longer exists. Asserting the fix through some
       other path would have meant testing the rollup rather than the
       maintenance, and passing while the product was wrong. */
    const created = await admin.post("/api/instructors", {
      email: `stale.${RUN}@fixture.test`,
      name: `Stale ${RUN}`,
      password: "metric-staleness-pw-1234",
      universityId: northId,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const instructorId = created.body.instructor.id;

    /* Three hours on a day well outside the scheduler's window. Written
       straight to the table because the worklog route refuses a day before this
       instructor's record began, and OLD_DAY is deliberately that old — see
       `seedDayRow`, which throws rather than returning so a refused write
       cannot pass silently. */
    const logged = await seedDayRow({
      instructorId,
      universityId: northId,
      date: OLD_DAY,
      deliverable: "Three hours of teaching",
      workingHours: 3,
    });
    expect(Number(logged.workingHours), "the fixture must actually have written").toBe(3);

    // Summarise the day, as the scheduler would have done when it was recent.
    expect((await admin.post(`/api/admin/rollup?from=${OLD_DAY}&to=${OLD_DAY}`, {})).status).toBe(200);

    const before = await storedProductiveMinutes();
    expect(before, "the day should be summarised before we change it").not.toBeNull();
    expect(before!).toBeGreaterThanOrEqual(180);

    await prisma.worklogEntry.delete({ where: { id: logged.id } });

    const after = await storedProductiveMinutes();
    expect(
      after ?? 0,
      "nothing recomputes an old day on its own — this is the staleness, not a pass",
    ).toBe(before!);

    // And a rollup, when something finally runs one, does put it right.
    expect((await admin.post(`/api/admin/rollup?from=${OLD_DAY}&to=${OLD_DAY}`, {})).status).toBe(200);
    expect(await storedProductiveMinutes(), "the maths itself is not in doubt").toBe(
      before! - 180,
    );
  });
});

/* Closes when `recomputeDay` reads `WorklogEntry`. Until then a day corrected
   through the worklog route leaves the admin dashboard's stored figure for that
   day permanently wrong, with nothing in the data to show it. */
test.todo("writing a day through /worklog/entry recomputes that day's stored summary");
