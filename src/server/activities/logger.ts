import { prisma } from "@/server/db";
import { workDateFor, toDateOnly } from "@/server/time/workday";
import { ApiError } from "@/server/http/errors";
import { ActivityStatus } from "@/generated/prisma/client";

export type LogActivityInput = {
  instructorId: string;
  universityId: string;
  activityTypeCode: string;
  startTime: Date;
  endTime: Date;
  status?: ActivityStatus;
  remarks?: string;
};

/** A single activity may not span more than one working day's worth of time. */
const MAX_ACTIVITY_HOURS = 24;

export async function logActivity(input: LogActivityInput) {
  // 0. Reject impossible intervals BEFORE anything is written. A row where
  //    endTime precedes startTime yields a negative duration that silently
  //    subtracts from every aggregate downstream, which is far worse than a
  //    rejected request.
  const durationMs = input.endTime.getTime() - input.startTime.getTime();
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

  // 1. Fetch university timezone and activity type config
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

  // 2. Derive workDate (tenant-local calendar)
  const workDateString = workDateFor(input.startTime, university.timezone);
  const workDate = toDateOnly(workDateString);

  // 3. Prevent duplicate isOncePerDay explicitly, even though DB index protects it.
  //    This gives a better error message.
  if (activityType.isOncePerDay) {
    const existing = await prisma.activityLog.findFirst({
      where: {
        instructorId: input.instructorId,
        workDate,
        activityTypeId: activityType.id,
      },
    });
    if (existing) {
      throw new ApiError(
        409,
        "DUPLICATE_ONCE_PER_DAY_ACTIVITY",
        `An activity of type ${input.activityTypeCode} already exists for ${workDateString}`
      );
    }
  }

  // 4. Overlaps logic
  // "Recommendation: allow storage (real days are messy; a class can run into a support session), 
  // and have the analytics engine compute worked time as the union of intervals, not the sum of durations. 
  // Flag overlaps as a data-quality signal rather than an error."
  // So we simply insert it.

  // 5. Insert
  const log = await prisma.activityLog.create({
    data: {
      instructorId: input.instructorId,
      universityId: input.universityId,
      activityTypeId: activityType.id,
      workDate,
      startTime: input.startTime,
      endTime: input.endTime,
      status: input.status ?? "COMPLETED",
      remarks: input.remarks,
      isOncePerDay: activityType.isOncePerDay,
    },
  });

  return log;
}
