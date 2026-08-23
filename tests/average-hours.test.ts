import { beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/server/db";
import { ApiClient, ACCOUNTS } from "./helpers/client";
import { averageMinutesPerInstructor } from "@/domain/average-hours";
import { geminiCallCount } from "@/server/ai/gemini";
import { workingHours } from "@/domain/worklog-report";

/**
 * Average working hours per instructor, per university.
 *
 * ── The one rule most likely to be reversed by accident ───────────────────
 * The denominator is the WHOLE roster, not the people who filed. Dividing by
 * submitters answers a different question — "what did the people who reported,
 * report" — and it moves the wrong way: the worse reporting gets, the higher
 * that number climbs, so a university where half the staff stopped recording
 * would look like its best month.
 *
 * The first case below is the guard against that, and it is deliberately the
 * simplest arithmetic in the file: twenty hours and a zero make ten, never
 * twenty.
 */

let admin: ApiClient;
let universityId = "";
const RUN = Math.random().toString(36).slice(2, 8).replace(/[0-9]/g, "x");

/* A settled month in the past, so nothing here depends on the hour it runs. */
const MONTH = "2026-05";
const DAY_ONE = `${MONTH}-04`; // a Monday
const DAY_TWO = `${MONTH}-05`;
const LATER = `${MONTH}-25`;

async function metric(date: string, minutes: number, roster: number) {
  await prisma.universityDailyMetric.upsert({
    where: { universityId_metricDate: { universityId, metricDate: new Date(`${date}T00:00:00.000Z`) } },
    create: {
      universityId,
      metricDate: new Date(`${date}T00:00:00.000Z`),
      activeInstructors: roster,
      productiveMinutes: minutes,
    },
    update: { activeInstructors: roster, productiveMinutes: minutes },
  });
}

beforeAll(async () => {
  admin = new ApiClient("admin");
  await admin.login(ACCOUNTS.admin);

  const created = await admin.post("/api/universities", {
    name: `Average Test ${RUN}`,
    slug: `average-test-${RUN}`,
    code: `AVG${RUN.slice(0, 3).toUpperCase()}`,
    timezone: "Asia/Kolkata",
    // Mon-Fri 09:00-18:00, so the fixture is a working university.
    // All seven days, Monday to Friday working — the API wants the full week.
    workingHours: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
      dayOfWeek,
      isWorkingDay: dayOfWeek >= 1 && dayOfWeek <= 5,
      startMinute: 9 * 60,
      endMinute: 18 * 60,
    })),
  });
  expect(created.status, JSON.stringify(created.body).slice(0, 200)).toBe(201);
  universityId = created.body.university.id;

  /* Two instructors on the roster. One records twenty hours on the Monday, the
   * other records nothing all period — the case the whole rule exists for. */
  await metric(DAY_ONE, 20 * 60, 2);
  await metric(DAY_TWO, 0, 2);
  // Later in the month, a third instructor joins and six more hours are logged.
  await metric(LATER, 6 * 60, 3);
});

const fetchView = async (view: string, on: string) => {
  const res = await admin.get(`/api/admin/average-hours?view=${view}&on=${on}`);
  expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
  const row = res.body.universities.find((u: { id: string }) => u.id === universityId);
  expect(row, "the university should be in the response").toBeTruthy();
  return row as { averageMinutes: number | null; roster: number; totalMinutes: number };
};

describe("1 — the denominator is everyone, not only those who filed", () => {
  test("twenty hours and a zero average ten, not twenty", () => {
    const average = averageMinutesPerInstructor([
      { date: DAY_ONE, minutes: 20 * 60, roster: 2 },
      { date: DAY_TWO, minutes: 0, roster: 2 },
    ]);
    expect(average.roster).toBe(2);
    expect(average.minutes).toBe(10 * 60);
    expect(workingHours(average.minutes!)).toBe("10h 00m");
  });

  test("through the endpoint, on the day itself", async () => {
    const row = await fetchView("day", DAY_ONE);
    expect(row.roster, "both instructors, one of whom recorded nothing").toBe(2);
    expect(row.averageMinutes).toBe(10 * 60);
  });

  test("a silent instructor lowers it rather than disappearing", () => {
    const two = averageMinutesPerInstructor([{ date: DAY_ONE, minutes: 20 * 60, roster: 2 }]);
    const four = averageMinutesPerInstructor([{ date: DAY_ONE, minutes: 20 * 60, roster: 4 }]);
    expect(four.minutes!, "the same hours across twice the roster halve").toBe(two.minutes! / 2);
  });

  test("a period with no metrics is unknown, not zero", () => {
    // Nothing rolled up is a different answer from nobody working.
    expect(averageMinutesPerInstructor([]).minutes).toBeNull();
  });

  test("a university with no instructors has no per-instructor average", () => {
    expect(averageMinutesPerInstructor([{ date: DAY_ONE, minutes: 0, roster: 0 }]).minutes).toBeNull();
  });
});

describe("2 — each period is computed for itself", () => {
  test("day, week and month give three different, correct figures", async () => {
    const day = await fetchView("day", DAY_ONE);
    const week = await fetchView("week", DAY_ONE);
    const month = await fetchView("month", DAY_ONE);

    // Day: 20h over 2 on the roster.
    expect(day.totalMinutes).toBe(20 * 60);
    expect(day.averageMinutes).toBe(10 * 60);

    /* Week: the Monday's 20h plus the Tuesday's nothing, still 2 on the roster
     * — the 25th is a different week and must not leak in. */
    expect(week.totalMinutes).toBe(20 * 60);
    expect(week.roster).toBe(2);
    expect(week.averageMinutes).toBe(10 * 60);

    /* Month: 20h + 0 + 6h = 26h, over the roster as it stands at the end. */
    expect(month.totalMinutes).toBe(26 * 60);
    expect(month.roster).toBe(3);
    expect(month.averageMinutes).toBe(Math.round((26 * 60) / 3));
  });

  test("one period's answer is never reused for another", async () => {
    const day = await fetchView("day", DAY_ONE);
    const month = await fetchView("month", DAY_ONE);
    expect(month.totalMinutes).not.toBe(day.totalMinutes);
    expect(month.averageMinutes).not.toBe(day.averageMinutes);
  });

  test("a day with nothing recorded reads zero, not the week's figure", async () => {
    const row = await fetchView("day", DAY_TWO);
    expect(row.totalMinutes).toBe(0);
    expect(row.averageMinutes).toBe(0);
  });
});

describe("3 — with no anchor, each view is the CURRENT period", () => {
  test("every view answers, and for its own range", async () => {
    for (const view of ["day", "week", "month"] as const) {
      const res = await admin.get(`/api/admin/average-hours?view=${view}`);
      expect(res.status, view).toBe(200);
      const row = res.body.universities.find((u: { id: string }) => u.id === universityId);
      expect(row.period.from <= row.period.to, view).toBe(true);
    }
  });

  test("the current periods nest, as periods do", async () => {
    const day = (await admin.get("/api/admin/average-hours?view=day")).body.universities[0];
    const week = (await admin.get("/api/admin/average-hours?view=week")).body.universities[0];
    const month = (await admin.get("/api/admin/average-hours?view=month")).body.universities[0];
    expect(week.period.from <= day.period.from).toBe(true);
    expect(week.period.to >= day.period.to).toBe(true);
    expect(month.period.from <= week.period.from || month.period.from <= day.period.from).toBe(true);
  });

  test("an unknown view is refused rather than guessed at", async () => {
    const res = await admin.get("/api/admin/average-hours?view=fortnight");
    expect(res.status).toBe(400);
  });
});

describe("4 — no model call anywhere in this feature", () => {
  test("the calculation never reaches the provider", () => {
    const before = geminiCallCount();
    averageMinutesPerInstructor([
      { date: DAY_ONE, minutes: 20 * 60, roster: 2 },
      { date: LATER, minutes: 6 * 60, roster: 3 },
    ]);
    expect(geminiCallCount(), "a SUM and a division are arithmetic").toBe(before);
  });
});

describe("5 — a roster that changed size during the period", () => {
  /* The rule, stated in `average-hours.ts` and asserted here: the roster on the
   * LAST day of the period that has metrics. It answers the question an
   * administrator is asking, which is about the team they have now. */
  test("the month divides by the roster as it ended, not as it began", async () => {
    const month = await fetchView("month", DAY_ONE);
    expect(month.roster, "three by the 25th, not the two it started with").toBe(3);
  });

  test("directly, so the rule is visible without the database", () => {
    const average = averageMinutesPerInstructor([
      { date: "2026-05-04", minutes: 20 * 60, roster: 2 },
      { date: "2026-05-25", minutes: 6 * 60, roster: 3 },
    ]);
    expect(average.roster).toBe(3);
    expect(average.minutes).toBe(Math.round((26 * 60) / 3));
  });

  test("a leaver stops counting from the day they go", () => {
    const average = averageMinutesPerInstructor([
      { date: "2026-05-04", minutes: 20 * 60, roster: 3 },
      { date: "2026-05-25", minutes: 6 * 60, roster: 2 },
    ]);
    expect(average.roster, "two by the end").toBe(2);
    expect(average.minutes).toBe(13 * 60);
  });

  test("a trailing day with no roster does not erase the one before it", () => {
    /* A day with metrics but nobody on it would otherwise read as the roster
     * having gone to zero, and turn a real average into "unknown". */
    const average = averageMinutesPerInstructor([
      { date: "2026-05-04", minutes: 20 * 60, roster: 2 },
      { date: "2026-05-05", minutes: 0, roster: 0 },
    ]);
    expect(average.roster).toBe(2);
    expect(average.minutes).toBe(10 * 60);
  });

  test("the order the days arrive in does not change the answer", () => {
    const forwards = averageMinutesPerInstructor([
      { date: "2026-05-04", minutes: 20 * 60, roster: 2 },
      { date: "2026-05-25", minutes: 6 * 60, roster: 3 },
    ]);
    const backwards = averageMinutesPerInstructor([
      { date: "2026-05-25", minutes: 6 * 60, roster: 3 },
      { date: "2026-05-04", minutes: 20 * 60, roster: 2 },
    ]);
    expect(backwards).toEqual(forwards);
  });
});

describe("it is an admin figure, and it is not a percentage", () => {
  test("a manager cannot read the whole network's averages", async () => {
    const manager = new ApiClient("manager");
    await manager.login(ACCOUNTS.managerNorth);
    const res = await manager.get("/api/admin/average-hours?view=week");
    expect([403, 404]).toContain(res.status);
  });

  test("nothing in the payload is a percentage or a capacity", async () => {
    const res = await admin.get("/api/admin/average-hours?view=week");
    const text = JSON.stringify(res.body);
    for (const word of ["utilization", "utilisation", "capacity", "percent", "target"]) {
      expect(text.toLowerCase(), `${word} must not reappear under a new label`).not.toContain(word);
    }
  });
});
