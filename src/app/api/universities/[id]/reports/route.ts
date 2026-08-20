import { NextResponse } from "next/server";
import { withAuth } from "@/server/http/route";
import { assertCanAccessUniversity, narrowManager } from "@/server/auth/scope";
import { formatReportAsCsv, generateWorkloadReport } from "@/server/reports/generator";
import { resolvePeriod } from "@/server/analytics/period";
import { loadUniversityConfig } from "@/server/universities/config";
import { prisma } from "@/server/db";
import { createNotification } from "@/server/notifications/service";
import { logAudit } from "@/server/audit/logger";
import { parseLimit, parsePage } from "@/server/http/params";

export const GET = withAuth<{ id: string }>(async ({ scope, params, req, principal }) => {
  assertCanAccessUniversity(scope, params.id);

  const config = await loadUniversityConfig(params.id);
  const period = resolvePeriod(req.nextUrl.searchParams, config.timezone);
  const selfOnly = scope.kind === "self" ? scope.instructorId : undefined;

  /* Both boundaries, and neither of them re-derived here.
   *
   * Self-scoped callers get a report containing only their own row, so the
   * export path cannot become a way around instructor-level isolation.
   *
   * A MANAGER is bounded by their ROSTER, not by the university. Asking only
   * `assertCanAccessUniversity` let one manager export every instructor in the
   * tenant, peers' rosters included — the same grid `/tracker` refuses them,
   * reachable through the CSV instead. `narrowManager` is the authority for
   * that decision, exactly as it is there: an admin may name any roster or
   * `unassigned`, a manager only themselves. */
  const rosterFilter = narrowManager(scope, req.nextUrl.searchParams.get("managerId"));

  const report = await generateWorkloadReport(params.id, period.from, period.to, {
    ...(selfOnly ? { instructorId: selfOnly } : {}),
    ...rosterFilter,
  });

  const format = req.nextUrl.searchParams.get("export");
  if (format !== "csv") {
    // The CSV export path below needs every row for a complete file; JSON
    // callers page over `report.rows` instead. `totals` is computed over every
    // row the caller's scope covers and is never re-derived from the sliced
    // page, so it stays correct regardless of which page is being viewed.
    const page = parsePage(req.nextUrl.searchParams.get("page"));
    const limit = parseLimit(req.nextUrl.searchParams.get("limit"), { fallback: 50, max: 200 });
    const total = report.rows.length;
    const start = (page - 1) * limit;
    const rows = report.rows.slice(start, start + limit);

    return NextResponse.json({
      report: { ...report, rows },
      page,
      limit,
      total,
      hasMore: page * limit < total,
    });
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
      // The roster the export actually covered, so "who exported what" answers
      // WHOSE rows as well as which period.
      parameters: {
        from: period.from,
        to: period.to,
        selfOnly: Boolean(selfOnly),
        managerId: rosterFilter.managerId ?? null,
      },
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
