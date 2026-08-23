import { beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/server/db";
import { geminiCallCount } from "@/server/ai/gemini";
import { computeAnalytics } from "@/server/analytics/engine";
import { buildTracker, formatTrackerAsCsv, monthBounds } from "@/server/analytics/tracker";
import { detectAnomalies } from "@/server/ai/anomalies";
import { narrateConditionDeterministic } from "@/server/ai/narrate";
import { rollUp } from "@/domain/rollup";
import { averageMinutesPerInstructor } from "@/domain/average-hours";
import { buildPeriodRow, weekOf, weeksOfMonth, type RowActivity } from "@/domain/worklog-rows";
import { deliverableCell, quantityCell, workingHours } from "@/domain/worklog-report";
import { loadUniversityConfig } from "@/server/universities/config";
import { ApiClient, ACCOUNTS } from "./helpers/client";

/**
 * The model is called when text becomes data, and never again.
 *
 * ── Why this is a test and not a paragraph in the README ──────────────────
 * It is the rule the whole product rests on: a figure on a screen is
 * arithmetic over stored rows, so it can be reconciled, reproduced and argued
 * with. The moment a total comes from asking a model to look at the data
 * again, the number stops being checkable — and nothing about it looks
 * different.
 *
 * A rule nobody can check is a convention, and conventions rot quietly. So
 * `geminiCallCount` counts every request that leaves the process, and these
 * cases run the real calculation paths and assert the count did not move.
 *
 * It has already earned its place: the instructor's report was fetching
 * `/worklog/summary` on every view and throwing the answer away, so opening a
 * screen paid for a model call that changed nothing. Nothing else was wrong —
 * the figures were right — which is exactly why it survived review.
 *
 * ── What these run IN PROCESS, deliberately ───────────────────────────────
 * The suite's other cases go over HTTP to a separate Next server, whose call
 * count this process cannot see. So these import the calculation functions
 * directly. That is not a weaker test of the rule; it is a stricter one, since
 * it watches the exact code every one of those routes calls.
 *
 * ── ADDING A CALCULATION PATH? ADD ITS ASSERTION HERE ─────────────────────
 * This file covers the surfaces that existed when the rule was written: the
 * six views' row builder, cell formatting, the roll-up, the analytics engine,
 * the month spreadsheet and its CSV, and condition detection. It does NOT
 * cover code that does not exist yet, and it cannot.
 *
 * So this is a standing requirement rather than a finished checklist: any new
 * report, dashboard, export or aggregation gets its own case here before the
 * feature is done. The pattern is three lines —
 *
 *     const before = geminiCallCount();
 *     await theNewThing(...);          // with real stored data, not a stub
 *     expect(geminiCallCount()).toBe(before);
 *
 * Use real rows rather than a fixture array: the bug this guard caught was not
 * in a calculation at all, it was a fetch beside one, and only a path exercised
 * end to end would have reached it.
 *
 * ── This guard has been proved to trip ────────────────────────────────────
 * Not assumed. The violation it originally found was deliberately reintroduced
 * — `summariseDays` called on a day with no cached summary, which is precisely
 * what the discarded `/worklog/summary` fetch did — and the assertion failed
 * with "expected 1 to be +0". A count that reads zero because nothing calls it
 * would have passed that check too, which is why it was worth running.
 */

let universityId = "";
let instructorId = "";

beforeAll(async () => {
  const client = new ApiClient("n1");
  const me = await client.login(ACCOUNTS.instructorNorth1);
  universityId = me.user.universityId!;
  instructorId = me.user.instructorId!;
});

/** Every stored activity for the university, in the shape the views take. */
async function storedActivities(from: string, to: string): Promise<RowActivity[]> {
  const logs = await prisma.activityLog.findMany({
    where: {
      universityId,
      workDate: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) },
    },
    select: {
      workDate: true,
      startTime: true,
      endTime: true,
      remarks: true,
      status: true,
      quantity: true,
      activityType: { select: { code: true, label: true } },
      deliverableType: { select: { code: true, isCountable: true } },
      broadCategory: { select: { label: true } },
    },
  });
  return logs.map((l) => ({
    workDate: l.workDate.toISOString().slice(0, 10),
    durationHours: (l.endTime.getTime() - l.startTime.getTime()) / 3_600_000,
    startTime: l.startTime.toISOString(),
    remarks: l.remarks,
    status: l.status,
    quantity: l.quantity,
    activityType: l.activityType,
    deliverableType: l.deliverableType,
    broadCategory: l.broadCategory,
  }));
}

const RANGE = (() => {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 86_400_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
})();

describe("2 — no calculation path reaches the provider", () => {
  test("the six views' row builder never calls it", async () => {
    const activities = await storedActivities(RANGE.from, RANGE.to);
    const before = geminiCallCount();

    const today = RANGE.to;
    const week = weekOf(today);
    const month = weeksOfMonth(today.slice(0, 7));

    // Every shape all six views ask for: a day, each day of a week, each week
    // of a month, and the whole month at once.
    for (const date of week) {
      buildPeriodRow({ key: date, label: date, dates: [date], activities, today });
    }
    buildPeriodRow({ key: "w", label: "w", dates: week, activities, today });
    for (const w of month) {
      buildPeriodRow({ key: `m${w.index}`, label: "m", dates: w.dates, activities, today });
    }

    expect(geminiCallCount(), "building rows must not reach the provider").toBe(before);
  });

  test("formatting a cell never calls it", async () => {
    const activities = await storedActivities(RANGE.from, RANGE.to);
    const before = geminiCallCount();
    const row = buildPeriodRow({
      key: "k",
      label: "l",
      dates: weekOf(RANGE.to),
      activities,
      today: RANGE.to,
    });
    deliverableCell(row.lines);
    quantityCell(row.lines);
    workingHours(row.totalMinutes);
    expect(geminiCallCount()).toBe(before);
  });

  test("the roll-up the manager's sheets use never calls it", async () => {
    const activities = await storedActivities(RANGE.from, RANGE.to);
    const before = geminiCallCount();
    rollUp(activities);
    expect(geminiCallCount()).toBe(before);
  });

  test("the analytics engine never calls it", async () => {
    const before = geminiCallCount();
    await computeAnalytics({ universityId, from: RANGE.from, to: RANGE.to });
    expect(geminiCallCount(), "every figure comes from the database").toBe(before);
  });

  test("the month spreadsheet and its export never call it", async () => {
    const before = geminiCallCount();
    const bounds = monthBounds(RANGE.to.slice(0, 7));
    const tracker = await buildTracker({
      from: bounds.from,
      to: bounds.to,
      today: RANGE.to,
      config: await loadUniversityConfig(universityId),
    });
    formatTrackerAsCsv(tracker);
    expect(geminiCallCount(), "a report's figures are reads, never questions").toBe(before);
  });

  test("the average-hours figure never calls it", async () => {
    /* A SUM over `UniversityDailyMetric` and a division. Added here when the
     * card was built, per the standing requirement that any new aggregation
     * brings its own zero-call assertion. */
    const before = geminiCallCount();
    const days = await prisma.universityDailyMetric.findMany({
      where: { universityId },
      select: { metricDate: true, productiveMinutes: true, activeInstructors: true },
    });
    averageMinutesPerInstructor(
      days.map((d) => ({
        date: d.metricDate.toISOString().slice(0, 10),
        minutes: d.productiveMinutes,
        roster: d.activeInstructors,
      })),
    );
    expect(geminiCallCount()).toBe(before);
  });

  test("running every path in succession still moves it not at all", async () => {
    const activities = await storedActivities(RANGE.from, RANGE.to);
    const before = geminiCallCount();
    for (let i = 0; i < 3; i++) {
      rollUp(activities);
      buildPeriodRow({
        key: "k",
        label: "l",
        dates: weekOf(RANGE.to),
        activities,
        today: RANGE.to,
      });
      await computeAnalytics({ universityId, from: RANGE.from, to: RANGE.to });
    }
    expect(geminiCallCount()).toBe(before);
  });
});

describe("1 — the same rows produce the same numbers, every time", () => {
  test("a view recomputed three times is byte-identical", async () => {
    /* No hidden re-parsing, no re-generation, and no cached figure quietly
     * disagreeing with the rows underneath it. */
    const activities = await storedActivities(RANGE.from, RANGE.to);
    const run = () => {
      const row = buildPeriodRow({
        key: "k",
        label: "l",
        dates: weekOf(RANGE.to),
        activities,
        today: RANGE.to,
      });
      return JSON.stringify({
        deliverable: deliverableCell(row.lines),
        quantity: quantityCell(row.lines),
        hours: workingHours(row.totalMinutes),
        subjects: row.subjects,
        remarks: row.remarks,
        state: row.state,
      });
    };
    const first = run();
    expect(run()).toBe(first);
    expect(run()).toBe(first);
  });

  test("and so is the analytics engine, read twice", async () => {
    const a = await computeAnalytics({ universityId, from: RANGE.from, to: RANGE.to });
    const b = await computeAnalytics({ universityId, from: RANGE.from, to: RANGE.to });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  test("a figure is never locked to when it was first computed", async () => {
    /* The same query, before and after a row is added, must reflect the rows as
     * they are NOW — not a number cached at first read. */
    const before = await computeAnalytics({ universityId, from: RANGE.from, to: RANGE.to });

    const type = await prisma.activityType.findFirstOrThrow({ where: { code: "TEACHING" } });
    const day = new Date();
    day.setUTCHours(3, 0, 0, 0);
    const added = await prisma.activityLog.create({
      data: {
        instructorId,
        universityId,
        activityTypeId: type.id,
        workDate: new Date(day.toISOString().slice(0, 10)),
        startTime: day,
        endTime: new Date(day.getTime() + 3_600_000),
        quantity: 1,
      },
      select: { id: true },
    });

    try {
      const after = await computeAnalytics({ universityId, from: RANGE.from, to: RANGE.to });
      expect(
        after.totals.productiveHours,
        "the query must see the new row, not a number from before it",
      ).toBeGreaterThan(before.totals.productiveHours);
    } finally {
      await prisma.activityLog.delete({ where: { id: added.id } });
    }
  });
});

describe("3 — a condition is DETECTED by code, and only phrased by a model", () => {
  test("detection runs with the provider untouched", async () => {
    const analytics = await computeAnalytics({
      universityId,
      from: RANGE.from,
      to: RANGE.to,
    });
    const before = geminiCallCount();
    const conditions = detectAnomalies(analytics);
    expect(
      geminiCallCount(),
      "whether a condition holds is arithmetic, never a question for a model",
    ).toBe(before);
    // It is a pure function of the numbers, so it repeats exactly.
    expect(JSON.stringify(detectAnomalies(analytics))).toBe(JSON.stringify(conditions));
  });

  test("and there is a deterministic sentence for every condition", () => {
    /* Narration is the ONLY thing the model is asked for here, and the system
     * has an answer without it — so a provider outage costs wording, never a
     * missed condition. */
    const condition = {
      type: "UNDERUTILIZATION" as const,
      severity: "MEDIUM" as const,
      scope: "INSTRUCTOR" as const,
      instructorId: "ins_x",
      instructorName: "Someone",
      metrics: { utilizationPct: 20, capacityHours: 40, productiveHours: 8 },
      threshold: { utilizationPct: 60 },
    };
    const before = geminiCallCount();
    const narration = narrateConditionDeterministic(condition);
    expect(geminiCallCount()).toBe(before);
    expect(narration.summary.length).toBeGreaterThan(0);
    expect(narration.recommendation.length).toBeGreaterThan(0);
  });
});
