import { beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/server/db";
import { ApiClient, ACCOUNTS } from "./helpers/client";
import { averageActiveMinutes, formatActiveAverage } from "@/domain/average-hours";
import { geminiCallCount } from "@/server/ai/gemini";
import { workDateFor } from "@/server/time/workday";

/**
 * Active-Instructor Average Hours — the confirmed, final formula.
 *
 * ── The number this whole file exists to pin down ──────────────────────────
 * Σ(active minutes, every day) ÷ Σ(active instructor count, every day). ONE
 * sum, ONE sum, ONE division — not an average of daily averages, and not the
 * whole roster. Both alternatives were built first and explicitly superseded;
 * see `src/domain/average-hours.ts` for why. The worked example below is the
 * one named in the spec this feature was built against, and it is chosen so
 * that the confirmed formula, the average-of-daily-averages method, and a
 * roster-style method all give three DIFFERENT answers on the same data —
 * so a test that merely checks "some plausible number came back" cannot pass
 * by accident.
 *
 *   confirmed (sum ÷ sum)          1605 ÷ 12  = 133.75 minutes
 *   average of daily averages      (142.5+130+165+120+120) ÷ 5 = 135.5
 *   unique-instructors × days      1605 ÷ 15  = 107 minutes (1h 47m)
 */

let admin: ApiClient;
let universityId = "";
const RUN = Math.random().toString(36).slice(2, 8).replace(/[0-9]/g, "x");

/* A settled month in the past, so nothing here depends on the hour it runs.
 * 2026-05-04 is a Monday. */
const MON = "2026-05-04";
const TUE = "2026-05-05";
const WED = "2026-05-06";
const THU = "2026-05-07";
const FRI = "2026-05-08";
const SAT = "2026-05-09"; // explicit zero-activity day, inside the same week
const LATER = "2026-05-25"; // a second week, inside the same month

async function metric(date: string, activeMinutes: number, activeCount: number) {
  await prisma.universityDailyMetric.upsert({
    where: { universityId_metricDate: { universityId, metricDate: new Date(`${date}T00:00:00.000Z`) } },
    create: {
      universityId,
      metricDate: new Date(`${date}T00:00:00.000Z`),
      activeInstructorMinutes: activeMinutes,
      activeInstructorCount: activeCount,
    },
    update: { activeInstructorMinutes: activeMinutes, activeInstructorCount: activeCount },
  });
}

beforeAll(async () => {
  admin = new ApiClient("admin");
  await admin.login(ACCOUNTS.admin);

  const created = await admin.post("/api/universities", {
    name: `Active Average Test ${RUN}`,
    slug: `active-average-test-${RUN}`,
    code: `AAT${RUN.slice(0, 3).toUpperCase()}`,
    timezone: "Asia/Kolkata",
    // The API wants all seven; Mon-Fri working, matching the fixture week.
    workingHours: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
      dayOfWeek,
      isWorkingDay: dayOfWeek >= 1 && dayOfWeek <= 5,
      startMinute: 9 * 60,
      endMinute: 18 * 60,
    })),
  });
  expect(created.status, JSON.stringify(created.body).slice(0, 200)).toBe(201);
  universityId = created.body.university.id;

  // The worked example's five weekdays, precisely.
  await metric(MON, 285, 2);
  await metric(TUE, 390, 3);
  await metric(WED, 330, 2);
  await metric(THU, 240, 2);
  await metric(FRI, 360, 3);
  // A day inside the same week where nobody was active — stored EXPLICITLY as
  // (0, 0) rather than left absent, to prove a written zero row is as inert
  // as no row at all.
  await metric(SAT, 0, 0);
  // A second week, inside the same month, so Month spans more than Week does.
  await metric(LATER, 50, 1);
});

const fetchView = async (view: string, on: string) => {
  const res = await admin.get(`/api/admin/average-hours?view=${view}&on=${on}`);
  expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
  const row = res.body.universities.find((u: { id: string }) => u.id === universityId);
  expect(row, "the university should be in the response").toBeTruthy();
  return row as { averageMinutes: number | null; activeMinutes: number; activeInstructorDays: number };
};

describe("1 — the confirmed formula: one sum over minutes, one sum over counts, one division", () => {
  test("the worked example produces exactly 133.75, not either superseded answer", () => {
    const average = averageActiveMinutes([
      { date: MON, activeMinutes: 285, activeCount: 2 },
      { date: TUE, activeMinutes: 390, activeCount: 3 },
      { date: WED, activeMinutes: 330, activeCount: 2 },
      { date: THU, activeMinutes: 240, activeCount: 2 },
      { date: FRI, activeMinutes: 360, activeCount: 3 },
    ]);
    expect(average.minutes).toBe(133.75);
    expect(average.minutes, "not the average-of-daily-averages answer").not.toBe(135.5);
    expect(average.minutes, "not the unique-instructors-times-days answer").not.toBe(107);
    expect(formatActiveAverage(average.minutes)).toBe("2h 13.75m");
  });

  test("through the endpoint: Week view on this fixture is the worked example itself", async () => {
    const week = await fetchView("week", MON);
    // Confirms the route reads the same five days and applies the same
    // formula the direct call above does — not a second, parallel path.
    expect(week.activeMinutes).toBe(285 + 390 + 330 + 240 + 360);
    expect(week.activeInstructorDays).toBe(2 + 3 + 2 + 2 + 3);
    expect(week.averageMinutes).toBe(133.75);
  });

  test("Month view sums past the week, over its own totals — not the week's average reused", async () => {
    const month = await fetchView("month", MON);
    // Week's 1605m/12 plus the 25th's 50m/1 = 1655m over 13 active
    // instructor-days. A month that were wrongly built from weekly averages
    // could not produce this figure by construction.
    expect(month.activeMinutes).toBe(1605 + 50);
    expect(month.activeInstructorDays).toBe(12 + 1);
    expect(month.averageMinutes).toBeCloseTo(1655 / 13, 10);
    // The week's own figure — a month wrongly built by reusing it would equal
    // this instead of the direct sum-over-sum answer above.
    expect(month.averageMinutes).not.toBe(133.75);
  });
});

describe("2 — a day with zero active instructors", () => {
  test("contributes nothing, and does not force a special case into the sum", () => {
    const withZeroRow = averageActiveMinutes([
      { date: MON, activeMinutes: 285, activeCount: 2 },
      { date: SAT, activeMinutes: 0, activeCount: 0 },
    ]);
    const withoutTheRowAtAll = averageActiveMinutes([{ date: MON, activeMinutes: 285, activeCount: 2 }]);
    expect(withZeroRow).toEqual(withoutTheRowAtAll);
    expect(withZeroRow.minutes).toBe(142.5);
  });

  test("a period with no active instructor at all is undefined, never a silent 0", async () => {
    expect(averageActiveMinutes([]).minutes).toBeNull();
    expect(averageActiveMinutes([{ date: SAT, activeMinutes: 0, activeCount: 0 }]).minutes).toBeNull();

    const row = await fetchView("day", SAT);
    expect(row.averageMinutes, "no divide-by-zero, no 0 — unknown").toBeNull();
    expect(row.activeMinutes).toBe(0);
    expect(row.activeInstructorDays).toBe(0);
  });
});

describe("3 — Day view is the formula's simplest case", () => {
  test("one day in, that day's own total over its own count", async () => {
    const day = await fetchView("day", MON);
    expect(day.activeMinutes).toBe(285);
    expect(day.activeInstructorDays).toBe(2);
    // Genuinely fractional even for a single day — 285 does not divide evenly
    // by 2, and this is the exact, correct answer rather than a rounded one.
    expect(day.averageMinutes).toBe(142.5);
  });

  test("a different day, a different active count, a different exact answer", async () => {
    const day = await fetchView("day", TUE);
    expect(day.averageMinutes).toBe(390 / 3);
    expect(day.averageMinutes).toBe(130);
  });
});

describe("4 — whole minutes throughout, proved against the real rollup pipeline", () => {
  /* The tests above prove the FORMULA. This one proves the ENGINE feeding it:
   * real clock times, through `computeAnalytics`'s interval union, through
   * `rollup.ts`'s minute conversion, with nothing simulated.
   *
   * Fixture rows are written directly via Prisma, matching the convention
   * `instructor-stream.test.ts` already uses for the same reason: the write
   * PATH is not what this test is about, and going through the API to reach
   * it would only require standing up a login for four throwaway accounts
   * with no bearing on what is being proved. */
  const DAY = "2026-06-01"; // a Monday, a fresh date this file does not reuse
  let north = "";

  beforeAll(async () => {
    const inst = new ApiClient("n1-probe");
    north = (await inst.login(ACCOUNTS.instructorNorth1)).user.universityId!;

    async function newInstructor(tag: string): Promise<string> {
      const res = await admin.post("/api/instructors", {
        email: `active-avg.${tag}.${RUN}@example.edu`,
        name: `Active Avg ${tag} ${RUN}`,
        password: "active-avg-test-pw-1234",
        universityId: north,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body.instructor.id;
    }
    const [e1, e2, e3, e4] = await Promise.all(
      ["e1", "e2", "e3", "e4"].map((tag) => newInstructor(tag)),
    );

    const teaching = await prisma.activityType.findFirstOrThrow({ where: { code: "TEACHING" } });
    // UNUTILIZED is the one activity type in the taxonomy explicitly marked
    // `countsAsProductive: false` — a real, storable row that does not count
    // as Working Hours, which is exactly what "submitted, but 0h" means.
    const unutilized = await prisma.activityType.findFirstOrThrow({ where: { code: "UNUTILIZED" } });
    const workDate = new Date(`${DAY}T00:00:00.000Z`);
    const at = (hhmm: string) => {
      const [h, m] = hhmm.split(":").map(Number);
      // Asia/Kolkata is UTC+5:30; Northfield's own zone.
      return new Date(workDate.getTime() + (h * 60 + m - (5 * 60 + 30)) * 60_000);
    };

    // Three instructors, twenty minutes of TEACHING each — durations chosen,
    // per the spec, because they do not divide evenly into hours.
    for (const id of [e1, e2, e3]) {
      await prisma.activityLog.create({
        data: {
          instructorId: id,
          universityId: north,
          activityTypeId: teaching.id,
          workDate,
          startTime: at("09:00"),
          endTime: at("09:20"),
        },
      });
    }

    // The fourth instructor "submits a worklog" — a real ActivityLog row
    // exists for them that day — but it is UNUTILIZED time, which does not
    // count toward productive minutes. This is the real-data equivalent of "a
    // submission totalling exactly 0h 0m", and they must be excluded exactly
    // like an instructor who submitted nothing at all.
    await prisma.activityLog.create({
      data: {
        instructorId: e4,
        universityId: north,
        activityTypeId: unutilized.id,
        workDate,
        startTime: at("09:00"),
        endTime: at("09:15"),
      },
    });

    const rolled = await admin.post(`/api/admin/rollup?from=${DAY}&to=${DAY}`, {});
    expect(rolled.status, JSON.stringify(rolled.body).slice(0, 200)).toBe(200);
  });

  test("three instructors at 20m each sum to exactly 60m, not 59 or 61", async () => {
    const row = await prisma.universityDailyMetric.findFirstOrThrow({
      where: { universityId: north, metricDate: new Date(`${DAY}T00:00:00.000Z`) },
    });
    expect(row.activeInstructorMinutes).toBe(60);
  });

  test("a 0h submission is excluded exactly like no submission at all", async () => {
    const row = await prisma.universityDailyMetric.findFirstOrThrow({
      where: { universityId: north, metricDate: new Date(`${DAY}T00:00:00.000Z`) },
    });
    // Three, never four — E4's DAILY_OPENING-only day does not count them in.
    expect(row.activeInstructorCount).toBe(3);
  });

  test("the average that day is a clean 20m — through the real pipeline end to end", async () => {
    const res = await admin.get(`/api/admin/average-hours?view=day&on=${DAY}`);
    const row = res.body.universities.find((u: { id: string }) => u.id === north);
    expect(row.activeMinutes).toBe(60);
    expect(row.activeInstructorDays).toBe(3);
    expect(row.averageMinutes).toBe(20);
  });
});

describe("5 — Week and Month never touch ActivityLog", () => {
  test("only UniversityDailyMetric is read, verified against Postgres's own counters", async () => {
    /* Attaching a query-event listener to the shared app client would count
     * nothing, silently — it only emits events when constructed with
     * `log: ["query"]`, and this suite (like `bulk-import.test.ts`) uses the
     * application's own client. Postgres's per-table read counters are a
     * database-level fact instead: they move when a table is actually read,
     * regardless of how the ORM built the query, so they cannot be fooled by
     * an accidental raw scan the same way an unconfigured listener could be. */
    // Cast out of bigint immediately — these counters never approach
    // Number.MAX_SAFE_INTEGER in a test run, and every caller below wants
    // plain arithmetic on them.
    const snapshot = async () => {
      const rows = await prisma.$queryRaw<
        Array<{ relname: string; seq_scan: bigint; idx_scan: bigint | null }>
      >`
        SELECT relname, seq_scan, idx_scan FROM pg_stat_user_tables
        WHERE relname IN ('ActivityLog', 'UniversityDailyMetric')
      `;
      return rows.map((r) => ({
        relname: r.relname,
        reads: Number(r.seq_scan) + Number(r.idx_scan ?? BigInt(0)),
      }));
    };
    const readsOf = (rows: Awaited<ReturnType<typeof snapshot>>, name: string) =>
      rows.find((r) => r.relname === name)?.reads ?? 0;

    const before = await snapshot();

    const res = await admin.get(`/api/admin/average-hours?view=month&on=${MON}`);
    expect(res.status).toBe(200);

    /* Postgres only flushes a backend's pending stats into the shared counters
     * at most once per PGSTAT_STAT_INTERVAL (500ms), at the end of a
     * transaction — so a snapshot taken immediately after the request can
     * legitimately read as unchanged even though the read already happened.
     * Poll rather than assert on a single reading. */
    let after = await snapshot();
    for (
      let waited = 0;
      waited < 3000 && readsOf(after, "UniversityDailyMetric") === readsOf(before, "UniversityDailyMetric");
      waited += 100
    ) {
      await new Promise((r) => setTimeout(r, 100));
      after = await snapshot();
    }

    expect(
      readsOf(after, "UniversityDailyMetric") - readsOf(before, "UniversityDailyMetric"),
      "and it must actually have read UniversityDailyMetric, or this proves nothing",
    ).toBeGreaterThan(0);
    expect(
      readsOf(after, "ActivityLog") - readsOf(before, "ActivityLog"),
      "the Month view must not perform a single read against ActivityLog",
    ).toBe(0);
  });
});

describe("6 — no model call anywhere in this feature", () => {
  test("the calculation never reaches the provider", () => {
    const before = geminiCallCount();
    averageActiveMinutes([
      { date: MON, activeMinutes: 285, activeCount: 2 },
      { date: LATER, activeMinutes: 50, activeCount: 1 },
    ]);
    expect(geminiCallCount(), "two sums and a division are arithmetic").toBe(before);
  });

  test("and the endpoint itself moves it not at all", async () => {
    const before = geminiCallCount();
    await admin.get(`/api/admin/average-hours?view=month&on=${MON}`);
    expect(geminiCallCount()).toBe(before);
  });
});

describe("7 — each university resolves its own configured zone", () => {
  test("with no anchor, 'today' is computed per university, not once for all of them", async () => {
    const n1 = new ApiClient("n1-tz");
    const northId = (await n1.login(ACCOUNTS.instructorNorth1)).user.universityId!;
    const w1 = new ApiClient("w1-tz");
    const westId = (await w1.login(ACCOUNTS.instructorWest1)).user.universityId!;

    const res = await admin.get("/api/admin/average-hours?view=day");
    expect(res.status).toBe(200);
    const north = res.body.universities.find((u: { id: string }) => u.id === northId);
    const west = res.body.universities.find((u: { id: string }) => u.id === westId);

    const now = new Date();
    // Cross-checked against the same primitive `tests/timezone-boundaries.test.ts`
    // exhaustively covers — this test's job is only to prove THIS route wires
    // it in per university, not to re-audit the primitive itself.
    expect(north.period.from).toBe(workDateFor(now, "Asia/Kolkata"));
    expect(west.period.from).toBe(workDateFor(now, "America/New_York"));
  });
});

describe("it is an admin figure, and it is not a percentage", () => {
  test("a manager cannot read the whole network's averages", async () => {
    const manager = new ApiClient("manager");
    await manager.login(ACCOUNTS.managerNorth);
    const res = await manager.get("/api/admin/average-hours?view=week");
    expect([403, 404]).toContain(res.status);
  });

  test("nothing in the payload is a percentage, a capacity or a roster", async () => {
    const res = await admin.get("/api/admin/average-hours?view=week");
    const text = JSON.stringify(res.body);
    for (const word of ["utilization", "utilisation", "capacity", "percent", "target", "roster"]) {
      expect(text.toLowerCase(), `${word} must not reappear under a new label`).not.toContain(word);
    }
  });

  test("an unknown view is refused rather than guessed at", async () => {
    const res = await admin.get("/api/admin/average-hours?view=fortnight");
    expect(res.status).toBe(400);
  });
});
