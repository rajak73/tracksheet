import { prisma } from "@/server/db";
import { workDateFor, toDateOnly, zonedToUtc } from "@/server/time/workday";
import { ApiError } from "@/server/http/errors";
import { ActivityStatus } from "@/generated/prisma/client";

/**
 * The interval an activity covers, in one of two forms:
 *
 * - `startTime`/`endTime`: absolute instants. Correct when the caller already
 *   has real instants (tests, integrations).
 * - `local`: wall-clock fields exactly as a person typed them — "2043-04-05,
 *   10:00 to 11:00" — resolved HERE against the UNIVERSITY's timezone.
 *
 * The local form exists because the browser used to build instants itself
 * with `new Date("2043-04-05T10:00")`, which reads the BROWSER's zone. An
 * instructor in a Kolkata browser posting to a New-York university produced
 * an instant whose university-local calendar day was 2043-04-04 — work
 * silently booked on the wrong day, corrupting the daily rollup and
 * opening/closing compliance. The standing rule is that workDate derives
 * from the university's IANA zone, never the server's or the browser's; the
 * only place that can honour it is here, where the timezone is loaded.
 */
export type LogActivityInput = {
  instructorId: string;
  universityId: string;
  activityTypeCode: string;
  startTime?: Date;
  endTime?: Date;
  /** Wall-clock in the university's zone: `date` YYYY-MM-DD, times HH:MM. */
  local?: { date: string; start: string; end: string };
  status?: ActivityStatus;
  /** `null` clears one; absent leaves it as it stands. */
  remarks?: string | null;
  /** Which subject the entry was about. `null` is a real answer — no subject. */
  broadCategoryId?: string | null;
  /**
   * Set when re-validating an EDIT. The overlap check skips this id so an
   * activity is never reported as conflicting with itself.
   */
  excludeActivityId?: string;

  /* ── Free-text worklog provenance (Phase 12) ────────────────────────────
   * Present only when this row came from a parsed bullet. Every rule above
   * applies unchanged: a parsed activity is validated exactly as a typed one,
   * because the source of a claim does not make it truer.
   */
  /** The bullet this was parsed from, exactly as written. Never rewritten. */
  rawText?: string;
  /** The submission the bullet belonged to. */
  submissionId?: string;
  /** The deliverable within the category, from the closed taxonomy. */
  deliverableTypeId?: string | null;
  /** How many of that deliverable this row accounts for. */
  quantity?: number;
};

/** A single activity may not span more than one working day's worth of time. */
const MAX_ACTIVITY_HOURS = 24;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Records an activity. Every rule below — timezone resolution, interval
 * validity, once-per-day, overlap, the advisory lock — applies identically
 * whether the row is being created or corrected, which is exactly why editing
 * goes through this function rather than a second, quietly-diverging copy.
 *
 * `targetId` selects which: `null` inserts, an id updates that row in place.
 * Updating in place keeps the record's identity, so its audit history and
 * anything referencing it stay attached to the same activity.
 */
async function writeActivity(input: LogActivityInput, targetId: string | null) {
  if (!input.local && (!input.startTime || !input.endTime)) {
    throw new ApiError(
      400,
      "INVALID_INTERVAL",
      "Provide either startTime/endTime or local {date, start, end}",
    );
  }

  // 1. Fetch university timezone and activity type config. The timezone has
  //    to come first now: resolving a local wall-clock into an instant needs
  //    it, so interval validation moves after this load.
  const [university, activityType] = await Promise.all([
    prisma.university.findUnique({
      where: { id: input.universityId },
      select: { timezone: true },
    }),
    prisma.activityType.findUnique({
      where: { code: input.activityTypeCode },
    }),
  ]);

  if (!university) {
    throw new ApiError(404, "UNIVERSITY_NOT_FOUND", "University not found");
  }
  if (!activityType) {
    throw new ApiError(404, "ACTIVITY_TYPE_NOT_FOUND", "Activity type not found");
  }

  let startTime: Date;
  let endTime: Date;
  if (input.local) {
    const { date, start, end } = input.local;
    if (!YMD.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00.000Z`))) {
      throw new ApiError(400, "INVALID_INTERVAL", "local.date must be a valid YYYY-MM-DD date");
    }
    if (!HHMM.test(start) || !HHMM.test(end)) {
      throw new ApiError(400, "INVALID_INTERVAL", "local times must be HH:MM");
    }
    // Resolved in the UNIVERSITY's zone, DST-aware — the same helper the
    // schedule-window engine uses, so form entry and window computation can
    // never disagree about what "10:00 in Kolkata" means.
    startTime = zonedToUtc(date, minutesOf(start), university.timezone);
    endTime = zonedToUtc(date, minutesOf(end), university.timezone);
  } else {
    startTime = input.startTime!;
    endTime = input.endTime!;
  }

  // 0/2. Reject impossible intervals BEFORE anything is written. A row where
  //      endTime precedes startTime yields a negative duration that silently
  //      subtracts from every aggregate downstream, which is far worse than a
  //      rejected request.
  const durationMs = endTime.getTime() - startTime.getTime();
  if (Number.isNaN(durationMs)) {
    throw new ApiError(400, "INVALID_INTERVAL", "startTime and endTime must be valid dates");
  }
  if (durationMs <= 0) {
    throw new ApiError(400, "INVALID_INTERVAL", "endTime must be after startTime");
  }
  if (durationMs > MAX_ACTIVITY_HOURS * 3_600_000) {
    throw new ApiError(
      400,
      "INVALID_INTERVAL",
      `An activity may not exceed ${MAX_ACTIVITY_HOURS} hours`,
    );
  }

  // Derive workDate (tenant-local calendar)
  const workDateString = workDateFor(startTime, university.timezone);
  const workDate = toDateOnly(workDateString);

  // 3-5. Duplicate, overlap and insert — all inside ONE transaction guarded by
  //       an advisory lock.
  //
  //       WHY THE LOCK: the previous implementation did read-then-write with no
  //       transaction, so two concurrent requests both read "no conflict" and
  //       both inserted. A double-clicked Save, or two tabs, produced two
  //       overlapping records. Checking harder does not fix that — only
  //       serialising the check-and-insert does.
  //
  //       The lock key is (instructorId, workDate): concurrent writes for the
  //       SAME instructor on the SAME day are serialised, while unrelated
  //       instructors and days stay fully parallel. `pg_advisory_xact_lock`
  //       releases automatically when the transaction ends, which is the same
  //       pattern the metric-rollup lease already uses in this codebase.
  const lockKey = `activity:${input.instructorId}:${workDateString}`;

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

    // Once-per-day types (daily opening / closing) may exist only once per
    // instructor per working day. The database also carries a partial unique
    // index for this; the explicit check exists to return a usable message
    // rather than a raw constraint violation.
    if (activityType.isOncePerDay) {
      const existing = await tx.activityLog.findFirst({
        where: {
          instructorId: input.instructorId,
          workDate,
          activityTypeId: activityType.id,
          // A row being corrected must not be reported as a duplicate of
          // itself, the same reason the overlap check excludes it.
          ...(targetId ? { id: { not: targetId } } : {}),
        },
        select: { id: true },
      });
      if (existing) {
        throw new ApiError(
          409,
          "DUPLICATE_ONCE_PER_DAY_ACTIVITY",
          `An activity of type ${input.activityTypeCode} already exists for ${workDateString}`,
        );
      }
    }

    // An instructor cannot be in two places at once, so a new activity may not
    // overlap one they already recorded that day.
    //
    // Overlap test is half-open [start, end): two intervals conflict when
    // `newStart < existingEnd && newEnd > existingStart`. Using strict
    // inequalities is what makes back-to-back activities legal — 10:00-11:00
    // followed by 11:00-12:00 touch at a boundary but do not overlap.
    //
    // `excludeActivityId` lets an UPDATE re-check against every OTHER activity
    // without conflicting with the row being edited.
    const conflict = await tx.activityLog.findFirst({
      where: {
        instructorId: input.instructorId,
        workDate,
        ...(input.excludeActivityId ? { id: { not: input.excludeActivityId } } : {}),
        startTime: { lt: endTime },
        endTime: { gt: startTime },
      },
      select: { id: true, startTime: true, endTime: true },
      orderBy: { startTime: "asc" },
    });

    if (conflict) {
      const fmt = (d: Date) =>
        new Intl.DateTimeFormat("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZone: university.timezone,
        }).format(d);
      throw new ApiError(
        409,
        "ACTIVITY_OVERLAP",
        `This overlaps an activity already recorded from ${fmt(conflict.startTime)} to ${fmt(conflict.endTime)} on ${workDateString}.`,
      );
    }

    const data = {
      instructorId: input.instructorId,
      universityId: input.universityId,
      activityTypeId: activityType.id,
      workDate,
      startTime,
      endTime,
      // On an UPDATE an absent status means "leave it as it stands", the same
      // rule `remarks` follows. Defaulting it here reset a MISSED or EXCUSED
      // entry to COMPLETED whenever anything ELSE on the row was corrected —
      // the edit route makes `status` optional, so fixing a deliverable or a
      // remark quietly asserted the activity had happened.
      ...(targetId
        ? input.status !== undefined
          ? { status: input.status }
          : {}
        : { status: input.status ?? "COMPLETED" }),
      remarks: input.remarks,
      isOncePerDay: activityType.isOncePerDay,
      ...(input.rawText !== undefined ? { rawText: input.rawText } : {}),
      ...(input.submissionId !== undefined ? { submissionId: input.submissionId } : {}),
      ...(input.deliverableTypeId !== undefined
        ? { deliverableTypeId: input.deliverableTypeId }
        : {}),
      ...(input.broadCategoryId !== undefined ? { broadCategoryId: input.broadCategoryId } : {}),
      ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
    };

    return targetId
      ? tx.activityLog.update({ where: { id: targetId }, data })
      : tx.activityLog.create({ data });
  });
}

/** Records a new activity. */
export async function logActivity(input: LogActivityInput) {
  return writeActivity(input, null);
}

/**
 * Corrects an existing activity in place.
 *
 * The id is excluded from the overlap and once-per-day checks automatically, so
 * a caller cannot forget to and have an activity reported as conflicting with
 * itself. Every other rule is unchanged: the same interval limits, the same
 * timezone resolution, and the same advisory lock, so a correction cannot race
 * a concurrent insert into an overlap either.
 */
export async function updateActivity(activityId: string, input: LogActivityInput) {
  return writeActivity({ ...input, excludeActivityId: activityId }, activityId);
}
