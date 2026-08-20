/**
 * Data-quality exception detection.
 *
 * Every flag here is DERIVED from `ActivityLog`, the university's configuration,
 * and approved leave — computed on read, never stored. There is deliberately no
 * `exceptions` table: a stored flag is a second source of truth that goes stale
 * the moment the activity behind it changes, and a flag an operator can edit
 * independently of the data it describes is worse than no flag at all.
 *
 * The cost of computing on read is bounded by the same indexes the analytics
 * engine uses, over the same window. If that ever becomes too slow, the fix is
 * to precompute into the existing rollup job — NOT to let anyone write a flag
 * by hand.
 *
 * A note on what is deliberately NOT flagged: a working day with no records is
 * MISSING_ACTIVITY ("we do not know what happened"), never absence. Asserting
 * someone did not work requires positive evidence, which is what
 * UNEXPECTED_ABSENCE requires.
 */

import { prisma } from "@/server/db";
import { computeDayWindows } from "@/server/time/schedule-windows";
import { workDateFor } from "@/server/time/workday";
import { loadUniversityConfig } from "@/server/universities/config";
import { eachDate } from "@/server/analytics/engine";

export const EXCEPTION_TYPES = [
  "MISSING_ACTIVITY",
  "OVERLAPPING_ACTIVITY",
  "LATE_OPENING",
  "MISSED_CLOSING",
  "UNEXPECTED_ABSENCE",
  "OUTSIDE_WORKING_HOURS",
  "DUPLICATE_LOG",
  "INVALID_DURATION",
] as const;

export type ExceptionType = (typeof EXCEPTION_TYPES)[number];
export type ExceptionSeverity = "LOW" | "MEDIUM" | "HIGH";

export type ExceptionFlag = {
  type: ExceptionType;
  severity: ExceptionSeverity;
  instructorId: string;
  instructorName: string;
  date: string;
  /** Neutral description of the measurement, never a judgement about a person. */
  detail: string;
  /** The values that produced the flag, so it can be checked rather than trusted. */
  evidence: Record<string, unknown>;
};

export type ExceptionQuery = {
  universityId: string;
  from: string;
  to: string;
  instructorId?: string;
  /**
   * Restrict to one manager's roster. Supplied by the route from
   * `narrowManager`, so an admin passes undefined and still sees the whole
   * university while a manager cannot widen past their own people.
   */
  managerId?: string | null;
  types?: ExceptionType[];
};

export type ExceptionResult = {
  universityId: string;
  from: string;
  to: string;
  summary: Record<ExceptionType, number>;
  total: number;
  /** Capped page of flags; `total` is the true count. */
  exceptions: ExceptionFlag[];
};

const MAX_RETURNED = 500;
const MS_PER_MIN = 60_000;

function emptySummary(): Record<ExceptionType, number> {
  return Object.fromEntries(EXCEPTION_TYPES.map((t) => [t, 0])) as Record<
    ExceptionType,
    number
  >;
}

export async function detectExceptions(query: ExceptionQuery): Promise<ExceptionResult> {
  const { universityId, from, to } = query;
  const config = await loadUniversityConfig(universityId);

  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);

  const [instructors, logs, leaves] = await Promise.all([
    prisma.instructor.findMany({
      where: {
        universityId,
        ...(query.instructorId ? { id: query.instructorId } : {}),
        ...(query.managerId ? { managerId: query.managerId } : {}),
        user: { isActive: true },
      },
      select: { id: true, user: { select: { name: true } } },
    }),
    prisma.activityLog.findMany({
      where: {
        universityId,
        workDate: { gte: fromDate, lte: toDate },
        ...(query.instructorId ? { instructorId: query.instructorId } : {}),
        ...(query.managerId ? { instructor: { managerId: query.managerId } } : {}),
      },
      select: {
        id: true,
        instructorId: true,
        workDate: true,
        startTime: true,
        endTime: true,
        status: true,
        activityType: {
          select: { code: true, countsAsProductive: true, isOncePerDay: true },
        },
      },
      orderBy: { startTime: "asc" },
    }),
    prisma.leaveRequest.findMany({
      where: {
        universityId,
        status: "APPROVED",
        startDate: { lte: toDate },
        endDate: { gte: fromDate },
        ...(query.instructorId ? { instructorId: query.instructorId } : {}),
        ...(query.managerId ? { instructor: { managerId: query.managerId } } : {}),
      },
      select: { instructorId: true, startDate: true, endDate: true },
    }),
  ]);

  const leaveByInstructor = new Map<string, Array<{ start: string; end: string }>>();
  for (const l of leaves) {
    const list = leaveByInstructor.get(l.instructorId) ?? [];
    list.push({ start: workDateFor(l.startDate, "UTC"), end: workDateFor(l.endDate, "UTC") });
    leaveByInstructor.set(l.instructorId, list);
  }
  const onLeave = (instructorId: string, date: string) =>
    (leaveByInstructor.get(instructorId) ?? []).some((r) => date >= r.start && date <= r.end);

  // instructorId -> date -> logs
  const byInstructorDate = new Map<string, Map<string, typeof logs>>();
  for (const log of logs) {
    const date = workDateFor(log.workDate, "UTC");
    let perDate = byInstructorDate.get(log.instructorId);
    if (!perDate) byInstructorDate.set(log.instructorId, (perDate = new Map()));
    const bucket = perDate.get(date);
    if (bucket) bucket.push(log);
    else perDate.set(date, [log]);
  }

  const flags: ExceptionFlag[] = [];
  const dates = eachDate(from, to);

  for (const instructor of instructors) {
    const perDate = byInstructorDate.get(instructor.id) ?? new Map<string, typeof logs>();
    const name = instructor.user.name;

    for (const date of dates) {
      const windows = computeDayWindows(config, date);
      const dayLogs = perDate.get(date) ?? [];

      const add = (
        type: ExceptionType,
        severity: ExceptionSeverity,
        detail: string,
        evidence: Record<string, unknown>,
      ) => flags.push({ type, severity, instructorId: instructor.id, instructorName: name, date, detail, evidence });

      // Nothing is expected on a non-working day or an approved leave day, so
      // no absence of data can be an exception there.
      const isLeave = onLeave(instructor.id, date);
      if (!windows.isWorkingDay || isLeave) {
        continue;
      }

      // ── MISSING_ACTIVITY — expected working day, no records, no explanation.
      if (dayLogs.length === 0) {
        add(
          "MISSING_ACTIVITY",
          "MEDIUM",
          `No activity recorded for a working day (${windows.workingHours?.durationMinutes ?? 0} min expected).`,
          {
            expectedMinutes: windows.workingHours?.durationMinutes ?? 0,
            hasApprovedLeave: false,
            isHoliday: false,
          },
        );
        // A day with no records cannot also be a late opening or missed
        // closing — flagging all three would triple-count one fact.
        continue;
      }

      // ── UNEXPECTED_ABSENCE — positive evidence, not merely missing data.
      for (const log of dayLogs.filter((l) => l.status === "MISSED")) {
        add("UNEXPECTED_ABSENCE", "HIGH", `Activity ${log.activityType.code} marked MISSED without approved leave.`, {
          activityLogId: log.id,
          activityType: log.activityType.code,
          status: log.status,
        });
      }

      // ── LATE_OPENING — opening logged after its configured window closed.
      const opening = dayLogs.find((l) => l.activityType.code === "DAILY_OPENING");
      if (opening && windows.opening) {
        const expectedEnd = new Date(windows.opening.endUtc).getTime();
        if (opening.startTime.getTime() > expectedEnd) {
          const lateBy = Math.round((opening.startTime.getTime() - expectedEnd) / MS_PER_MIN);
          add("LATE_OPENING", "LOW", `Daily opening started ${lateBy} min after its configured window.`, {
            expectedWindow: `${windows.opening.startLocal}–${windows.opening.endLocal}`,
            lateByMinutes: lateBy,
            activityLogId: opening.id,
          });
        }
      }

      // ── MISSED_CLOSING — the day has activity but no closing record.
      const hasClosing = dayLogs.some((l) => l.activityType.code === "DAILY_CLOSING");
      if (!hasClosing) {
        add("MISSED_CLOSING", "MEDIUM", "Activity was recorded for this working day but no daily closing.", {
          activityCount: dayLogs.length,
          expectedWindow: windows.closing
            ? `${windows.closing.startLocal}–${windows.closing.endLocal}`
            : null,
        });
      }

      // ── OUTSIDE_WORKING_HOURS — logged time beyond the configured window.
      if (windows.workingHours) {
        const dayStart = new Date(windows.workingHours.startUtc).getTime();
        const dayEnd = new Date(windows.workingHours.endUtc).getTime();
        for (const log of dayLogs) {
          if (log.startTime.getTime() < dayStart || log.endTime.getTime() > dayEnd) {
            add("OUTSIDE_WORKING_HOURS", "LOW", `Activity ${log.activityType.code} falls partly outside configured working hours.`, {
              activityLogId: log.id,
              workingHours: `${windows.workingHours.startLocal}–${windows.workingHours.endLocal}`,
              activityStartUtc: log.startTime.toISOString(),
              activityEndUtc: log.endTime.toISOString(),
            });
          }
        }

        // ── INVALID_DURATION — longer than the working day itself.
        // Note: a zero or negative duration cannot occur; the
        // `activity_log_positive_interval` CHECK constraint rejects it at write
        // time. This detector therefore covers only implausibly long records,
        // which are reachable (e.g. a bad import).
        const dayMinutes = windows.workingHours.durationMinutes;
        for (const log of dayLogs) {
          const minutes = Math.round((log.endTime.getTime() - log.startTime.getTime()) / MS_PER_MIN);
          if (minutes > dayMinutes) {
            add("INVALID_DURATION", "HIGH", `Activity spans ${minutes} min, longer than the ${dayMinutes} min working day.`, {
              activityLogId: log.id,
              durationMinutes: minutes,
              workingDayMinutes: dayMinutes,
            });
          }
        }
      }

      // ── DUPLICATE_LOG — same type and identical interval, logged twice.
      const seen = new Map<string, string>();
      for (const log of dayLogs) {
        const key = `${log.activityType.code}|${log.startTime.getTime()}|${log.endTime.getTime()}`;
        const first = seen.get(key);
        if (first) {
          add("DUPLICATE_LOG", "MEDIUM", `Identical ${log.activityType.code} interval recorded more than once.`, {
            activityLogId: log.id,
            duplicateOfId: first,
          });
        } else {
          seen.set(key, log.id);
        }
      }

      // ── OVERLAPPING_ACTIVITY — per the Phase 3 policy, overlaps are stored
      // and merged in the maths rather than rejected, so they surface here as
      // a data-quality signal instead of a write error.
      const productive = dayLogs
        .filter((l) => l.activityType.countsAsProductive)
        .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
      for (let i = 1; i < productive.length; i++) {
        const prev = productive[i - 1];
        const cur = productive[i];
        if (cur.startTime.getTime() < prev.endTime.getTime()) {
          const overlapMin = Math.round(
            (Math.min(prev.endTime.getTime(), cur.endTime.getTime()) - cur.startTime.getTime()) /
              MS_PER_MIN,
          );
          add("OVERLAPPING_ACTIVITY", "LOW", `Two productive activities overlap by ${overlapMin} min; merged time is reported.`, {
            firstActivityLogId: prev.id,
            secondActivityLogId: cur.id,
            overlapMinutes: overlapMin,
          });
        }
      }
    }
  }

  const wanted = query.types?.length ? new Set(query.types) : null;
  const filtered = wanted ? flags.filter((f) => wanted.has(f.type)) : flags;

  const summary = emptySummary();
  for (const f of filtered) summary[f.type] += 1;

  filtered.sort((a, b) => (a.date === b.date ? a.type.localeCompare(b.type) : a.date.localeCompare(b.date)));

  return {
    universityId,
    from,
    to,
    summary,
    total: filtered.length,
    exceptions: filtered.slice(0, MAX_RETURNED),
  };
}
