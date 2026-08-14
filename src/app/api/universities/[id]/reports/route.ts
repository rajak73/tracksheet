import { NextResponse } from "next/server";
import { withAuth } from "@/server/http/route";
import { assertCanAccessUniversity } from "@/server/auth/scope";
import { formatReportAsCsv, generateWorkloadReport } from "@/server/reports/generator";
import { resolvePeriod } from "@/server/analytics/period";
import { loadUniversityConfig } from "@/server/universities/config";
import { computeAnalytics } from "@/server/analytics/engine";
import { prisma } from "@/server/db";
import { createNotification } from "@/server/notifications/service";
import { logAudit } from "@/server/audit/logger";

export const GET = withAuth<{ id: string }>(async ({ scope, params, req, principal }) => {
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

  const format = req.nextUrl.searchParams.get("export");
  if (format !== "csv") {
    return NextResponse.json({ report });
  }

  // An export is a recorded event, not an anonymous download: ReportJob is what
  // makes "who exported what, when, and how many rows" answerable afterwards.
  //
  // Generated inline because the current volumes finish in milliseconds. The
  // row is the handover point — moving generation to a worker means marking the
  // job QUEUED here and letting the worker fill in resultUrl, with no change to
  // the caller's contract.
  const job = await prisma.reportJob.create({
    data: {
      universityId: params.id,
      requestedById: principal.userId,
      reportType: "INSTRUCTOR_WORKLOAD",
      format: "CSV",
      parameters: { from: period.from, to: period.to, selfOnly: Boolean(selfOnly) },
      status: "RUNNING",
      startedAt: new Date(),
    },
  });

  try {
    const csv = formatReportAsCsv(report);

    await prisma.reportJob.update({
      where: { id: job.id },
      data: { status: "COMPLETED", rowCount: report.rows.length, completedAt: new Date() },
    });

    await logAudit(principal, scope, {
      action: "REPORT_EXPORTED",
      entityType: "ReportJob",
      entityId: job.id,
      universityId: params.id,
      metadata: { from: period.from, to: period.to, rows: report.rows.length, format: "CSV" },
    });

    // "Report availability" from the spec's notification list.
    await createNotification({
      userId: principal.userId,
      universityId: params.id,
      type: "REPORT_READY",
      title: "Workload report ready",
      message: `Your ${period.from} to ${period.to} workload report (${report.rows.length} rows) is ready.`,
      dedupeKey: `REPORT_READY:${job.id}`,
    });

    // The BOM has to be in the BODY — the comment here previously claimed one
    // was emitted while nothing prepended it, so Excel still mangled accented
    // names. `charset=utf-8` alone does not fix that: Excel ignores it for
    // .csv and falls back to the system codepage unless the bytes lead with
    // EF BB BF. Written as an escape, not a literal BOM character — a literal
    // U+FEFF at the start of a template string is exactly what source
    // tooling strips as "stray BOM", which is how the first attempt at this
    // fix silently vanished in the build.
    return new NextResponse("\uFEFF" + csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="workload_${period.from}_to_${period.to}.csv"`,
        "X-Report-Job-Id": job.id,
      },
    });
  } catch (error) {
    await prisma.reportJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        errorMessage: error instanceof Error ? error.message : String(error),
        completedAt: new Date(),
      },
    });
    throw error;
  }
});
