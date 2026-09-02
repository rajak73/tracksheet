import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/server/db";
import { parseWorkingMinutes } from "@/domain/worklog-hours";

/**
 * The day's total is WHOLE MINUTES, and the way back is checked.
 *
 * ── What the old unit cost ────────────────────────────────────────────────
 * `working_hours Decimal(6,2)` could not hold twenty minutes. It stored 0.33,
 * which is 19.8 minutes. Anything counting in minutes re-inflated it to 20, so
 * three twenty-minute days were 0.99 hours through the record and 60 minutes
 * through the rollup — two readings of one day, differing by a hundredth, with
 * neither side doing anything wrong.
 */

const MIGRATION = "worklog_entry_working_minutes";

/** The migration's own predicate: minutes back to two-decimal hours. */
const survivesRoundTrip = (hours: number) => Math.round((Math.round(hours * 60) / 60) * 100) / 100 === hours;

describe("the working_hours to working_minutes migration", () => {
  test("every row in the database survives the round trip", async () => {
    /* Run against whatever is actually stored rather than a fixture: the
     * migration's guarantee is about the rows that existed, and a fixture would
     * only prove the predicate agrees with itself. */
    const rows = await prisma.worklogEntry.findMany({ select: { workingMinutes: true } });
    const notWhole = rows.filter((r) => !Number.isInteger(r.workingMinutes));
    expect(notWhole, "minutes are integers or the unit has already been lost").toEqual([]);

    for (const row of rows) {
      const hours = Math.round((row.workingMinutes / 60) * 100) / 100;
      expect(
        survivesRoundTrip(hours),
        `${row.workingMinutes} minutes does not survive a trip through hours`,
      ).toBe(true);
    }
  });

  test("the migration aborts rather than rounding a row away", () => {
    /* Shown, not assumed: a value finer than a minute fails the predicate the
     * migration raises on. 0.01h is 36 seconds — it becomes 1 minute, and one
     * minute is 0.02h, so the row would come back as something else. */
    expect(survivesRoundTrip(0.01)).toBe(false);
    expect(survivesRoundTrip(0.33)).toBe(true);
    expect(survivesRoundTrip(6.5)).toBe(true);

    const dir = readdirSync("prisma/migrations").find((d) => d.endsWith(MIGRATION));
    expect(dir, "the migration must still exist to be the thing that guarantees this").toBeDefined();
    const sql = readFileSync(join("prisma/migrations", dir!, "migration.sql"), "utf8");
    expect(sql).toContain("RAISE EXCEPTION");
    /* The guard has to come BEFORE the drop, or it is checking a column that is
     * already gone and the data with it. */
    expect(sql.indexOf("RAISE EXCEPTION")).toBeLessThan(sql.indexOf("DROP COLUMN"));
  });

  test("twenty minutes is twenty, and three of them are an hour", () => {
    // The case the whole change is for.
    expect(parseWorkingMinutes("20 minutes")).toBe(20);
    expect(20 + 20 + 20).toBe(60);
    // What the old column did with the same three days.
    const asDecimalHours = Math.round((20 / 60) * 100) / 100;
    expect(asDecimalHours).toBe(0.33);
    expect(asDecimalHours * 3).toBeCloseTo(0.99, 5);
  });

  test("the parser reports minutes for every way somebody writes a duration", () => {
    expect(parseWorkingMinutes("8")).toBe(480);
    expect(parseWorkingMinutes("8.5")).toBe(510);
    expect(parseWorkingMinutes("8h 30m")).toBe(510);
    expect(parseWorkingMinutes("8:30")).toBe(510);
    expect(parseWorkingMinutes("6 hours 30 minutes")).toBe(390);
    expect(parseWorkingMinutes("45m")).toBe(45);
    expect(parseWorkingMinutes("1.5 hours")).toBe(90);
    // Still refused: a bare number over twelve is not a count of hours.
    expect(parseWorkingMinutes("45")).toBeNull();
    expect(parseWorkingMinutes("banana")).toBeNull();
  });
});
