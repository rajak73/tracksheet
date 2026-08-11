/**
 * Loads a university's time configuration into the plain, database-free shape
 * that `schedule-windows.ts` consumes. Keeping the query here means the
 * calculation module stays pure and testable, and there is exactly one
 * definition of "what makes up a university's time configuration".
 */

import { prisma } from "@/server/db";
import { ApiError } from "@/server/http/errors";
import type { UniversityTimeConfig } from "@/server/time/schedule-windows";
import { workDateFor } from "@/server/time/workday";

const CONFIG_SELECT = {
  id: true,
  name: true,
  slug: true,
  timezone: true,
  openingDurationMin: true,
  closingDurationMin: true,
  workingHours: {
    orderBy: { dayOfWeek: "asc" },
    select: { dayOfWeek: true, isWorkingDay: true, startMinute: true, endMinute: true },
  },
  holidays: {
    orderBy: { date: "asc" },
    select: { id: true, date: true, name: true },
  },
} as const;

export type UniversityConfig = UniversityTimeConfig & {
  name: string;
  slug: string;
  holidays: Array<{ id: string; date: string; name: string }>;
};

/** Holidays are stored as DATE; render them as `YYYY-MM-DD` in UTC terms,
 *  which is how a bare DATE column round-trips without drifting a day. */
function holidayDate(value: Date): string {
  return workDateFor(value, "UTC");
}

export async function loadUniversityConfig(universityId: string): Promise<UniversityConfig> {
  const university = await prisma.university.findUnique({
    where: { id: universityId },
    select: CONFIG_SELECT,
  });

  if (!university) {
    throw new ApiError(404, "NOT_FOUND", "University not found");
  }

  return {
    id: university.id,
    name: university.name,
    slug: university.slug,
    timezone: university.timezone,
    openingDurationMin: university.openingDurationMin,
    closingDurationMin: university.closingDurationMin,
    workingHours: university.workingHours,
    holidays: university.holidays.map((h) => ({
      id: h.id,
      date: holidayDate(h.date),
      name: h.name,
    })),
  };
}
