import { beforeAll, describe, expect, test } from "vitest";
import { ApiClient, ACCOUNTS } from "./helpers/client";
import { prisma } from "@/server/db";
import { analyseDay, DAY_INSIGHT_TYPE } from "@/server/worklog/analysis";
import { dayInsightsByDate } from "@/server/worklog/day-insights";
import { toDateOnly } from "@/server/time/workday";

/**
 * The reading of a day, and the line between what is measured and what is said.
 *
 * ── Why this calls `analyseDay` directly ──────────────────────────────────
 * Production starts this from a write, through `analyseDayInBackground`, which
 * is deliberately fire-and-forget — an accidental `await` upstream would put
 * the model back on the path an instructor waits on, which is the whole reason
 * any of this moved off the write in the first place.
 *
 * Fire-and-forget is untestable by definition: there is no moment at which the
 * suite may assert it has finished, and it writes rows into a database every
 * other file shares. `WORKLOG_ANALYSIS_BACKGROUND=off` in `.env.test` stops
 * writes from starting it, and this file exercises the same function they would
 * have called — so the suite is deterministic about WHEN a day is analysed
 * without giving up any coverage of what analysing it does.
 *
 * So what is covered here is everything the analysis DOES. What is not is the
 * one-line decision to start it.
 *
 * ── What must hold ────────────────────────────────────────────────────────
 * The severity is arithmetic and the sentence is not. A manager filtering for
 * CRITICAL is entitled to know exactly what put a row there, so the band has to
 * come from recorded minutes against configured capacity — never from a model,
 * and never from a model's idea of a number.
 */

const RUN = Math.random().toString(36).slice(2, 8).replace(/[0-9]/g, "z");
const PASSWORD = "day-analysis-password-1234";

let admin: ApiClient;
let instructor: ApiClient;
let myId = "";
let universityId = "";

/* Northfield is Asia/Kolkata, and a work day is judged in the UNIVERSITY's
 * zone — so that is the zone this date is built in, not the machine's. */
const TODAY = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

beforeAll(async () => {
  admin = new ApiClient("admin");
  await admin.login(ACCOUNTS.admin);

  const probe = new ApiClient("probe");
  universityId = (await probe.login(ACCOUNTS.instructorNorth1)).user.universityId!;

  /* Its own instructor. This writes a day and then reads the verdict on it, and
   * doing that to a seeded account would disturb whatever else reads one. */
  const email = `day.analysis.${RUN}@example.edu`;
  const created = await admin.post("/api/instructors", {
    email,
    name: `Day Analysis ${RUN}`,
    password: PASSWORD,
    universityId,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  myId = created.body.instructor.id;

  instructor = new ApiClient("instructor");
  await instructor.login(email, PASSWORD);
});

/**
 * Seeds `ActivityLog` directly, because that is what `analyseDay` reads.
 *
 * It used to post to the entry route. That route now writes `WorklogEntry`, so
 * seeding through it left this module with nothing to analyse — the tests failed
 * for a reason that had nothing to do with what they assert.
 *
 * Writing the table under test directly is the honest fixture while the two
 * models coexist. `analyseDay` and everything it feeds are replaced by the
 * extraction pipeline, and this file goes with them; until then it covers code
 * that six API routes still reach.
 */
async function record(deliverable: string, quantity: string, workingHours: string) {
  const hours = Number(workingHours.replace(/[^0-9.]/g, "")) || 6;
  const activityType = await prisma.activityType.findFirstOrThrow({ select: { id: true } });
  const start = new Date(`${TODAY}T04:00:00.000Z`);

  await prisma.activityLog.deleteMany({
    where: { instructorId: myId, workDate: toDateOnly(TODAY) },
  });
  await prisma.activityLog.create({
    data: {
      instructorId: myId,
      universityId,
      activityTypeId: activityType.id,
      workDate: toDateOnly(TODAY),
      startTime: start,
      endTime: new Date(start.getTime() + hours * 3_600_000),
      rawText: deliverable,
      rawQuantity: quantity,
      remarks: "recorded by the analysis test",
    },
  });
}

describe("a recorded day is read after it is written", () => {
  test("the write itself stores no verdict — analysis is a separate step", async () => {
    await record("Live Class", "2 classes", "6h");

    /* The point of the whole change: a save writes rows and nothing else. With
       background analysis off, nothing has read the day yet, and the column is
       honestly empty rather than showing a stale or invented reading. */
    const before = await prisma.aiInsight.count({
      where: { instructorId: myId, type: DAY_INSIGHT_TYPE },
    });
    expect(before, "a write must not produce a verdict by itself").toBe(0);
  });

  test("analysing it stores one insight, keyed to that day", async () => {
    await analyseDay({ instructorId: myId, universityId, workDate: TODAY });

    const found = await dayInsightsByDate(myId, TODAY, TODAY);
    const insight = found[TODAY];
    expect(insight, "the day should have been analysed").toBeTruthy();
    expect(insight!.date).toBe(TODAY);
  }, 60_000);

  test("the severity is computed, not narrated", async () => {
    const found = await dayInsightsByDate(myId, TODAY, TODAY);
    const data = found[TODAY]!.supportingData as Record<string, unknown>;

    /* Six hours recorded. The band has to follow from that and the university's
       configured capacity, and the snapshot has to carry both so the claim can
       be checked rather than trusted. */
    expect(data.recordedMinutes).toBe(360);
    expect(typeof data.capacityMinutes).toBe("number");

    const capacity = data.capacityMinutes as number;
    if (capacity > 0) {
      const ratio = 360 / capacity;
      const expected =
        ratio < 0.25 ? "CRITICAL" : ratio < 0.5 ? "HIGH" : ratio < 0.8 ? "MEDIUM" : "LOW";
      // MEDIUM is also reachable at high utilisation via unclassified lines, so
      // a LOW expectation is satisfied by either — the bands below it are not.
      if (expected === "LOW") expect(["LOW", "MEDIUM"]).toContain(found[TODAY]!.severity);
      else expect(found[TODAY]!.severity).toBe(expected);
    }
  });

  /* One further pass, not two: the test above already analysed this day, so a
     single re-run is what proves replacement. Each call is a real round trip to
     the provider through `summariseDays`, and stacking them for symmetry's sake
     bought nothing but a timeout. */
  test("re-analysing replaces the verdict rather than stacking another", async () => {
    await analyseDay({ instructorId: myId, universityId, workDate: TODAY });

    const rows = await prisma.aiInsight.count({
      where: { instructorId: myId, type: DAY_INSIGHT_TYPE, periodStart: toDateOnly(TODAY) },
    });
    expect(rows, "a day has one verdict, not a history of them").toBe(1);
  }, 60_000);

  test("a day emptied by a correction loses its verdict", async () => {
    /* Not merely stale — gone. A table that went on reporting a reading of work
       no longer recorded would be asserting something the database contradicts,
       which is worse than saying nothing. */
    await prisma.activityLog.deleteMany({
      where: { instructorId: myId, workDate: toDateOnly(TODAY) },
    });
    await analyseDay({ instructorId: myId, universityId, workDate: TODAY });

    const found = await dayInsightsByDate(myId, TODAY, TODAY);
    expect(found[TODAY], "an emptied day must not keep yesterday's verdict").toBeUndefined();
  }, 60_000);
});
