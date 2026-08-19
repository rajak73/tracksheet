import { prisma } from "@/server/db";
import { toDateOnly } from "@/server/time/workday";
import { countsAsWorkingHours } from "@/app/_lib/student-facing";

/**
 * Working Hours — time spent WITH STUDENTS — per instructor, over one period.
 *
 * ── Why this cannot come from the analytics engine ────────────────────────
 * `computeAnalytics` returns `productiveHours` (every recorded minute of every
 * category except UNUTILIZED) and `hoursByActivityType` (raw per-category
 * sums). Neither carries the fact this figure turns on: whether an entry's
 * DELIVERABLE is a countable one. The engine never loads deliverables, so the
 * answer is not recoverable from its output at any level of aggregation — it
 * has to be read from the entries.
 *
 * That is how `roster.ts` came to publish `workingHours: i.productiveHours`,
 * which is a real number under an incorrect name: on the same dev data it says
 * 40h 55m of "Working hours" for hours that include meetings, preparation and
 * admin. The manager list, the instructor directory and the report export all
 * read it.
 *
 * ── One rule, three implementations, deliberately ─────────────────────────
 * `rollUp` adds these hours up in the browser for one sheet; the tracker does
 * it per week cell; this does it per instructor per period. All three ask
 * `countsAsWorkingHours` — the deliverable decides when there is one, the
 * category decides when there is not — so they cannot disagree about which
 * minutes count, only about how they are grouped.
 *
 * ── One query ─────────────────────────────────────────────────────────────
 * Takes every instructor at once rather than one call per person: the callers
 * are list screens, and a per-row query is how a roster page becomes N+1.
 */
export async function workingHoursByInstructor(args: {
  universityId?: string;
  instructorIds?: string[];
  from: string;
  to: string;
}): Promise<Map<string, number>> {
  const logs = await prisma.activityLog.findMany({
    where: {
      ...(args.universityId ? { universityId: args.universityId } : {}),
      ...(args.instructorIds ? { instructorId: { in: args.instructorIds } } : {}),
      workDate: { gte: toDateOnly(args.from), lte: toDateOnly(args.to) },
    },
    select: {
      instructorId: true,
      startTime: true,
      endTime: true,
      activityType: { select: { code: true } },
      deliverableType: { select: { isCountable: true } },
    },
  });

  const hours = new Map<string, number>();
  for (const log of logs) {
    if (
      !countsAsWorkingHours(
        log.activityType.code,
        log.deliverableType ? log.deliverableType.isCountable : null,
      )
    ) {
      continue;
    }
    // From the instants, never a clock subtraction — an entry crossing midnight
    // comes out negative that way.
    const h = (log.endTime.getTime() - log.startTime.getTime()) / 3_600_000;
    hours.set(log.instructorId, (hours.get(log.instructorId) ?? 0) + h);
  }

  // Rounded once, at the end. Rounding each entry and then summing drifts.
  for (const [id, h] of hours) hours.set(id, Math.round(h * 100) / 100);
  return hours;
}
