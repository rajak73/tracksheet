import { describe, expect, test } from "vitest";
import { workDateFor, zonedParts, zonedToUtc } from "@/server/time/workday";

/**
 * A regression gap the phase audit found: every existing test offsets an
 * instant WITHIN the same UTC calendar day (e.g. IST 09:00-17:45 -> 03:30Z-
 * 12:15Z), so a UTC-based (server-local) `workDate` derivation would have
 * passed all of them. This file exercises the one case that actually proves
 * the derivation is timezone-aware: an instant whose UTC calendar date
 * differs from its tenant-local calendar date.
 */
describe("workDateFor is timezone-aware, not UTC-based", () => {
  test("late-night IST rolls the UTC date back a day", () => {
    // 2026-03-10 00:30 IST (UTC+5:30) is 2026-03-09 19:00 UTC — same instant,
    // two different calendar dates. A UTC-based derivation would report the
    // 9th; the tenant-local one must report the 10th.
    const instant = new Date("2026-03-09T19:00:00.000Z");
    expect(workDateFor(instant, "UTC")).toBe("2026-03-09");
    expect(workDateFor(instant, "Asia/Kolkata")).toBe("2026-03-10");
  });

  test("early-morning US Eastern rolls the UTC date forward a day", () => {
    // January, deliberately outside US DST (which starts in March), so the
    // offset is a fixed EST = UTC-5: 2026-01-09 23:00 EST is 2026-01-10 04:00
    // UTC — same instant, two different calendar dates.
    const instant = new Date("2026-01-10T04:00:00.000Z");
    expect(workDateFor(instant, "UTC")).toBe("2026-01-10");
    expect(workDateFor(instant, "America/New_York")).toBe("2026-01-09");
  });

  test("dayOfWeek shifts along with the date across the same boundary", () => {
    // Monday 19:00 UTC is Tuesday 00:30 in Kolkata.
    const instant = new Date("2026-03-09T19:00:00.000Z"); // a Monday in UTC
    const utc = zonedParts(instant, "UTC");
    const ist = zonedParts(instant, "Asia/Kolkata");
    expect(utc.dayOfWeek).toBe(1); // Monday
    expect(ist.dayOfWeek).toBe(2); // Tuesday
  });

  test("zonedToUtc is the inverse of workDateFor across the same boundary", () => {
    const workDate = "2026-03-10";
    const minutesSinceMidnight = 30; // 00:30 local
    const instant = zonedToUtc(workDate, minutesSinceMidnight, "Asia/Kolkata");
    expect(instant.toISOString()).toBe("2026-03-09T19:00:00.000Z");
    expect(workDateFor(instant, "Asia/Kolkata")).toBe(workDate);
  });
});
