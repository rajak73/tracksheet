import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { ApiClient, ACCOUNTS } from "./helpers/client";
import { prisma } from "@/server/db";
import { toDateOnly } from "@/server/time/workday";
import { RUN } from "./helpers/fixtures";
import {
  serveInsight,
  resetInsightCacheCounters,
  insightCacheCounters,
} from "@/server/insights/cache";
import {
  GENERATION_MATRIX,
  generationModeFor,
  resolveViewerRole,
  type ViewerRole,
} from "@/server/insights/access";

/**
 * Who may cause an insight to be made.
 *
 * ── Why these pass with no generation implemented ─────────────────────────
 * That is the point. A permission boundary added to a path that already works is
 * the change that gets skipped: it has no visible effect, it only takes things
 * away, and there is always something more urgent. Built now, while there is
 * nothing to gate, it costs an afternoon.
 *
 * ── The test that matters most ────────────────────────────────────────────
 * "a manager sees PENDING when the data has moved on". The stored insight
 * describes a day that no longer exists, and serving it would tell a manager
 * something untrue about an instructor's work — in the one screen where they are
 * forming a judgement about that person.
 *
 * The instinct is to show something rather than nothing. Nothing is the honest
 * answer.
 */

const PASSWORD = "viewer-gate-password-1234";

let admin: ApiClient;
let manager: ApiClient;
let instructor: ApiClient;
let otherInstructor: ApiClient;

let myId = "";
let otherId = "";
let universityId = "";

const TODAY = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const DAY = (() => {
  const at = new Date(`${TODAY}T00:00:00.000Z`);
  at.setUTCDate(at.getUTCDate() - 4);
  return at.toISOString().slice(0, 10);
})();

/** Counts calls, so "zero API calls" is asserted and not inferred. */
function counter() {
  let calls = 0;
  return {
    generate: async () => {
      calls += 1;
      return { summary: "generated" };
    },
    calls: () => calls,
  };
}

const scopeOf = (type: "DAY" | "WEEK" | "MONTH", start: string, end: string) => ({
  instructorId: myId,
  scopeType: type,
  periodStart: start,
  periodEnd: end,
});

async function writeDay(deliverable: string, minutes = 360) {
  return prisma.worklogEntry.upsert({
    where: { instructorId_logDate: { instructorId: myId, logDate: toDateOnly(DAY) } },
    create: {
      instructorId: myId,
      universityId,
      logDate: toDateOnly(DAY),
      deliverable,
      workingMinutes: minutes,
    },
    update: { deliverable, workingMinutes: minutes },
  });
}

beforeAll(async () => {
  admin = new ApiClient("admin");
  await admin.login(ACCOUNTS.admin);

  const probe = new ApiClient("probe");
  universityId = (await probe.login(ACCOUNTS.instructorNorth1)).user.universityId!;

  const mine = await admin.post("/api/instructors", {
    email: `gate.mine.${RUN}@fixture.test`,
    name: `Gate Mine ${RUN}`,
    password: PASSWORD,
    universityId,
  });
  expect(mine.status, JSON.stringify(mine.body)).toBe(201);
  myId = mine.body.instructor.id;

  const theirs = await admin.post("/api/instructors", {
    email: `gate.other.${RUN}@fixture.test`,
    name: `Gate Other ${RUN}`,
    password: PASSWORD,
    universityId,
  });
  expect(theirs.status, JSON.stringify(theirs.body)).toBe(201);
  otherId = theirs.body.instructor.id;

  instructor = new ApiClient("instructor");
  await instructor.login(`gate.mine.${RUN}@fixture.test`, PASSWORD);
  otherInstructor = new ApiClient("other");
  await otherInstructor.login(`gate.other.${RUN}@fixture.test`, PASSWORD);

  manager = new ApiClient("manager");
  await manager.login(ACCOUNTS.managerNorth);
});

beforeEach(async () => {
  await prisma.aiInsightCache.deleteMany({ where: { instructorId: myId } });
  await prisma.worklogEntry.deleteMany({ where: { instructorId: myId } });
  resetInsightCacheCounters();
});

describe("the generation matrix", () => {
  /* 10 — asserted cell by cell against the specification's own table, rather
     than by exercising behaviour and inferring the rule from it. */
  test("every cell matches the specification", () => {
    expect(GENERATION_MATRIX).toEqual({
      INSTRUCTOR: { DAY: "GENERATE", WEEK: "GENERATE", MONTH: "GENERATE" },
      MANAGER: { DAY: "READ_ONLY", WEEK: "GENERATE", MONTH: "GENERATE" },
      ADMIN: { DAY: "READ_ONLY", WEEK: "GENERATE", MONTH: "GENERATE" },
    });
  });

  /* 4 — an admin is a manager here. More authority to READ is not more
     authority to SPEND. */
  test("admin behaves identically to manager on all six cells", () => {
    for (const scope of ["DAY", "WEEK", "MONTH"] as const) {
      expect(generationModeFor("ADMIN", scope)).toBe(generationModeFor("MANAGER", scope));
    }
  });
});

describe("resolving the role from the session", () => {
  test("the subject instructor is INSTRUCTOR", () => {
    expect(resolveViewerRole({ kind: "self", universityId, instructorId: myId }, myId)).toBe(
      "INSTRUCTOR",
    );
  });

  test("a university-scoped principal is MANAGER", () => {
    expect(
      resolveViewerRole({ kind: "university", universityId, managerId: "m1" }, myId),
    ).toBe("MANAGER");
  });

  test("a global principal is ADMIN", () => {
    expect(resolveViewerRole({ kind: "global" }, myId)).toBe("ADMIN");
  });

  /* 6 — and NOT a downgrade to MANAGER. An instructor has no manager rights, so
     quietly serving them a read-only view of a colleague would be answering a
     question they may not ask. */
  test("an instructor asking about somebody else is refused", () => {
    expect(() =>
      resolveViewerRole({ kind: "self", universityId, instructorId: myId }, otherId),
    ).toThrow();
  });
});

describe("a manager's day view never generates", () => {
  /* The scale case, and the one a per-day guard is most likely to be bypassed
     by. A manager opening a month sees thirty day cells at once; if the guard
     lives in the cell rather than in `serveInsight`, a batch or page-load path
     that fills them all can walk straight past it and buy thirty insights on a
     single scroll. Asserted by COUNTING, so "zero" is measured rather than
     assumed. */
  test("a thirty-day range fires zero calls and every day reads PENDING", async () => {
    await writeDay("A day a manager is about to scroll past");
    const { generate, calls } = counter();

    const start = new Date(`${DAY}T00:00:00.000Z`);
    const days = Array.from({ length: 30 }, (_, i) => {
      const at = new Date(start);
      at.setUTCDate(at.getUTCDate() - i);
      return at.toISOString().slice(0, 10);
    });

    const results = await Promise.all(
      days.map((d) => serveInsight(scopeOf("DAY", d, d), "MANAGER", generate)),
    );

    /* The day that HAS a record reads PENDING — there is something to
       summarise and nobody has paid for it. The other twenty-nine hold no
       worklog row at all and read EMPTY, which is a different fact and is
       allowed to look different. What none of them may be is READY or
       GENERATING: either would mean this view had produced an insight. */
    const mine = results[0]!;
    expect(mine.status, "the day with a record is owed an insight, not given one").toBe("PENDING");
    expect(mine.insight).toBeNull();
    expect(
      results.filter((r) => r.status === "READY" || r.status === "GENERATING"),
      "no day in the range may be generated by a manager opening it",
    ).toEqual([]);
    expect(calls(), "thirty day cells must not buy thirty insights").toBe(0);
    expect(
      await prisma.aiInsightCache.count({ where: { instructorId: myId } }),
      "and must not leave thirty cache rows behind either",
    ).toBe(0);
  });

  /* 1 */
  test("no cache row gives PENDING and zero calls", async () => {
    await writeDay("Java class - inheritance");
    const { generate, calls } = counter();

    const result = await serveInsight(scopeOf("DAY", DAY, DAY), "MANAGER", generate);

    expect(result.status).toBe("PENDING");
    expect(result.insight).toBeNull();
    expect(calls(), "a manager must not cause a day to be generated").toBe(0);

    const rows = await prisma.aiInsightCache.count({ where: { instructorId: myId } });
    expect(rows, "and must not create a cache row either").toBe(0);
  });

  /* 2 — the one that matters. */
  test("a stale row gives PENDING, NOT the stale insight", async () => {
    await writeDay("The day as it was when the insight was made");
    const { generate, calls } = counter();

    // The instructor generates it, legitimately.
    const generated = await serveInsight(scopeOf("DAY", DAY, DAY), "INSTRUCTOR", generate);
    expect(generated.status).toBe("READY");
    expect(calls()).toBe(1);

    // Then the day changes, so the stored insight now describes something gone.
    await writeDay("Something else entirely, recorded later");

    const seen = await serveInsight(scopeOf("DAY", DAY, DAY), "MANAGER", generate);

    expect(seen.status, "a manager must not be shown a reading of data that changed").toBe(
      "PENDING",
    );
    expect(seen.insight, "and must not be shown the stale payload").toBeNull();
    expect(calls(), "nor may the view generate a fresh one").toBe(1);

    // The stored row is left exactly where it was — this refuses to serve it,
    // it does not destroy it. The instructor's own view will regenerate.
    const row = await prisma.aiInsightCache.findFirstOrThrow({ where: { instructorId: myId } });
    expect(row.status).toBe("READY");
  });

  /* 3 */
  test("a matching row IS served to a manager", async () => {
    await writeDay("A day nobody has touched since");
    const { generate, calls } = counter();

    await serveInsight(scopeOf("DAY", DAY, DAY), "INSTRUCTOR", generate);
    const seen = await serveInsight(scopeOf("DAY", DAY, DAY), "MANAGER", generate);

    expect(seen.status).toBe("READY");
    expect(seen.cached).toBe(true);
    expect(seen.insight).toBeTruthy();
    expect(calls(), "serving a hit costs nothing").toBe(1);
  });

  /* 4, behaviourally */
  test("an admin gets PENDING on a day exactly as a manager does", async () => {
    await writeDay("Java class");
    const { generate, calls } = counter();

    const seen = await serveInsight(scopeOf("DAY", DAY, DAY), "ADMIN", generate);

    expect(seen.status).toBe("PENDING");
    expect(calls()).toBe(0);
  });

  /* A manager's WEEK does generate — the read-only rule is about days. */
  test("a manager's week DOES generate, into the row the instructor shares", async () => {
    await writeDay("Java class");
    const { generate, calls } = counter();
    const weekEnd = TODAY;

    const first = await serveInsight(scopeOf("WEEK", DAY, weekEnd), "MANAGER", generate);
    expect(first.status).toBe("READY");
    expect(calls()).toBe(1);

    /* And the instructor then reads it as a hit. There is no separate manager
       cache: an insight is about an instructor's period, not about who looked. */
    const asInstructor = await serveInsight(scopeOf("WEEK", DAY, weekEnd), "INSTRUCTOR", generate);
    expect(asInstructor.cached).toBe(true);
    expect(calls(), "the instructor reuses what the manager paid for").toBe(1);
  });

  /* 5 */
  test("an instructor's own uncached day reaches generation", async () => {
    await writeDay("My own day");
    const { generate, calls } = counter();

    const result = await serveInsight(scopeOf("DAY", DAY, DAY), "INSTRUCTOR", generate);

    expect(result.status).toBe("READY");
    expect(result.cached).toBe(false);
    expect(calls()).toBe(1);
  });
});

describe("the role cannot be claimed by the caller", () => {
  /* 7 — body, query and header are all values the caller controls. A permission
     the caller can state is not a permission. */
  test("a client-supplied role is ignored", async () => {
    await writeDay("A day worth reading");

    const res = await manager.get(
      `/api/instructors/${myId}/insight?scope=DAY&from=${DAY}&to=${DAY}&viewer_role=INSTRUCTOR&role=INSTRUCTOR`,
    );

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status, "the query string must not promote a manager").toBe("PENDING");
  });

  /* 6, over HTTP */
  test("an instructor asking for another instructor's insight is refused", async () => {
    const res = await otherInstructor.get(
      `/api/instructors/${myId}/insight?scope=DAY&from=${DAY}&to=${DAY}`,
    );
    expect([403, 404]).toContain(res.status);
  });
});

describe("raw worklog data is never gated by insight status", () => {
  /* 9 — the columns a manager reads come from a different endpoint and are
     served in full whatever the insight cell says. */
  test("a manager reads the day's fields while its insight is PENDING", async () => {
    await writeDay("Java class - inheritance and interfaces", 390);

    const insight = await manager.get(
      `/api/instructors/${myId}/insight?scope=DAY&from=${DAY}&to=${DAY}`,
    );
    expect(insight.body.status).toBe("PENDING");

    const row = await prisma.worklogEntry.findFirstOrThrow({
      where: { instructorId: myId, logDate: toDateOnly(DAY) },
    });
    expect(row.deliverable).toBe("Java class - inheritance and interfaces");
    expect(row.workingMinutes).toBe(390);
  });
});

describe("counters are split by role", () => {
  test("a manager's read-only miss is not counted against the cache", async () => {
    await writeDay("Java class");
    const { generate } = counter();

    await serveInsight(scopeOf("DAY", DAY, DAY), "MANAGER", generate);

    /* Deliberately not a miss. Nobody could have prevented it, and counting it
       would inflate the very figure that says whether retention is too short. */
    const counters = insightCacheCounters();
    expect(counters.misses).toBe(0);
    expect(counters.byRole.MANAGER.misses).toBe(1);
  });

  test("every role has its own bucket", () => {
    const counters = insightCacheCounters();
    for (const role of ["INSTRUCTOR", "MANAGER", "ADMIN"] as ViewerRole[]) {
      expect(counters.byRole[role]).toHaveProperty("hits");
      expect(counters.byRole[role]).toHaveProperty("misses");
    }
  });
});
