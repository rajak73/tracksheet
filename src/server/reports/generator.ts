/**
 * Report shaping only. All arithmetic comes from the analytics engine, so a
 * report and a dashboard covering the same period are guaranteed to agree —
 * they are literally reading the same numbers.
 */

import { computeAnalytics, type AnalyticsResult } from "@/server/analytics/engine";

export type ReportRow = {
  instructorName: string;
  employeeCode: string | null;
  capacityHours: number;
  productiveHours: number;
  unutilizedHours: number;
  missingDataHours: number;
  utilizationPct: number | null;
};

export type WorkloadReport = {
  universityId: string;
  from: string;
  to: string;
  rows: ReportRow[];
  totals: AnalyticsResult["totals"];
};

/**
 * `scope` narrows WHOSE rows the report contains, and is not optional in
 * practice: a report is the same engine pass every dashboard runs, so it has to
 * carry the same roster and self boundaries or it becomes the way around them.
 * `managerId: null` means "the unassigned" and is distinct from omitting the
 * key, exactly as in `AnalyticsQuery`.
 */
export async function generateWorkloadReport(
  universityId: string,
  from: string,
  to: string,
  scope: { instructorId?: string; managerId?: string | null } = {},
): Promise<WorkloadReport> {
  // `from`/`to` are required rather than optional. They used to be optional and
  // silently ignored, which made every "weekly" report an all-time report.
  const analytics = await computeAnalytics({
    universityId,
    from,
    to,
    ...(scope.instructorId ? { instructorId: scope.instructorId } : {}),
    ...("managerId" in scope ? { managerId: scope.managerId } : {}),
  });

  return {
    universityId,
    from,
    to,
    rows: analytics.instructors.map((i) => ({
      instructorName: i.instructorName,
      employeeCode: i.employeeCode,
      capacityHours: i.capacityHours,
      productiveHours: i.productiveHours,
      unutilizedHours: i.unutilizedHours,
      missingDataHours: i.missingDataHours,
      utilizationPct: i.utilizationPct,
    })),
    totals: analytics.totals,
  };
}

const HEADERS = [
  "Instructor Name",
  "Employee ID",
  "Capacity Hours",
  "Productive Hours",
  "Unutilized Hours",
  "Missing Data Hours",
  "Utilization %",
] as const;

/**
 * One CSV cell.
 *
 * Two separate concerns, both required:
 *
 * 1. RFC-4180 quoting — a name containing a comma must not shift every
 *    column, and an embedded quote must be doubled.
 *
 * 2. FORMULA-INJECTION NEUTRALISATION. Excel, LibreOffice and Sheets execute
 *    a cell beginning `=`, `+`, `-`, `@`, or a leading tab/CR as a formula.
 *    An instructor named `=cmd|'/C calc'!A0` would therefore run on the
 *    machine of whoever opens the export. Prefixing a single quote makes the
 *    spreadsheet treat it as literal text; the value still reads correctly
 *    to a human and to any CSV parser. Neutralise BEFORE quoting so the
 *    guard character ends up inside the quotes.
 *
 * Numbers are exempt: they are produced by this module, never user input,
 * and prefixing them would break every downstream sum.
 */
export function csvCell(value: string | number | null): string {
  if (value === null) return "";
  if (typeof value === "number") return String(value);

  const dangerous = /^[=+\-@\t\r]/;
  const s = dangerous.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function formatReportAsCsv(report: WorkloadReport): string {
  const lines = [HEADERS.join(",")];
  for (const r of report.rows) {
    lines.push(
      [
        r.instructorName,
        r.employeeCode,
        r.capacityHours,
        r.productiveHours,
        r.unutilizedHours,
        r.missingDataHours,
        r.utilizationPct,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n");
}
