import { beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/server/db";
import { ApiClient, ACCOUNTS } from "./helpers/client";
import { seedDayRow } from "./helpers/worklog";
import { averageActiveMinutes, formatActiveAverage } from "@/domain/average-hours";
import { geminiCallCount } from "@/server/ai/gemini";
import { workDateFor } from "@/server/time/workday";
import { RUN } from "./helpers/fixtures";
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
        email: `active-avg.${tag}.${RUN}@fixture.test`,
        name: `Active Avg ${tag} ${RUN}`,
        password: "active-avg-test-pw-1234",
        universityId: north,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body.instructor.id;
    }
    /* Three, not four. The fourth existed only to file a submission that
       totalled zero — see the note below on why that is now unreachable. */
    const [e1, e2, e3] = await Promise.all(
      ["e1", "e2", "e3"].map((tag) => newInstructor(tag)),
    );

    /* The activity-type lookup and the IST clock helper are gone with the clock
       ranges they built. A day is one row with the hours the instructor
       entered; there is no start and end to convert into a zone. */

    /* Three instructors, twenty minutes each — durations chosen, per the spec,
       because they do not divide evenly into hours. That is the whole point of
       this section: the pipeline must carry whole minutes and not round them
       into a figure that no longer sums.

       Written straight to the table, because these instructors are created
       moments earlier and the route refuses a day before their record began.
       `seedDayRow` throws on a failed write, and the assertion below would
       otherwise be measuring an empty day. */
    for (const id of [e1, e2, e3]) {
      const row = await seedDayRow({
        instructorId: id,
        universityId: north,
        date: DAY,
        deliverable: "Twenty minutes",
        workingHours: 20 / 60,
      });
      expect(Number(row.workingHours), "the fixture must actually have written").toBeGreaterThan(0);
    }

    /* There is no fourth instructor any more.
     *
     * They used to file fifteen minutes of UNUTILIZED — the one activity type
     * marked `countsAsProductive: false` — so a real row existed that summed to
     * zero productive minutes. That flag lived on `ActivityType` and is gone:
     * every recorded hour counts, so time filed under any name is time worked.
     *
     * The obvious replacement, a zero-length entry, is refused by the
     * `activity_log_positive_interval` CHECK. So through THIS pipeline no
     * submission can total exactly 0h, and the case is unreachable rather than
     * merely untested. The `activeInstructorMinutes > 0` guard in the rollup
     * still stands; what can now produce that state is a `WorklogEntry` with
     * zero hours, which the tracker reads and `tracker-empty-states` holds. */

    const rolled = await admin.post(`/api/admin/rollup?from=${DAY}&to=${DAY}`, {});
    expect(rolled.status, JSON.stringify(rolled.body).slice(0, 200)).toBe(200);
  });

  test("three instructors at 20m each sum to exactly 60m, not 59 or 61", async () => {
    const row = await prisma.universityDailyMetric.findFirstOrThrow({
      where: { universityId: north, metricDate: new Date(`${DAY}T00:00:00.000Z`) },
    });
    expect(row.activeInstructorMinutes).toBe(60);
  });

  test("only instructors who recorded time are counted active", async () => {
    const row = await prisma.universityDailyMetric.findFirstOrThrow({
      where: { universityId: north, metricDate: new Date(`${DAY}T00:00:00.000Z`) },
    });
    /* Three, and three is now everybody who filed — see the note above about
       the fourth. What this still holds is that the count comes from recorded
       minutes rather than from the roster. */
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
  /* ── Why this is a source check and not a counter check ──────────────────
   * This asserted against `pg_stat_user_tables` — snapshot the read counters,
   * make the request, assert ActivityLog's did not move. It was right about
   * the mechanism and wrong about the medium: those counters are global to the
   * database and cumulative across every connection, so the metrics scheduler
   * running inside the test server, or any other suite's in-flight query, moved
   * ActivityLog's counter during the window and failed a test about a route
   * that had not touched it. It passed alone and failed in the full run, which
   * is the signature of a test measuring its neighbours.
   *
   * The claim worth pinning is narrower and is a property of the code rather
   * than of the process: this view's read path names one table. That is
   * checkable exactly, every time, so it is checked exactly. */
  test("the route reads the daily summary table and nothing else", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/app/api/admin/average-hours/route.ts", "utf8");

    expect(
      source.includes("universityDailyMetric"),
      "it should read the precomputed daily summary",
    ).toBe(true);
    expect(
      /prisma\.activityLog|\bActivityLog\b/.test(source.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "")),
      "no ActivityLog access anywhere in the read path — Week and Month are a " +
        "range over the summary table, never a scan of the rows behind it",
    ).toBe(false);
  });

  test("and it still answers a Month view correctly", async () => {
    // The negative above only means something if the route works at all.
    const month = await fetchView("month", MON);
    expect(month.activeMinutes).toBe(1605 + 50);
    expect(month.activeInstructorDays).toBe(12 + 1);
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

describe("8 — manager and instructor counts are roster context, never inputs", () => {
  /* Every fixture here is a fresh, throwaway university, so this block cannot
   * disturb the figures the describes above already asserted on
   * `universityId` — nothing here mutates shared fixture state. */
  const ROSTER_DAY = "2026-07-06"; // a fresh Monday this file does not reuse
  let codeSeq = 0;

  async function newUniversity(tag: string): Promise<string> {
    codeSeq += 1;
    // Deliberately NOT "Roster ..." — the payload's own banned-word guard
    // (below, in its own describe) scans the whole response text, and a
    // fixture's free-text NAME is part of that text same as any field.
    const created = await admin.post("/api/universities", {
      name: `Team ${tag} ${RUN}`,
      slug: `team-${tag.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${RUN}`,
      code: `RC${codeSeq}${RUN.slice(0, 4).toUpperCase()}`,
      timezone: "Asia/Kolkata",
      workingHours: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
        dayOfWeek,
        isWorkingDay: dayOfWeek >= 1 && dayOfWeek <= 5,
        startMinute: 9 * 60,
        endMinute: 18 * 60,
      })),
    });
    expect(created.status, JSON.stringify(created.body).slice(0, 200)).toBe(201);
    return created.body.university.id;
  }

  async function addManagers(uniId: string, count: number) {
    for (let i = 0; i < count; i++) {
      const res = await admin.post(`/api/universities/${uniId}/managers`, {
        email: `roster.mgr.${uniId}.${i}.${RUN}@fixture.test`,
        name: `Roster Mgr ${i} ${RUN}`,
        password: "roster-mgr-test-pw-1234",
        employeeCode: `RM${RUN}${uniId.slice(-4)}${i}`,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    }
  }

  async function addInstructors(uniId: string, count: number) {
    for (let i = 0; i < count; i++) {
      const res = await admin.post("/api/instructors", {
        email: `roster.inst.${uniId}.${i}.${RUN}@fixture.test`,
        name: `Roster Inst ${i} ${RUN}`,
        password: "roster-inst-test-pw-1234",
        universityId: uniId,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    }
  }

  async function dayMetric(uniId: string, activeMinutes: number, activeCount: number) {
    await prisma.universityDailyMetric.upsert({
      where: {
        universityId_metricDate: { universityId: uniId, metricDate: new Date(`${ROSTER_DAY}T00:00:00.000Z`) },
      },
      create: {
        universityId: uniId,
        metricDate: new Date(`${ROSTER_DAY}T00:00:00.000Z`),
        activeInstructorMinutes: activeMinutes,
        activeInstructorCount: activeCount,
      },
      update: { activeInstructorMinutes: activeMinutes, activeInstructorCount: activeCount },
    });
  }

  // Requirement 1: identical activity, 1 manager vs 4 managers.
  let oneManager = "", fourManagers = "";
  // Requirement 3: 8 on the roster, only 3 active that day.
  let eightOnRoster = "";
  // Requirement 2: the worked example's three rows, verbatim.
  let worked1 = "", worked2 = "", worked3 = "";

  beforeAll(async () => {
    oneManager = await newUniversity("OneManager");
    fourManagers = await newUniversity("FourManagers");
    eightOnRoster = await newUniversity("EightTotalThreeActive");
    worked1 = await newUniversity("Worked1");
    worked2 = await newUniversity("Worked2");
    worked3 = await newUniversity("Worked3");

    await Promise.all([
      addManagers(oneManager, 1),
      addManagers(fourManagers, 4),
      addManagers(eightOnRoster, 1),
      addManagers(worked1, 2),
      addManagers(worked2, 1),
      addManagers(worked3, 4),
    ]);
    await Promise.all([
      addInstructors(eightOnRoster, 8),
      addInstructors(worked1, 5),
      addInstructors(worked2, 4),
      addInstructors(worked3, 8),
    ]);

    // oneManager and fourManagers: the SAME activity, on purpose.
    await dayMetric(oneManager, 400, 5);
    await dayMetric(fourManagers, 400, 5);
    // 8 instructors on the roster; only 3 of them active this day.
    await dayMetric(eightOnRoster, 240, 3);
    // The worked example's three figures, exactly:
    //   1605 ÷ 12 = 133.75  = 2h 13.75m
    //    953 ÷ 10 =  95.3   = 1h 35.3m
    //    888 ÷ 10 =  88.8   = 1h 28.8m
    await dayMetric(worked1, 1605, 12);
    await dayMetric(worked2, 953, 10);
    await dayMetric(worked3, 888, 10);
  });

  const rowFor = async (uniId: string) => {
    const res = await admin.get(`/api/admin/average-hours?view=day&on=${ROSTER_DAY}`);
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
    const row = res.body.universities.find((u: { id: string }) => u.id === uniId);
    expect(row, "the university should be in the response").toBeTruthy();
    return row as {
      managerCount: number;
      instructorCount: number;
      activeInstructorDays: number;
      averageMinutes: number | null;
    };
  };

  test("manager count has zero effect on the calculation — 1 manager vs 4, identical activity", async () => {
    const a = await rowFor(oneManager);
    const b = await rowFor(fourManagers);
    expect(a.managerCount).toBe(1);
    expect(b.managerCount).toBe(4);
    // Same underlying activity, so the same average — manager count never
    // entered the formula on either side.
    expect(a.averageMinutes).toBe(b.averageMinutes);
    expect(a.averageMinutes).toBe(80); // 400 ÷ 5
  });

  test("roster size (8) and the active count the average used (3) are never conflated", async () => {
    const row = await rowFor(eightOnRoster);
    expect(row.instructorCount, "the whole roster, active today or not").toBe(8);
    expect(row.activeInstructorDays, "only who was active today").toBe(3);
    // 240 ÷ 3, never 240 ÷ 8 — the roster size the card also shows must not
    // leak into the number it sits beside.
    expect(row.averageMinutes).toBe(80);
    expect(row.averageMinutes).not.toBe(240 / 8);
  });

  test("the worked example: manager count, instructor count and average together, exactly", async () => {
    const first = await rowFor(worked1);
    expect(first.managerCount).toBe(2);
    expect(first.instructorCount).toBe(5);
    expect(formatActiveAverage(first.averageMinutes)).toBe("2h 13.75m");

    const second = await rowFor(worked2);
    expect(second.managerCount).toBe(1);
    expect(second.instructorCount).toBe(4);
    expect(formatActiveAverage(second.averageMinutes)).toBe("1h 35.3m");

    const third = await rowFor(worked3);
    expect(third.managerCount).toBe(4);
    expect(third.instructorCount).toBe(8);
    expect(formatActiveAverage(third.averageMinutes)).toBe("1h 28.8m");
  });

  test("Gemini is never called for roster counts either", async () => {
    const before = geminiCallCount();
    await admin.get(`/api/admin/average-hours?view=day&on=${ROSTER_DAY}`);
    expect(geminiCallCount()).toBe(before);
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
