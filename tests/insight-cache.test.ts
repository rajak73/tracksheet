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

/** Writes an entry straight to the table — this file is about the cache. */
async function writeEntry(input: { date: string; text: string; hours: number }) {
  const activityType = await prisma.activityType.findFirstOrThrow({ select: { id: true } });
  const start = new Date(`${input.date}T04:00:00.000Z`);
  const end = new Date(start.getTime() + input.hours * 3_600_000);
  return prisma.activityLog.create({
    data: {
      instructorId,
      universityId: (await prisma.instructor.findUniqueOrThrow({
        where: { id: instructorId },
        select: { universityId: true },
      })).universityId,
      activityTypeId: activityType.id,
      workDate: toDateOnly(input.date),
      startTime: start,
      endTime: end,
      rawText: input.text,
      status: "COMPLETED",
    },
  });
}

async function clearDays() {
  await prisma.aiInsightCache.deleteMany({ where: { instructorId } });
  await prisma.activityLog.deleteMany({
    where: { instructorId, workDate: { gte: toDateOnly(day(40)), lte: toDateOnly(TODAY) } },
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
    await writeEntry({ date: D1, text: "Reviewed the OAuth token expiry", hours: 3 });
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
    const entry = await writeEntry({ date: D1, text: "Original description", hours: 3 });
    const { generate, calls } = counter();

    await serveInsight(scope("DAY", D1, D1), generate);
    await prisma.activityLog.update({
      where: { id: entry.id },
      data: { rawText: "A materially different description" },
    });
    const second = await serveInsight(scope("DAY", D1, D1), generate);

    expect(calls(), "changed meaning must regenerate").toBe(2);
    expect(second.cached).toBe(false);
  });

  /* 3 */
  test("touching only updatedAt makes NO new call", async () => {
    const entry = await writeEntry({ date: D1, text: "Unchanged work", hours: 3 });
    const { generate, calls } = counter();

    await serveInsight(scope("DAY", D1, D1), generate);
    // A re-save that changes nothing a reader could notice.
    await prisma.activityLog.update({ where: { id: entry.id }, data: { updatedAt: new Date() } });
    const second = await serveInsight(scope("DAY", D1, D1), generate);

    expect(calls(), "updatedAt is excluded from the context").toBe(1);
    expect(second.cached).toBe(true);
  });

  /* 4 */
  test("database return order makes NO difference", async () => {
    await writeEntry({ date: D1, text: "Bravo task", hours: 2 });
    await writeEntry({ date: D1, text: "Alpha task", hours: 1 });

    /* Built twice; the second time the rows are very likely returned in a
       different physical order after an update rewrites one of them. The
       canonical form sorts, so the bytes must be identical either way. */
    const before = canonicalJson(await buildCanonicalContext(scope("DAY", D1, D1)));
    await prisma.activityLog.updateMany({
      where: { instructorId, workDate: toDateOnly(D1) },
      data: { updatedAt: new Date() },
    });
    const after = canonicalJson(await buildCanonicalContext(scope("DAY", D1, D1)));

    expect(after).toBe(before);
  });

  /* 5 */
  test("whitespace-only changes make NO new call", async () => {
    const entry = await writeEntry({ date: D1, text: "Reviewed the pull request", hours: 2 });
    const { generate, calls } = counter();

    await serveInsight(scope("DAY", D1, D1), generate);
    await prisma.activityLog.update({
      where: { id: entry.id },
      data: { rawText: "  Reviewed   the\n\npull  request  " },
    });
    const second = await serveInsight(scope("DAY", D1, D1), generate);

    expect(calls(), "whitespace cannot change what an insight says").toBe(1);
    expect(second.cached).toBe(true);
  });

  /* 6 */
  test("a new prompt version invalidates every scope", async () => {
    await writeEntry({ date: D1, text: "Work worth summarising", hours: 4 });
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
    await writeEntry({ date: D1, text: "First day of work", hours: 3 });
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
    await writeEntry({ date: D1, text: "More work the same day", hours: 2 });

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
    const entry = await writeEntry({ date: D1, text: "The good day", hours: 3 });
    const { generate } = counter();
    const good = await serveInsight(scope("DAY", D1, D1), generate);
    expect(good.insight).toBeTruthy();

    // Change the data so the next open is a miss, then fail the generation.
    await prisma.activityLog.update({
      where: { id: entry.id },
      data: { rawText: "Something else entirely" },
    });
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
    await writeEntry({ date: D1, text: "Concurrently viewed work", hours: 5 });

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
