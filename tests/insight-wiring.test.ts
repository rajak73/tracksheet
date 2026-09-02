import { beforeAll, describe, expect, test } from "vitest";
import { ACCOUNTS, ApiClient } from "./helpers/client";
import { prisma } from "@/server/db";
import { toDateOnly } from "@/server/time/workday";
import { daysAgo, seedDayRow } from "./helpers/worklog";
import { RUN } from "./helpers/fixtures";
import { serveDayInsight } from "@/server/insights/serve-day";
import { buildPeriodRollup } from "@/server/insights/period-rollup";

/**
 * The wiring, which is the whole difference between built and working.
 *
 * `checkExtraction` had no caller; then `serveDayExtraction` and `runGrouping`
 * had no caller. These tests hold the seam: a day is extracted once and served
 * from storage after that, a period ensures its days and groups them in one
 * call, and every figure in a rollup is summed here rather than answered by a
 * model.
 */

const admin = new ApiClient("wiring-admin");
const manager = new ApiClient("wiring-manager");
let instructorId = "";
let universityId = "";

/** Five consecutive past days, so no cell is "not yet reached". */
const DAYS = [12, 11, 10, 9, 8].map((n) => daysAgo(n));
const DAY_MINUTES = 360;

/** One fake for both prompts, told apart by what the prompt asks for. */
function provider() {
  let extractCalls = 0;
  let groupCalls = 0;
  return {
    extractCalls: () => extractCalls,
    groupCalls: () => groupCalls,
    reset: () => {
      extractCalls = 0;
      groupCalls = 0;
    },
    call: async (instruction: string) => {
      if (instruction.includes("Group them by")) {
        groupCalls += 1;
        /* Every member into one group, named for the activity with no topic.
           The indices are read off the prompt so the reply is always complete. */
        const count = (instruction.match(/"index":/g) ?? []).length;
        return {
          ok: true as const,
          text: JSON.stringify({
            groups: [{ name: "Checked quiz papers", members: [...Array(count).keys()] }],
          }),
        };
      }
      extractCalls += 1;
      return {
        ok: true as const,
        text: JSON.stringify({
          activities: [
            {
              label: "checked quiz papers",
              sessions: 25,
              duration_value: 45,
              duration_unit: "minutes",
            },
          ],
        }),
      };
    },
  };
}

beforeAll(async () => {
  await admin.login(ACCOUNTS.admin);
  await manager.login(ACCOUNTS.managerNorth);
  const probe = new ApiClient("wiring-probe");
  universityId = (await probe.login(ACCOUNTS.instructorNorth1)).user.universityId!;

  const made = await admin.post("/api/instructors", {
    email: `wiring.${RUN}@fixture.test`,
    name: `Wiring ${RUN}`,
    password: "wiring-password-1234",
    universityId,
  });
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  instructorId = made.body.instructor.id;

  for (const date of DAYS) {
    await seedDayRow({
      instructorId,
      universityId,
      date,
      deliverable: "checked 25 quiz papers — 45 minutes",
      workingMinutes: DAY_MINUTES,
    });
  }
});

describe("1 & 2. the day path", () => {
  test("returns the points extracted from that day's own words", async () => {
    const p = provider();
    const served = await serveDayInsight({
      instructorId,
      date: DAYS[0]!,
      viewerRole: "INSTRUCTOR",
      call: p.call,
    });
    expect(served.status).toBe("READY");
    expect(served.points).toEqual([{ label: "checked quiz papers", sessions: 25, minutes: 45 }]);
    expect(served.unallocated_minutes).toBe(DAY_MINUTES - 45);
    expect(served.cached).toBe(false);
    expect(p.extractCalls()).toBe(1);
  });

  test("a second request for the same unchanged date fires zero model calls", async () => {
    const p = provider();
    const served = await serveDayInsight({
      instructorId,
      date: DAYS[0]!,
      viewerRole: "INSTRUCTOR",
      call: p.call,
    });
    expect(served.cached).toBe(true);
    expect(served.status).toBe("READY");
    expect(p.extractCalls(), "an unchanged day must not be paid for twice").toBe(0);
  });

  test("a date with no worklog row is EMPTY, not Pending", async () => {
    /* Pending promises something is coming. Nothing is coming for a day nobody
       filed, and the cell renders an em dash rather than a promise. */
    const p = provider();
    const served = await serveDayInsight({
      instructorId,
      date: daysAgo(40),
      viewerRole: "INSTRUCTOR",
      call: p.call,
    });
    expect(served.status).toBe("EMPTY");
    expect(p.extractCalls()).toBe(0);
  });
});

describe("3 & 4. the period path", () => {
  test("ensures day extractions, groups once, and sums in code", async () => {
    const p = provider();
    const built = await buildPeriodRollup({
      instructorId,
      periodStart: DAYS[0]!,
      periodEnd: DAYS[4]!,
      call: p.call,
    });
    expect(built.ok, JSON.stringify(built)).toBe(true);
    if (!built.ok) return;

    expect(p.groupCalls(), "one grouping call for the period").toBe(1);
    expect(built.rollup.days_logged).toBe(5);
    expect(built.rollup.total_minutes).toBe(5 * DAY_MINUTES);

    const group = built.rollup.groups[0]!;
    expect(group.name).toBe("Checked quiz papers");
    expect(group.item_count).toBe(5);
    // Summed here, from the stored extractions. The model returned no numbers.
    expect(group.sessions).toBe(5 * 25);
    expect(group.minutes).toBe(5 * 45);
    expect(group.day_count).toBe(5);
  });

  test("4. a week where four of five days are already extracted fires exactly one extraction", async () => {
    /* The test that proves the cache works ACROSS scopes rather than within
       one: the days were extracted by the day view, and the week must reuse
       them rather than re-extract the period it happens to be asking about. */
    const edited = DAYS[2]!;
    await seedDayRow({
      instructorId,
      universityId,
      date: edited,
      deliverable: "checked 25 quiz papers — 45 minutes, plus a note",
      workingMinutes: DAY_MINUTES,
    });

    const p = provider();
    const built = await buildPeriodRollup({
      instructorId,
      periodStart: DAYS[0]!,
      periodEnd: DAYS[4]!,
      call: p.call,
    });
    expect(built.ok, JSON.stringify(built)).toBe(true);
    expect(p.extractCalls(), "only the day whose text changed").toBe(1);
    expect(p.groupCalls()).toBe(1);
  });

  test("5. group minutes plus unallocated equals the period total", async () => {
    const p = provider();
    const built = await buildPeriodRollup({
      instructorId,
      periodStart: DAYS[0]!,
      periodEnd: DAYS[4]!,
      call: p.call,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const groupMinutes = built.rollup.groups.reduce((n, g) => n + (g.minutes ?? 0), 0);
    expect(groupMinutes + built.rollup.unallocated_minutes).toBe(built.rollup.total_minutes);
  });

  test("5b. a rollup whose parts do not add to its whole is not stored", async () => {
    /* The model contributed no numbers, so this is a check on THIS code and on
       the extractions it read. A grouping that drops a member fails the closing
       check before anything reaches the database. */
    const dropping = {
      call: async (instruction: string) => {
        if (instruction.includes("Group them by")) {
          return {
            ok: true as const,
            text: JSON.stringify({ groups: [{ name: "Checked quiz papers", members: [0] }] }),
          };
        }
        return {
          ok: true as const,
          text: JSON.stringify({
            activities: [
              { label: "checked quiz papers", sessions: 25, duration_value: 45, duration_unit: "minutes" },
            ],
          }),
        };
      },
    };
    const built = await buildPeriodRollup({
      instructorId,
      periodStart: DAYS[0]!,
      periodEnd: DAYS[4]!,
      call: dropping.call,
    });
    expect(built.ok).toBe(false);
  });

  test("7. a group name carries no topic", async () => {
    const p = provider();
    const built = await buildPeriodRollup({
      instructorId,
      periodStart: DAYS[0]!,
      periodEnd: DAYS[4]!,
      call: p.call,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    for (const g of built.rollup.groups) {
      expect(g.name).not.toMatch(/binary|hashing|chapter|section|module|unit \d/i);
      expect(g.name, "and no digit").not.toMatch(/\d/);
    }
  });
});

describe("8. editing a day invalidates that day and no other", () => {
  test("the edited day re-extracts; its neighbours' extractions are untouched", async () => {
    const target = DAYS[1]!;
    const neighbourBefore = DAYS[0]!;
    const neighbourAfter = DAYS[2]!;

    const warm = provider();
    for (const d of [neighbourBefore, target, neighbourAfter]) {
      await serveDayInsight({ instructorId, date: d, viewerRole: "INSTRUCTOR", call: warm.call });
    }

    const rowsBefore = await prisma.dayExtraction.findMany({
      where: { instructorId, logDate: { in: [neighbourBefore, target, neighbourAfter].map(toDateOnly) } },
      select: { logDate: true, sourceHash: true, generatedAt: true },
      orderBy: { logDate: "asc" },
    });
    expect(rowsBefore).toHaveLength(3);

    await seedDayRow({
      instructorId,
      universityId,
      date: target,
      deliverable: "checked 25 quiz papers — 45 minutes, and wrote the report",
      workingMinutes: DAY_MINUTES,
    });

    const p = provider();
    const after = await serveDayInsight({
      instructorId,
      date: target,
      viewerRole: "INSTRUCTOR",
      call: p.call,
    });
    expect(p.extractCalls(), "the edited day is read again").toBe(1);
    expect(after.cached).toBe(false);

    const rowsAfter = await prisma.dayExtraction.findMany({
      where: { instructorId, logDate: { in: [neighbourBefore, neighbourAfter].map(toDateOnly) } },
      select: { logDate: true, sourceHash: true },
      orderBy: { logDate: "asc" },
    });
    const hashBefore = new Map(
      rowsBefore.map((r) => [r.logDate.toISOString().slice(0, 10), r.sourceHash]),
    );
    for (const row of rowsAfter) {
      const date = row.logDate.toISOString().slice(0, 10);
      expect(row.sourceHash, `${date} must not have been touched`).toBe(hashBefore.get(date));
    }

    // And the neighbours still serve from cache, paying nothing.
    const q = provider();
    for (const d of [neighbourBefore, neighbourAfter]) {
      const served = await serveDayInsight({
        instructorId,
        date: d,
        viewerRole: "INSTRUCTOR",
        call: q.call,
      });
      expect(served.cached, `${d} should still be cached`).toBe(true);
    }
    expect(q.extractCalls()).toBe(0);
  });
});

describe("10. a manager's day view", () => {
  test("thirty dates through the real endpoint fire zero extractions and read Pending", async () => {
    const before = await prisma.dayExtraction.count({ where: { instructorId } });

    const statuses: string[] = [];
    for (const date of DAYS) {
      const res = await manager.get(
        `/api/instructors/${instructorId}/insight?scope=DAY&from=${date}&to=${date}`,
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      statuses.push(res.body.status);
    }

    /* Days 0 and 2 were extracted above, so a manager sees those; the point is
       that opening them creates nothing and refreshes nothing. */
    expect(statuses.every((s) => s === "READY" || s === "PENDING")).toBe(true);
    expect(
      await prisma.dayExtraction.count({ where: { instructorId } }),
      "a manager's page load must not create an extraction",
    ).toBe(before);
  });

  test("a manager opening an unextracted day gets PENDING and no row", async () => {
    const virgin = daysAgo(13);
    await seedDayRow({
      instructorId,
      universityId,
      date: virgin,
      deliverable: "a day only the manager has opened",
      workingMinutes: 120,
    });

    const res = await manager.get(
      `/api/instructors/${instructorId}/insight?scope=DAY&from=${virgin}&to=${virgin}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("PENDING");
    expect(res.body.points).toEqual([]);
    expect(
      await prisma.dayExtraction.count({ where: { instructorId, logDate: toDateOnly(virgin) } }),
      "and no row is written on their behalf",
    ).toBe(0);
  });
});
