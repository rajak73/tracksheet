/**
 * When an instructor may record their own day, and when a manager is asked.
 *
 * ── Three rules, and why each is a different kind of answer ───────────────
 *
 *   THE DAY        An instructor writes up a day that has HAPPENED. Today or
 *                  any day before it; never a day still to come.
 *
 *                  It was today-only, on the reasoning that a timesheet whose
 *                  entries can be backdated at will records what somebody
 *                  remembered later rather than when the work happened. The
 *                  client has decided otherwise: people miss a day, and a rule
 *                  that sends every one of those to a manager makes the manager
 *                  the bottleneck on their own roster's paperwork. The record
 *                  keeps its own audit trail either way — `createdAt` is when
 *                  it was written, `workDate` is the day it describes, and the
 *                  two being different is visible to anybody reading it.
 *
 *                  The future half stays a refusal, and it is not the same
 *                  kind of rule: a day that has not happened cannot be
 *                  reported on by anybody, at any level, however they ask.
 *
 *   THE SUBMISSION Written during the university's working hours. Staying late
 *                  and writing up at nine is a real thing that really happens,
 *                  so it is asked about rather than refused.
 *
 *   THE ACTIVITY   Each activity inside the working-hours window. Same reason:
 *                  legitimate, and also exactly how a working day quietly
 *                  stops matching the hours it is measured against.
 *
 * The distinction is deliberate. A hard block is for things that cannot be made
 * true by anybody agreeing to them; a request is for things that can.
 *
 * ── The window is the university's, computed for THAT date ────────────────
 * `computeDayWindows` already resolves working hours, holidays and non-working
 * days in the tenant's zone, DST-correct. Nothing here re-derives any of it.
 */

import { computeDayWindows } from "@/server/time/schedule-windows";
import { workDateFor } from "@/server/time/workday";
import { ApiError } from "@/server/http/errors";
import type { UniversityConfig } from "@/server/universities/config";

export type EntryVerdict =
  | { kind: "allowed" }
  | { kind: "blocked"; message: string }
  | {
      kind: "needs_approval";
      reason: "SUBMITTED_OFF_HOURS" | "ACTIVITY_OFF_HOURS" | "BOTH";
      message: string;
    };

/**
 * Whether work outside the university's hours needs a manager's approval.
 *
 * ── Off, for now, deliberately ────────────────────────────────────────────
 * The rule and its whole path are intact below — the reasons, the messages,
 * the manager's queue and the decision route all still work — but it is not
 * applied. An instructor's submission records straight away whatever the clock
 * says.
 *
 * It was switched off because a held day records NOTHING until somebody
 * decides it, so an instructor writing up an early start watched their edit
 * appear to do nothing at all. Until the approval flow is something a manager
 * actually works through daily, the honest default is to record what people
 * tell us and let a manager query it afterwards, rather than to drop it on the
 * floor while waiting.
 *
 * Turning it back on is this one constant. Nothing else has to change.
 */
const APPROVAL_REQUIRED = false;

/** The latest date an instructor may write up: their university's today. */
export function todayFor(config: UniversityConfig, now: Date = new Date()): string {
  return workDateFor(now, config.timezone);
}

/**
 * THE DAY rule, for the routes that do not go through `verifyEntry`.
 *
 * ── Why this exists separately ────────────────────────────────────────────
 * `verifyEntry` above enforces all three rules for a NARRATIVE submission, and
 * for a long time that was the only way an instructor recorded anything. The
 * four-field quick entry, its per-row edit, and the activity edit/delete routes
 * grew alongside it and never picked the day rule up — so the paragraph box
 * refused a backdated day while the pencil beside the row on that same day
 * happily rewrote it. The rule was real and half-applied, which is worse than
 * either applying it or dropping it, because the screen offered one answer and
 * the server gave another.
 *
 * ── Still scoped to SELF, and now only about the future ──────────────────
 * The check is kept scoped rather than deleted. What it refuses has narrowed
 * to one thing — a date that has not arrived — but that thing is worth a hard
 * refusal at every level, and keeping the function is what stops the four call
 * sites growing four different opinions about it again.
 *
 * `workDate` is a YYYY-MM-DD in the university's own zone, which is the only
 * zone any day boundary in this product is judged in.
 */
export function assertSelfMayWriteDay(input: {
  scope: { kind: "global" | "university" | "self" };
  config: UniversityConfig;
  workDate: string;
  now?: Date;
}): void {
  if (input.scope.kind !== "self") return;

  const today = todayFor(input.config, input.now ?? new Date());
  // Today and everything before it. Only the future is refused.
  if (input.workDate <= today) return;

  throw new ApiError(
    400,
    "WORKLOG_DATE_NOT_ALLOWED",
    "You cannot record a day that has not happened yet.",
  );
}

/**
 * Decides what happens to a submission.
 *
 * `activityWindows` are the parsed clock ranges, as minutes past midnight in
 * the university's zone. Passing them in rather than re-parsing keeps this
 * function pure and testable against a clock the test controls.
 */
export function verifyEntry(input: {
  config: UniversityConfig;
  workDate: string;
  /** When Submit was pressed. */
  now: Date;
  /** Parsed activities, as local minutes. Empty at submission time is fine. */
  activityWindows: Array<{ startMinute: number; endMinute: number }>;
}): EntryVerdict {
  const { config, workDate, now, activityWindows } = input;

  // 1. The day. A refusal, and it is checked first because nothing else about a
  //    submission for a date that cannot be written is worth computing.
  const today = todayFor(config, now);
  if (workDate > today) {
    return { kind: "blocked", message: "You cannot write up a day that has not happened yet." };
  }

  const windows = computeDayWindows(config, workDate);

  // With approval switched off, the only rule left is the DAY, and it now
  // refuses the future alone — a past day is a day that happened, which is the
  // only question this rule was ever really asking.
  if (!APPROVAL_REQUIRED) return { kind: "allowed" };

  // A non-working day has no window to be inside, so everything about it is an
  // exception by definition rather than by comparison.
  if (!windows.isWorkingDay || !windows.workingHours) {
    return {
      kind: "needs_approval",
      reason: "BOTH",
      message:
        `${workDate} is not a working day at your university` +
        `${windows.holiday ? ` (${windows.holiday.name})` : ""}. ` +
        "Your worklog has been sent to your manager to approve.",
    };
  }

  const { startMinute, endMinute, startLocal, endLocal } = windows.workingHours;

  // 2. The submission's own time, in the university's zone.
  const submittedMinute = localMinuteOf(now, config.timezone);
  const submittedOffHours = submittedMinute < startMinute || submittedMinute > endMinute;

  // 3. Each activity. Half-open at the end: an activity finishing exactly at
  //    closing time is inside the day, not outside it.
  const activityOffHours = activityWindows.some(
    (a) => a.startMinute < startMinute || a.endMinute > endMinute,
  );

  if (!submittedOffHours && !activityOffHours) return { kind: "allowed" };

  const reason =
    submittedOffHours && activityOffHours
      ? "BOTH"
      : submittedOffHours
        ? "SUBMITTED_OFF_HOURS"
        : "ACTIVITY_OFF_HOURS";

  const hours = `${startLocal}–${endLocal}`;
  const message =
    reason === "BOTH"
      ? `Your worklog was written outside ${hours} and includes work outside those hours, so it has been sent to your manager to approve.`
      : reason === "SUBMITTED_OFF_HOURS"
        ? `Your worklog was written outside your university's hours (${hours}), so it has been sent to your manager to approve.`
        : `Some of your activities fall outside your university's hours (${hours}), so your worklog has been sent to your manager to approve.`;

  return { kind: "needs_approval", reason, message };
}

/** Minutes past midnight as the university's clock reads this instant. */
export function localMinuteOf(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).formatToParts(instant);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}
