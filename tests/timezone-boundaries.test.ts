import { describe, expect, test } from "vitest";
import { trailingWindow } from "@/server/jobs/metrics-scheduler";
import { workDateFor, zonedToUtc } from "@/server/time/workday";
import { todayFor } from "@/server/worklog/window";
import { mondayOf, weekOf, weeksOfMonth } from "@/domain/worklog-rows";
import { todayIn } from "@/app/_lib/format";

/**
 * Every day boundary, at every hour — not at whatever hour this happens to run.
 *
 * ── Why this file exists ──────────────────────────────────────────────────
 * A timezone bug of this shape is invisible for most of the day. The one that
 * started this audit — a test computing "today" in UTC while the server judged
 * it in Asia/Kolkata — passed for eighteen and a half hours out of every
 * twenty-four, and was found because somebody happened to be working at 01:42.
 *
 * So nothing here reads the real clock. Every case names its instant, and the
 * ones that matter sweep all twenty-four hours, because "correct at the hour
 * the suite ran" is exactly the property that let the original bug live.
 *
 * ── And nothing here hardcodes India ──────────────────────────────────────
 * The deployment is Indian and the boundary rules are not. Every case that
 * checks a zone checks several, including one ahead of the line and one
 * behind, so a fix that only works for +05:30 fails here.
 */

/** One instant per hour of a chosen UTC day. */
const everyHour = (day: string): Date[] =>
  Array.from({ length: 24 }, (_, h) => new Date(`${day}T${String(h).padStart(2, "0")}:30:00.000Z`));

/** Zones either side of UTC, and the two extremes that exist. */
const ZONES = [
  "Asia/Kolkata", // +05:30, the deployment
  "America/New_York", // -04:00/-05:00, the other seeded university
  "Pacific/Kiritimati", // +14:00, the furthest ahead any zone goes
  "Pacific/Midway", // -11:00, near the furthest behind
  "UTC",
];

describe("the rollup window covers every university's local day, at every hour", () => {
  /* The bug this proves gone: the window ran to "yesterday" in UTC while a
   * university five and a half hours ahead was already well into today, so
   * every entry logged in the first hours of an Indian working day sat outside
   * it and was not summarised until 18:30 local. Nothing failed — the admin
   * dashboard just disagreed with the live engine every morning and corrected
   * itself before anybody could reproduce it. */
  test("every hour of a day, in every zone, is inside the window", () => {
    for (const now of everyHour("2026-08-22")) {
      const window = trailingWindow(now, 3);
      for (const zone of ZONES) {
        const localToday = workDateFor(now, zone);
        expect(
          localToday >= window.from && localToday <= window.to,
          `${zone} at ${now.toISOString()} — local ${localToday} outside ${window.from}..${window.to}`,
        ).toBe(true);
      }
    }
  });

  test("it holds across a month boundary too", () => {
    for (const now of [...everyHour("2026-08-31"), ...everyHour("2026-09-01")]) {
      const window = trailingWindow(now, 3);
      for (const zone of ZONES) {
        const localToday = workDateFor(now, zone);
        expect(localToday >= window.from && localToday <= window.to, `${zone} ${localToday}`).toBe(true);
      }
    }
  });

  test("it still covers the days it is meant to trail", () => {
    // Widening must not have stopped it reaching back.
    const window = trailingWindow(new Date("2026-08-22T12:00:00.000Z"), 3);
    expect(window.from <= "2026-08-20").toBe(true);
    expect(window.to >= "2026-08-22").toBe(true);
  });
});

describe("the day an instructor may write up is the university's, at every hour", () => {
  const config = (timezone: string) => ({ timezone }) as Parameters<typeof todayFor>[0];

  test("Kolkata and New York disagree, and each is right about itself", () => {
    // 2026-08-22T19:30Z is the 23rd in Kolkata and still the 22nd in New York.
    const now = new Date("2026-08-22T19:30:00.000Z");
    expect(todayFor(config("Asia/Kolkata"), now)).toBe("2026-08-23");
    expect(todayFor(config("America/New_York"), now)).toBe("2026-08-22");
  });

  test("across all twenty-four hours it always equals the zone's own date", () => {
    for (const now of everyHour("2026-08-22")) {
      for (const zone of ZONES) {
        expect(todayFor(config(zone), now), `${zone} ${now.toISOString()}`).toBe(
          workDateFor(now, zone),
        );
      }
    }
  });

  test("nothing about it depends on the machine's own zone", () => {
    /* The one property that makes the rest safe: the answer is a function of
     * the instant and the zone, and of nothing else. */
    const now = new Date("2026-08-22T19:30:00.000Z");
    expect(todayFor(config("Asia/Kolkata"), now)).toBe("2026-08-23");
    expect(workDateFor(now, "Asia/Kolkata")).toBe("2026-08-23");
  });
});

describe("a browser's today is not a university's today", () => {
  test("todayIn answers in the zone it is given", () => {
    const inKolkata = todayIn("Asia/Kolkata");
    const inMidway = todayIn("Pacific/Midway");
    // Never equal to each other for ~11 hours a day, and each is a real date.
    for (const value of [inKolkata, inMidway]) {
      expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(inKolkata >= inMidway, "Kolkata is never behind Midway").toBe(true);
  });

  test("an unknown or missing zone falls back rather than blanking the screen", () => {
    expect(todayIn(null)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(todayIn(undefined)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(todayIn("Not/AZone")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("calendar arithmetic is calendar arithmetic, not instants", () => {
  /* `weekOf`, `mondayOf` and `weeksOfMonth` take a date STRING and never see an
   * instant, so there is no zone for them to get wrong. Asserted so that stays
   * true if somebody reaches for `new Date()` inside one. */
  test("a week runs Monday to Sunday whatever the hour", () => {
    expect(mondayOf("2026-08-23"), "Sunday belongs to the week that started").toBe("2026-08-17");
    expect(weekOf("2026-08-19")[0]).toBe("2026-08-17");
    expect(weekOf("2026-08-19")).toHaveLength(7);
  });

  test("a month's weeks are clipped to it and cover it exactly once", () => {
    const dates = weeksOfMonth("2026-08").flatMap((w) => w.dates);
    expect(dates).toHaveLength(31);
    expect(new Set(dates).size).toBe(31);
    expect(dates[0]).toBe("2026-08-01");
    expect(dates.at(-1)).toBe("2026-08-31");
  });

  test("February in a leap year, because that is where off-by-ones live", () => {
    const dates = weeksOfMonth("2028-02").flatMap((w) => w.dates);
    expect(dates).toHaveLength(29);
    expect(dates.at(-1)).toBe("2028-02-29");
  });
});

describe("a local wall clock resolves to the same instant it came from", () => {
  test("round-trips in every zone, at every hour", () => {
    for (const zone of ZONES) {
      for (let hour = 0; hour < 24; hour++) {
        const minutes = hour * 60 + 30;
        const instant = zonedToUtc("2026-08-22", minutes, zone);
        expect(workDateFor(instant, zone), `${zone} ${hour}:30`).toBe("2026-08-22");
      }
    }
  });

  test("and across a DST transition where one exists", () => {
    // New York springs forward on 2026-03-08. Every hour that EXISTS round-trips.
    for (let hour = 3; hour < 24; hour++) {
      const instant = zonedToUtc("2026-03-08", hour * 60, "America/New_York");
      expect(workDateFor(instant, "America/New_York"), `${hour}:00`).toBe("2026-03-08");
    }
  });
});

describe("nothing on the server reads the machine's own timezone", () => {
  /* The property that makes every other case here hold. Asserted as a source
   * check rather than a behavioural one, because a behavioural test would have
   * to run the suite under two different TZ values to prove anything — and this
   * catches the reintroduction at the moment somebody writes it.
   *
   * It found one: `rollup.ts` ordered a day's entries by `getHours()`, so a
   * server in UTC and a laptop in IST sorted the same day differently, and
   * entries either side of local midnight sorted wrongly on both.
   */
  test("no local date getters outside the timezone helpers", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");

    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (name === "generated" || name === "node_modules") continue;
          walk(path);
          continue;
        }
        if (!path.endsWith(".ts")) continue;
        const source = readFileSync(path, "utf8");
        for (const [i, line] of source.split("\n").entries()) {
          if (/\.get(FullYear|Month|Date|Day|Hours|Minutes|Seconds)\(\)/.test(line)) {
            if (line.includes("getUTC")) continue;
            offenders.push(`${path}:${i + 1} ${line.trim()}`);
          }
        }
      }
    };
    walk("src/server");
    walk("src/domain");

    expect(
      offenders,
      "read the instant with a zone (`workDateFor`, `zonedParts`) or in UTC — never the machine's",
    ).toEqual([]);
  });
});

describe("no screen asks the browser what day it is", () => {
  /* The third source the audit forbids, after the machine's zone and a
   * hardcoded one: the BROWSER's. `todayISO` answers in it, and it is correct
   * only where the viewer sits in their university's zone with a right clock.
   *
   * A manager reading an instructor's day in another city must see the
   * INSTRUCTOR's boundary, and an instructor whose laptop is a day out must not
   * be offered a date the server then refuses.
   *
   * `useUniversityToday` is the answer, fed by a zone the layout resolves
   * server-side. This fails the build if a screen reaches for `todayISO`
   * instead — with two exemptions that are the fallback itself.
   */
  test("todayISO is only reached for as a documented fallback", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");

    /* Where a browser answer is the honest one: the helper that defines it, the
     * hook that falls back to it for a role with no university, and the one
     * default that runs before any zone is known. */
    const EXEMPT = new Set([
      "src/app/_lib/format.ts",
      "src/app/_lib/zone.tsx",
      "src/app/instructor/worklog/page.tsx",
    ]);

    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (name === "generated" || name === "node_modules") continue;
          walk(path);
          continue;
        }
        if (!/\.tsx?$/.test(path) || EXEMPT.has(path)) continue;
        const source = readFileSync(path, "utf8");
        for (const [i, line] of source.split("\n").entries()) {
          if (/\btodayISO\s*\(/.test(line)) offenders.push(`${path}:${i + 1} ${line.trim()}`);
        }
      }
    };
    walk("src/app");

    expect(
      offenders,
      "use useUniversityToday() — the server judges days in the university's zone, not the viewer's",
    ).toEqual([]);
  });
});
