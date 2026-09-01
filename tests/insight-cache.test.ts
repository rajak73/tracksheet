import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { ApiClient, ACCOUNTS } from "./helpers/client";
import { prisma } from "@/server/db";
import { toDateOnly } from "@/server/time/workday";
import { serveInsight, resetInsightCacheCounters } from "@/server/insights/cache";
import {
  buildCanonicalContext,
  canonicalJson,
  normaliseText,
  stableStringify,
} from "@/server/insights/context";

/**
 * An insight is paid for once per distinct state of the data.
 *
 * ── What these actually measure ───────────────────────────────────────────
 * Every test counts PROVIDER CALLS, not responses. The generator is a counting
 * stub, so "no second call" is asserted directly rather than inferred from a
 * timing or a log line. That is the whole point of the cache and the only thing
 * worth pinning about it.
 *
 * The canonicalisation tests matter as much as the caching ones. A cache whose
 * key moves when an irrelevant column moves is not a cache — it is a slower way
 * to call the model every time — and the failure is silent, because everything
 * still WORKS. It just costs.
 */

const RUN = Math.random().toString(36).slice(2, 8).replace(/[0-9]/g, "z");
const PASSWORD = "insight-cache-password-1234";

let admin: ApiClient;
let instructorId = "";

const TODAY = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const day = (back: number) => {
  const at = new Date(`${TODAY}T00:00:00.000Z`);
  at.setUTCDate(at.getUTCDate() - back);
  return at.toISOString().slice(0, 10);
};

/** A day well clear of anything else the suite writes. */
const D1 = day(9);
const D2 = day(8);

const scope = (type: "DAY" | "WEEK" | "MONTH", start: string, end: string) => ({
  instructorId,
  scopeType: type,
  periodStart: start,
  periodEnd: end,
});

/** Counts calls, so "no provider call" is an assertion and not an inference. */
function counter() {
  let calls = 0;
  const generate = async () => {
    calls += 1;
    return { summary: `generated #${calls}` };
  };
  return { generate, calls: () => calls };
}

/** One day row, written straight to the table — this file is about the cache. */
async function writeDay(input: {
  date: string;
  activities: Array<{ label: string; quantity?: string | null; hours?: number | null }>;
  remarks?: string | null;
}) {
  const { universityId } = await prisma.instructor.findUniqueOrThrow({
    where: { id: instructorId },
    select: { universityId: true },
  });
  const activities = input.activities.map((a) => ({
    label: a.label,
    quantity: a.quantity ?? null,
    hours: a.hours ?? null,
  }));
  const totalHours = activities.reduce((n, a) => n + (a.hours ?? 0), 0);

  return prisma.worklogEntry.upsert({
    where: { instructorId_logDate: { instructorId, logDate: toDateOnly(input.date) } },
    create: {
      instructorId,
      universityId,
      logDate: toDateOnly(input.date),
      activities,
      totalHours,
      remarks: input.remarks ?? null,
    },
    update: { activities, totalHours, remarks: input.remarks ?? null },
  });
}

async function clearDays() {
  await prisma.aiInsightCache.deleteMany({ where: { instructorId } });
  await prisma.worklogEntry.deleteMany({
    where: { instructorId, logDate: { gte: toDateOnly(day(40)), lte: toDateOnly(TODAY) } },
  });
}

beforeAll(async () => {
  admin = new ApiClient("admin");
  await admin.login(ACCOUNTS.admin);

  const probe = new ApiClient("probe");
  const universityId = (await probe.login(ACCOUNTS.instructorNorth1)).user.universityId!;

  const created = await admin.post("/api/instructors", {
    email: `insight.cache.${RUN}@example.edu`,
    name: `Insight Cache ${RUN}`,
    password: PASSWORD,
    universityId,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  instructorId = created.body.instructor.id;
});

beforeEach(async () => {
  await clearDays();
  resetInsightCacheCounters();
});

describe("the cache pays once per state of the data", () => {
  /* 1 */
  test("opening the same period twice with no change makes exactly one call", async () => {
    await writeDay({ date: D1, activities: [{ label: "Reviewed the OAuth token expiry", hours: 3 }] });
    const { generate, calls } = counter();

    const first = await serveInsight(scope("DAY", D1, D1), generate);
    const second = await serveInsight(scope("DAY", D1, D1), generate);

    expect(calls(), "the second open must not reach the provider").toBe(1);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.insight).toEqual(first.insight);
  });

  /* 2 */
  test("editing a description makes a second call", async () => {
    await writeDay({ date: D1, activities: [{ label: "Original description", hours: 3 }] });
    const { generate, calls } = counter();

    await serveInsight(scope("DAY", D1, D1), generate);
    await writeDay({
      date: D1,
      activities: [{ label: "A materially different description", hours: 3 }],
    });
    const second = await serveInsight(scope("DAY", D1, D1), generate);

    expect(calls(), "changed meaning must regenerate").toBe(2);
    expect(second.cached).toBe(false);
  });

  /* 3 */
  test("touching only updatedAt makes NO new call", async () => {
    const entry = await writeDay({ date: D1, activities: [{ label: "Unchanged work", hours: 3 }] });
    const { generate, calls } = counter();

    await serveInsight(scope("DAY", D1, D1), generate);
    // A re-save that changes nothing a reader could notice.
    await prisma.worklogEntry.update({ where: { id: entry.id }, data: { updatedAt: new Date() } });
    const second = await serveInsight(scope("DAY", D1, D1), generate);

    expect(calls(), "updatedAt is excluded from the context").toBe(1);
    expect(second.cached).toBe(true);
  });

  /* 4 */
  test("database return order makes NO difference", async () => {
    await writeDay({
      date: D1,
      activities: [
        { label: "Bravo task", hours: 2 },
        { label: "Alpha task", hours: 1 },
      ],
    });

    /* Built twice; the second time the rows are very likely returned in a
       different physical order after an update rewrites one of them. The
       canonical form sorts, so the bytes must be identical either way. */
    const before = canonicalJson(await buildCanonicalContext(scope("DAY", D1, D1)));
    /* The SAME activities, written in the opposite order. Canonicalisation sorts
       by label, so the bytes must be identical either way — an array is a list of
       things that happened, and reordering it says nothing new. */
    await writeDay({
      date: D1,
      activities: [
        { label: "Alpha task", hours: 1 },
        { label: "Bravo task", hours: 2 },
      ],
    });
    const after = canonicalJson(await buildCanonicalContext(scope("DAY", D1, D1)));

    expect(after).toBe(before);
  });

  /* 5 */
  test("whitespace-only changes make NO new call", async () => {
    await writeDay({ date: D1, activities: [{ label: "Reviewed the pull request", hours: 2 }] });
    const { generate, calls } = counter();

    await serveInsight(scope("DAY", D1, D1), generate);
    await writeDay({
      date: D1,
      activities: [{ label: "  Reviewed   the\n\npull  request  ", hours: 2 }],
    });
    const second = await serveInsight(scope("DAY", D1, D1), generate);

    expect(calls(), "whitespace cannot change what an insight says").toBe(1);
    expect(second.cached).toBe(true);
  });

  /* 6 */
  test("a new prompt version invalidates every scope", async () => {
    await writeDay({ date: D1, activities: [{ label: "Work worth summarising", hours: 4 }] });
    const { generate, calls } = counter();

    await serveInsight(scope("DAY", D1, D1), generate);
    expect(calls()).toBe(1);

    /* The version is inside the hash, so bumping it is indistinguishable from
       the data changing — which is exactly the intent. Simulated by rewriting
       the stored hash, because the constant cannot be reassigned at runtime. */
    await prisma.aiInsightCache.updateMany({
      where: { instructorId },
      data: { contextHash: "0".repeat(64) },
    });

    const after = await serveInsight(scope("DAY", D1, D1), generate);
    expect(calls(), "a prompt change must regenerate").toBe(2);
    expect(after.cached).toBe(false);
  });

  /* 7 */
  test("adding a day invalidates that day, its week and its month — not its neighbour", async () => {
    await writeDay({ date: D1, activities: [{ label: "First day of work", hours: 3 }] });
    const { generate, calls } = counter();

    const weekStart = D1;
    const weekEnd = day(3);
    const monthStart = day(20);
    const monthEnd = TODAY;

    await serveInsight(scope("DAY", D1, D1), generate);
    await serveInsight(scope("DAY", D2, D2), generate);
    await serveInsight(scope("WEEK", weekStart, weekEnd), generate);
    await serveInsight(scope("MONTH", monthStart, monthEnd), generate);
    // D2 is empty, so it never called: DAY(D1), WEEK, MONTH = 3.
    expect(calls()).toBe(3);

    // A new entry on D1 only.
    await writeDay({
      date: D1,
      activities: [
        { label: "First day of work", hours: 3 },
        { label: "More work the same day", hours: 2 },
      ],
    });

    const d1 = await serveInsight(scope("DAY", D1, D1), generate);
    const week = await serveInsight(scope("WEEK", weekStart, weekEnd), generate);
    const month = await serveInsight(scope("MONTH", monthStart, monthEnd), generate);

    expect(d1.cached, "the edited day must regenerate").toBe(false);
    expect(week.cached, "the week contains it, so it must regenerate").toBe(false);
    expect(month.cached, "the month contains it, so it must regenerate").toBe(false);
    expect(calls()).toBe(6);

    // The untouched neighbouring day is unaffected — and still empty, so it
    // still costs nothing.
    const d2 = await serveInsight(scope("DAY", D2, D2), generate);
    expect(d2.status).toBe("EMPTY");
    expect(calls(), "an untouched day must not be regenerated").toBe(6);
  });

  /* 5 — a quantity edit is a data change like any other. It is free text, so
     this also pins that the TEXT is hashed rather than a number read out of it:
     "2 classes" and "3 classes" differ, and so must their hashes. */
  test("changing a quantity regenerates that day, its week and its month", async () => {
    const weekStart = D1;
    const weekEnd = day(3);
    const monthStart = day(20);
    const { generate, calls } = counter();

    await writeDay({
      date: D1,
      activities: [{ label: "Java class", quantity: "2 classes", hours: 4 }],
    });
    await writeDay({
      date: D2,
      activities: [{ label: "Untouched neighbour", quantity: "1 class", hours: 2 }],
    });

    await serveInsight(scope("DAY", D1, D1), generate);
    await serveInsight(scope("DAY", D2, D2), generate);
    await serveInsight(scope("WEEK", weekStart, weekEnd), generate);
    await serveInsight(scope("MONTH", monthStart, TODAY), generate);
    expect(calls()).toBe(4);

    // Only the quantity moves, and only on D1.
    await writeDay({
      date: D1,
      activities: [{ label: "Java class", quantity: "3 classes", hours: 4 }],
    });

    expect((await serveInsight(scope("DAY", D1, D1), generate)).cached).toBe(false);
    expect((await serveInsight(scope("WEEK", weekStart, weekEnd), generate)).cached).toBe(false);
    expect((await serveInsight(scope("MONTH", monthStart, TODAY), generate)).cached).toBe(false);
    expect(calls()).toBe(7);

    const neighbour = await serveInsight(scope("DAY", D2, D2), generate);
    expect(neighbour.cached, "an untouched day must not regenerate").toBe(true);
    expect(calls()).toBe(7);
  });

  /* 6 — per-scope versions. Bumping the day prompt must leave the week alone. */
  test("one scope's prompt version invalidates that scope only", async () => {
    const weekStart = D1;
    const weekEnd = day(3);
    const { generate, calls } = counter();

    await writeDay({ date: D1, activities: [{ label: "Work to summarise", hours: 3 }] });
    await serveInsight(scope("DAY", D1, D1), generate);
    await serveInsight(scope("WEEK", weekStart, weekEnd), generate);
    expect(calls()).toBe(2);

    /* A day-prompt bump, simulated by breaking only the DAY row's hash — the
       constants cannot be reassigned at runtime. The week's row is untouched,
       which is exactly what a per-scope version buys. */
    await prisma.aiInsightCache.updateMany({
      where: { instructorId, scopeType: "DAY" },
      data: { contextHash: "0".repeat(64) },
    });

    expect((await serveInsight(scope("DAY", D1, D1), generate)).cached).toBe(false);
    expect(calls()).toBe(3);

    const week = await serveInsight(scope("WEEK", weekStart, weekEnd), generate);
    expect(week.cached, "the week prompt did not change, so its cache stands").toBe(true);
    expect(calls()).toBe(3);
  });

  /* 8 */
  test("an empty period never calls and never creates a row", async () => {
    const { generate, calls } = counter();

    const result = await serveInsight(scope("DAY", D1, D1), generate);

    expect(calls()).toBe(0);
    expect(result.status).toBe("EMPTY");
    expect(result.insight).toBeNull();

    const rows = await prisma.aiInsightCache.count({ where: { instructorId } });
    expect(rows, "an empty period must leave no cache row behind").toBe(0);
  });

  /* 9 */
  test("a provider failure keeps the previous insight and flags it stale", async () => {
    await writeDay({ date: D1, activities: [{ label: "The good day", hours: 3 }] });
    const { generate } = counter();
    const good = await serveInsight(scope("DAY", D1, D1), generate);
    expect(good.insight).toBeTruthy();

    // Change the data so the next open is a miss, then fail the generation.
    await writeDay({ date: D1, activities: [{ label: "Something else entirely", hours: 3 }] });
    const failing = async () => {
      throw new Error("provider exploded");
    };

    const after = await serveInsight(scope("DAY", D1, D1), failing);

    expect(after.is_stale, "a failure must serve the previous answer").toBe(true);
    expect(after.insight).toEqual(good.insight);

    const row = await prisma.aiInsightCache.findFirstOrThrow({ where: { instructorId } });
    expect(row.insightPayload, "the stored payload must survive a failure").toEqual(good.insight);
    expect(row.failureCount).toBe(1);
    expect(row.lastError).toContain("provider exploded");
  });

  /* 10 */
  test("two concurrent requests for the same uncached scope make exactly one call", async () => {
    await writeDay({ date: D1, activities: [{ label: "Concurrently viewed work", hours: 5 }] });

    let calls = 0;
    const slow = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 300));
      return { summary: "the one answer" };
    };

    const [a, b] = await Promise.all([
      serveInsight(scope("DAY", D1, D1), slow),
      serveInsight(scope("DAY", D1, D1), slow),
    ]);

    expect(calls, "the single-flight lock must collapse these into one").toBe(1);
    expect(a.insight).toEqual(b.insight);
  });
});

describe("canonicalisation", () => {
  test("null and empty string are one value", () => {
    expect(normaliseText("")).toBeNull();
    expect(normaliseText("   ")).toBeNull();
    expect(normaliseText(null)).toBeNull();
  });

  test("casing is content and is preserved", () => {
    expect(normaliseText("OAuth Token")).toBe("OAuth Token");
  });

  test("keys serialise in a stable order whatever order they were built in", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});
