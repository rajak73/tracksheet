import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { assertCanReadInstructorWork } from "@/server/auth/scope";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { computeAnalytics } from "@/server/analytics/engine";
import { deriveInsights } from "@/server/ai/insights";
import { resolvePeriod } from "@/server/analytics/period";
import { loadUniversityConfig } from "@/server/universities/config";

/**
 * Personal insights for one instructor.
 *
 * Derived on demand from THIS instructor's own metrics and returned without
 * being stored. That is deliberate: university-wide insights are a management
 * artifact and may reference colleagues, so an instructor must not read them.
 * These use the same rule set, so a personal observation and a university one
 * can never contradict each other.
 */
export const GET = withAuth<{ id: string }>(async ({ params, scope, req }) => {
  const instructor = await prisma.instructor.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      universityId: true,
      managerId: true,
      university: { select: { primaryManagerId: true } },
    },
  });
  if (!instructor) throw new ApiError(404, "NOT_FOUND", "Instructor not found");
  /* Roster-level, not tenant-level: this reports an individual's work, and a
   * manager's reach over that is their roster. An off-roster id answers 404,
   * exactly as an unknown one does — see `assertCanReadInstructorWork`. */
  assertCanReadInstructorWork(scope, instructor, instructor.university.primaryManagerId);

  const config = await loadUniversityConfig(instructor.universityId);
  const period = resolvePeriod(req.nextUrl.searchParams, config.timezone);

  const analytics = await computeAnalytics({
    universityId: instructor.universityId,
    from: period.from,
    to: period.to,
    instructorId: instructor.id,
  });

  return NextResponse.json({
    from: period.from,
    to: period.to,
    insights: await deriveInsights(analytics),
  });
});
