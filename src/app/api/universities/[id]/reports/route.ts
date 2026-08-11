import { NextResponse } from "next/server";
import { withAuth } from "@/server/http/route";
import { assertCanAccessUniversity } from "@/server/auth/scope";
import { formatReportAsCsv, generateWorkloadReport } from "@/server/reports/generator";
import { resolvePeriod } from "@/server/analytics/period";
import { loadUniversityConfig } from "@/server/universities/config";
import { computeAnalytics } from "@/server/analytics/engine";

export const GET = withAuth<{ id: string }>(async ({ scope, params, req }) => {
  assertCanAccessUniversity(scope, params.id);

  const config = await loadUniversityConfig(params.id);
  const period = resolvePeriod(req.nextUrl.searchParams, config.timezone);
  const selfOnly = scope.kind === "self" ? scope.instructorId : undefined;

  // Self-scoped callers get a report containing only their own row, so the
  // export path cannot become a way around instructor-level isolation.
  const report = selfOnly
    ? await (async () => {
        const a = await computeAnalytics({
          universityId: params.id,
          from: period.from,
          to: period.to,
          instructorId: selfOnly,
        });
        return {
          universityId: params.id,
          from: period.from,
          to: period.to,
          rows: a.instructors.map((i) => ({
            instructorName: i.instructorName,
            employeeCode: i.employeeCode,
            capacityHours: i.capacityHours,
            productiveHours: i.productiveHours,
            unutilizedHours: i.unutilizedHours,
            missingDataHours: i.missingDataHours,
            utilizationPct: i.utilizationPct,
            openingCompliancePct: i.openingCompliancePct,
            closingCompliancePct: i.closingCompliancePct,
          })),
          totals: a.totals,
        };
      })()
    : await generateWorkloadReport(params.id, period.from, period.to);

  if (req.nextUrl.searchParams.get("export") === "csv") {
    return new NextResponse(formatReportAsCsv(report), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="workload_${period.from}_to_${period.to}.csv"`,
      },
    });
  }

  return NextResponse.json({ report });
});
