import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { instructorWhere, narrowManager } from "@/server/auth/scope";
import { computeAnalytics } from "@/server/analytics/engine";
import { assertValidDate } from "@/server/time/schedule-windows";
import { daySubjectsFor } from "@/server/instructors/day-subject";
import { loadUniversityConfig } from "@/server/universities/config";

/**
 * A manager's worklog: who on their roster recorded what, day by day.
 *
 * ── One endpoint, three views ──────────────────────────────────────────────
 * Day, Week and Month differ only in the range asked for. They are not three
 * queries and not three shapes: each instructor comes back with a per-DAY
 * series, and the client sums it however the current view needs. Three
 * endpoints would be three places for "did this person log anything" to end up
 * meaning three different things.
 *
 * ── Status is the product's own capacity rule, not a new threshold ─────────
 * The engine already knows each instructor's contracted capacity for each day,
 * because the whole utilisation model is built on it. So:
 *
 *     no capacity that day        -> not counted at all (weekend, holiday, leave)
 *     nothing recorded            -> missing
 *     recorded, below capacity    -> partial
 *     recorded, at or above       -> complete
 *
 * Nothing here invents a percentage. A manager asking "who has not submitted?"
 * gets an answer derived from the same capacity figure their dashboard uses.
 *
 * ── Scope comes from the session ───────────────────────────────────────────
 * The roster is read using `narrowManager`, which for a manager returns their
 * OWN id and refuses any other. There is no `managerId` parameter a caller
 * could send, and an `instructorId` filter is intersected with that roster
 * rather than trusted — naming somebody else's instructor narrows to nothing
 * rather than widening to them.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A month of a large roster is the widest this is meant to serve. */
const MAX_RANGE_DAYS = 62;

type DayCell = {
  date: string;
  hours: number;
  activityCount: number;
  isWorkingDay: boolean;
  capacityHours: number;
  status: "complete" | "partial" | "missing" | "off";
};

function statusOf(day: {
  isWorkingDay: boolean;
  capacityHours: number;
  productiveHours: number;
}): DayCell["status"] {
  if (!day.isWorkingDay || day.capacityHours <= 0) return "off";
  if (day.productiveHours <= 0) return "missing";
  return day.productiveHours >= day.capacityHours ? "complete" : "partial";
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Whether an entry has been confirmed by the person it belongs to.
 *
 * ── Derived, never stored ─────────────────────────────────────────────────
 * There is no "confirmed" column, and there should not be: the fact already
 * exists in the submission that produced the row, and a second copy is a second
 * thing to keep true.
 *
 *     no submission        typed straight in, by the instructor or a manager.
 *                          A person chose every field, so there is nothing for
 *                          anybody to check — CONFIRMED.
 *     awaiting approval    read, but held outside the university's hours and
 *                          not yet decided. (Activities are not written until
 *                          approval, so this is defensive rather than reachable.)
 *     reviewed             the instructor opened what the reader made of their
 *                          sentence and either corrected it or accepted it —
 *                          CONFIRMED.
 *     otherwise            a model's reading that no human has looked at yet.
 *                          NEEDS REVIEW.
 *
 * The distinction matters to a manager precisely because the middle case is a
 * machine's opinion presented as a fact. Marking it "confirmed" because it
 * happens to be in the table would be the one dishonest thing this column
 * could do.
 */
function entryStatus(log: {
  submissionId: string | null;
  submission: { reviewedAt: Date | null; approval: string } | null;
}): "confirmed" | "needs_review" | "awaiting_approval" {
  if (!log.submissionId || !log.submission) return "confirmed";
  if (log.submission.approval === "PENDING") return "awaiting_approval";
  return log.submission.reviewedAt ? "confirmed" : "needs_review";
}

/**
 * The worklogs waiting on this manager, oldest first.
 *
 * Returned alongside the range the page asked for rather than from a second
 * endpoint, because "who is waiting on me" is not a question about a date
 * range: a day held last Tuesday is still held today, and a queue that only
 * showed what the calendar was pointing at would let one sit unseen.
 */
async function pendingApprovals(
  where: Record<string, unknown>,
  /** Also show instructors nobody leads. See below. */
  includeUnassigned: boolean,
) {
  const rows = await prisma.worklogSubmission.findMany({
    where: {
      approval: "PENDING",
      supersededAt: null,
      instructor: includeUnassigned
        ? { OR: [where, { ...where, managerId: null }] }
        : where,
    },
    orderBy: { submittedAt: "asc" },
    take: 50,
    select: {
      id: true,
      workDate: true,
      submittedAt: true,
      rawBullets: true,
      exceptionReason: true,
      instructor: {
        select: { id: true, employeeCode: true, user: { select: { name: true } } },
      },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    workDate: r.workDate.toISOString().slice(0, 10),
    submittedAt: r.submittedAt.toISOString(),
    exceptionReason: r.exceptionReason,
    instructorId: r.instructor.id,
    instructorName: r.instructor.user.name,
    employeeCode: r.instructor.employeeCode,
    // The sentences themselves: a manager cannot decide a day they cannot read.
    bullets: Array.isArray(r.rawBullets) ? (r.rawBullets as string[]) : [],
  }));
}

export const GET = withAuth(async ({ scope, req }) => {
  const sp = req.nextUrl.searchParams;
  const from = sp.get("from");
  const to = sp.get("to");

  if (!from || !to || !DAY.test(from) || !DAY.test(to)) {
    throw new ApiError(400, "INVALID_PERIOD", "Provide `from` and `to` as YYYY-MM-DD.");
  }
  if (from > to) {
    throw new ApiError(400, "INVALID_PERIOD", "`from` must not be after `to`.");
  }
  /* Shape is not a calendar. `2026-02-31` passes the regex above; `Date.parse`
   * then gives NaN, every comparison against NaN is false, and the range cap
   * below was skipped entirely. The sibling worklog-notes route calls this for
   * exactly that reason. */
  assertValidDate(from);
  assertValidDate(to);
  const spanDays =
    Math.round(
      (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000,
    ) + 1;
  if (spanDays > MAX_RANGE_DAYS) {
    throw new ApiError(400, "PERIOD_TOO_LONG", `Ask for at most ${MAX_RANGE_DAYS} days at a time.`);
  }

  // The roster, from the session. `narrowManager` throws for an instructor and
  // pins a manager to their own id.
  /* ── Who a manager answers for ───────────────────────────────────────────
   * Their own roster, plus — if they are the university's PRIMARY manager —
   * the instructors nobody leads yet. An unassigned instructor is in nobody's
   * roster by definition, so without this their work appears on no manager's
   * screen at all: they record a day and it is seen only by an admin. Their
   * notifications and their held worklogs already go to the primary manager,
   * so their rows do too.
   */
  /* The primary manager OF THIS CALLER'S UNIVERSITY.
   *
   * This was `findFirst({ where: { primaryManagerId: { not: null } } })` with a
   * tenant filter that expanded to `{}` in both branches — so on a multi-tenant
   * install it returned whichever university happened to sort first, and a
   * primary manager of any OTHER university failed the comparison below. Their
   * unassigned instructors then belonged to no roster at all: absent from the
   * table, the counts and the approval queue, with nothing to say so. */
  const primary =
    scope.kind === "university"
      ? await prisma.university.findUnique({
          where: { id: scope.universityId },
          select: { id: true, primaryManagerId: true },
        })
      : null;
  const answersForUnassigned =
    scope.kind === "global" ||
    (scope.kind === "university" &&
      primary?.primaryManagerId != null &&
      primary.primaryManagerId === scope.managerId);

  const mine = { ...instructorWhere(scope), ...narrowManager(scope, null), user: { isActive: true } };

  const roster = await prisma.instructor.findMany({
    where: answersForUnassigned
      ? { OR: [mine, { ...instructorWhere(scope), managerId: null, user: { isActive: true } }] }
      : mine,
    select: {
      id: true,
      employeeCode: true,
      // The assigned Broad Category, which is what the sheet's column prints.
      category: { select: { code: true, label: true } },
      universityId: true,
      // The photo, so a manager scanning twenty rows recognises a face before
      // they read a name — which is how people actually find somebody in a list.
      user: { select: { name: true, avatarUrl: true } },
      // Times are rendered in the UNIVERSITY's zone, never the reader's.
      university: { select: { timezone: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  if (roster.length === 0) {
    // The SAME shape as the loaded response. It used to omit `approvals` and
    // `rosterTotal`, so a manager with an empty roster got an object the page
    // then read `.approvals.length` from — an empty roster crashed the screen
    // that exists to tell you it is empty.
    return NextResponse.json({
      approvals: [],
      period: { from, to },
      timezone: null,
      rosterTotal: 0,
      summary: { instructors: 0, submitted: 0, missing: 0, totalHours: 0, totalActivities: 0 },
      instructors: [],
    });
  }

  const rosterIds = new Set(roster.map((i) => i.id));
  const universityId = roster[0]!.universityId;

  // ONE engine pass for the whole range. It already produces the per-instructor,
  // per-day capacity and productive hours every view below needs.
  const analytics = await computeAnalytics({ universityId, from, to });

  /* What each office day was ABOUT, with a quiet day inheriting from the last
   * one that named a subject. Computed on the server because the inheritance
   * reaches back before the window the sheet asked for, and the browser only
   * has the window. */
  const daySubjects = await daySubjectsFor(
    roster.map((i) => i.id),
    from,
    to,
    await loadUniversityConfig(universityId),
  );

  // The activities themselves, for the day view's timeline. Bounded by the same
  // range and the same roster, so this cannot become a way to read the tenant.
  const logs = await prisma.activityLog.findMany({
    where: {
      instructorId: { in: [...rosterIds] },
      workDate: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) },
    },
    select: {
      id: true,
      instructorId: true,
      workDate: true,
      startTime: true,
      endTime: true,
      status: true,
      remarks: true,
      activityType: { select: { code: true, label: true } },
      // A timeline block has room for one line, and "Teaching" on its own does
      // not tell a manager anything they did not already know from the colour.
      // The deliverable and the instructor's own remark are what make the block
      // worth reading: "Lecture — deadlock handling, section A".
      deliverableType: { select: { code: true, label: true, isCountable: true } },
        broadCategory: { select: { code: true, label: true } },
      quantity: true,
      rawText: true,
      // Where the row came from, and whether anybody has looked at it since.
      // This is what the entry table's Status column is derived from — see
      // `entryStatus`. Nothing is stored per activity; the answer belongs to
      // the submission that produced it, so it is read from there.
      submissionId: true,
      submission: { select: { reviewedAt: true, escalatedAt: true, approval: true } },
    },
    orderBy: [{ workDate: "asc" }, { startTime: "asc" }],
  });

  /* Their own remarks about each day. Read alongside the activities because a
   * manager reading a row wants what the person SAID about it, not a summary
   * assembled from the topics the reader happened to extract. */
  const notes = await prisma.worklogDayNote.findMany({
    where: {
      instructorId: { in: [...rosterIds] },
      workDate: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) },
    },
    select: { instructorId: true, workDate: true, note: true },
  });

  const notesByInstructor = new Map<string, Record<string, string>>();
  for (const n of notes) {
    const bucket = notesByInstructor.get(n.instructorId) ?? {};
    bucket[n.workDate.toISOString().slice(0, 10)] = n.note;
    notesByInstructor.set(n.instructorId, bucket);
  }

  const byInstructor = new Map<string, typeof logs>();
  for (const log of logs) {
    const bucket = byInstructor.get(log.instructorId);
    if (bucket) bucket.push(log);
    else byInstructor.set(log.instructorId, [log]);
  }

  const search = (sp.get("search") ?? "").trim().toLowerCase();
  const wantedInstructor = sp.get("instructorId");
  const wantedType = sp.get("activityType");
  const wantedStatus = sp.get("status");

  const rows = roster
    .filter((i) => !wantedInstructor || i.id === wantedInstructor)
    // Name or employee code — the two things somebody actually types.
    .filter(
      (i) =>
        !search ||
        i.user.name.toLowerCase().includes(search) ||
        (i.employeeCode ?? "").toLowerCase().includes(search),
    )
    .map((instructor) => {
      const engineRow = analytics.instructors.find((r) => r.instructorId === instructor.id);
      const mine = (byInstructor.get(instructor.id) ?? []).filter(
        (log) => !wantedType || log.activityType.code === wantedType,
      );

      const countByDate = new Map<string, number>();
      for (const log of mine) {
        const date = log.workDate.toISOString().slice(0, 10);
        countByDate.set(date, (countByDate.get(date) ?? 0) + 1);
      }

      const days: DayCell[] = (engineRow?.days ?? []).map((day) => ({
        date: day.date,
        hours: round(day.productiveHours),
        activityCount: countByDate.get(day.date) ?? 0,
        isWorkingDay: day.isWorkingDay,
        capacityHours: round(day.capacityHours),
        status: statusOf(day),
      }));

      const totalHours = round(days.reduce((n, d) => n + d.hours, 0));
      const activityCount = mine.length;

      // Across the range: missing if not one working day was recorded, complete
      // if every working day was, partial in between.
      const working = days.filter((d) => d.status !== "off");
      const recorded = working.filter((d) => d.status !== "missing").length;
      const status: DayCell["status"] =
        working.length === 0
          ? "off"
          : recorded === 0
            ? "missing"
            : recorded === working.length && working.every((d) => d.status === "complete")
              ? "complete"
              : "partial";

      return {
        instructorId: instructor.id,
        name: instructor.user.name,
        avatarUrl: instructor.user.avatarUrl,
        employeeCode: instructor.employeeCode,
        totalHours,
        activityCount,
        status,
        days,
        /* The Broad Category the client's sheet prints: the one assigned to
         * this person, preserved exactly.
         *
         * It used to be `subjectByDate` — what each office day was judged to be
         * about, inherited from the last day that named a subject. The client's
         * rule is now that this column is supplied and that nobody may "guess
         * the employee's broad category from their activities", which is
         * precisely what that inheritance did. */
        category: instructor.category,
        /* Still sent, and still per office day, because the day view shows what
         * each day was ABOUT beneath the entries — a different question from
         * who the person is, and one the client did not change. */
        subjectByDate: Object.fromEntries(daySubjects.get(instructor.id) ?? []),
        notes: notesByInstructor.get(instructor.id) ?? {},
        activities: mine.map((log) => ({
          id: log.id,
          date: log.workDate.toISOString().slice(0, 10),
          startTime: log.startTime.toISOString(),
          endTime: log.endTime.toISOString(),
          durationHours: round((log.endTime.getTime() - log.startTime.getTime()) / 3_600_000),
          remarks: log.remarks,
          // The sheets exclude an absence from Working Hours, which they can
          // only do if the payload says so.
          status: log.status,
          activityType: log.activityType,
          deliverableType: log.deliverableType,
          broadCategory: log.broadCategory,
          quantity: log.quantity,
          rawText: log.rawText,
          entryStatus: entryStatus(log),
          // Overdue rather than merely unreviewed. Kept separate from the
          // status so a manager can tell "nobody has checked this yet" from
          // "nobody checked it and the deadline has passed".
          escalated: Boolean(log.submission?.escalatedAt) && !log.submission?.reviewedAt,
        })),
      };
    })
    // Status is filtered last: it is a property of the FILTERED activity set,
    // so narrowing by activity type can legitimately turn a complete day into a
    // missing one, and the count must reflect what is on screen.
    .filter((row) => !wantedStatus || row.status === wantedStatus);

  /* ── Who answers for an instructor nobody leads ─────────────────────────
   * An unassigned instructor's held day would otherwise belong to no queue at
   * all: `narrowManager` pins a manager to their own roster, and nobody's
   * roster contains them. Their notification already goes to the university's
   * primary manager, so their approval does too — the alternative is a day
   * that stays unrecorded because the person who could decide it was never
   * shown it.
   */
  // Same rule as the roster above, so the queue and the table agree about who
  // this manager answers for.
  const approvals = await pendingApprovals(mine, answersForUnassigned);

  return NextResponse.json({
    approvals,
    period: { from, to },
    timezone: roster[0]!.university.timezone,
    // The size of the roster BEFORE any filter, so the page can say "showing 3
    // of 28" — a filtered count on its own cannot tell you what it is 3 of.
    rosterTotal: roster.length,
    summary: {
      instructors: rows.length,
      submitted: rows.filter((r) => r.status !== "missing" && r.status !== "off").length,
      missing: rows.filter((r) => r.status === "missing").length,
      totalHours: round(rows.reduce((n, r) => n + r.totalHours, 0)),
      totalActivities: rows.reduce((n, r) => n + r.activityCount, 0),
    },
    instructors: rows,
  });
}, { roles: ["MANAGER", "ADMIN"] });
