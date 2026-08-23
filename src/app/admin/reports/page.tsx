"use client";

import { useCallback, useState } from "react";
import { ButtonLink, ErrorState, Field, PageHeader, Pagination, Select, TableSkeleton } from "@/app/_components/ui";
import { ReportTable, type ReportRow } from "@/app/_components/ReportTable";
import { PeriodSelector, periodQuery, type Period } from "@/app/_components/interactive";
import { apiGet, useLoad } from "@/app/_lib/api";
import { TimeZoneProvider } from "@/app/_lib/zone";
import { formatDate } from "@/app/_lib/format";

type University = { id: string; name: string; timezone: string };

type ReportResponse = {
  report: { from: string; to: string; rows: ReportRow[] };
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
};

export default function AdminReportsPage() {
  const [selected, setSelected] = useState<string>("");
  const [period, setPeriod] = useState<Period | null>(null);
  const [page, setPage] = useState(1);

  const setPeriodAndResetPage = useCallback((next: Period | null) => {
    setPeriod(next);
    setPage(1);
  }, []);

  const load = useCallback(async () => {
    const body = await apiGet<{ universities: University[] }>(
      "/api/universities?limit=200",
      "Could not load universities.",
    );
    return body.universities;
  }, []);

  const { data: universities, error, loading, reload } = useLoad(load, "admin-reports-universities");
  const selectedUniversity = universities?.find((u) => u.id === activeId) ?? null;

  const activeId = selected || universities?.[0]?.id || "";

  const reportLoad = useCallback(async () => {
    if (!activeId) return null;
    const periodQ = periodQuery(period);
    const url = `/api/universities/${activeId}/reports${periodQ}${periodQ ? "&" : "?"}page=${page}`;
    return apiGet<ReportResponse>(url, "Could not load the report for that university.");
  }, [activeId, period, page]);

  const report = useLoad(
    reportLoad,
    `${activeId}:${period ? `${period.from}:${period.to}` : "default"}:${page}`,
  );

  const controls = (
    <div className="flex flex-wrap items-end gap-3">
      <Field label="University" className="w-full sm:w-auto">
        <Select
          value={activeId}
          onChange={(e) => setSelected(e.target.value)}
          className="w-full min-w-0 sm:w-auto sm:min-w-48"
        >
          {(universities ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
      </Field>
      {/* ── Whose "today"? The selected university's ────────────────────
        * An administrator belongs to no university, so "Today" has no meaning
        * on an admin screen until one is chosen — and this screen chooses one.
        * Wrapping the selector in that university's zone makes the preset mean
        * the day where the work happened, so the same button pressed in Delhi
        * and in New York asks for the same rows.
        *
        * Before a university is picked there is genuinely no answer, and the
        * browser's day is the honest stand-in rather than an arbitrary one. */}
      <TimeZoneProvider timeZone={selectedUniversity?.timezone ?? null}>
        <PeriodSelector value={period} onChange={setPeriodAndResetPage} />
      </TimeZoneProvider>
      {activeId && report.data ? (
        <ButtonLink
          external
          href={`/api/universities/${activeId}/reports?from=${report.data.report.from}&to=${report.data.report.to}&export=csv`}
        >
          Export CSV
        </ButtonLink>
      ) : null}
    </div>
  );

  if (loading) {
    return (
      <div className="space-y-4">
        <PageHeader title="Reports" />
        <TableSkeleton cols={7} />
      </div>
    );
  }
  if (error) {
    return (
      <div className="space-y-4">
        <PageHeader title="Reports" />
        <ErrorState message="Unable to load universities" detail={error} onRetry={reload} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Reports"
        description={
          report.data
            ? `${formatDate(report.data.report.from)} to ${formatDate(report.data.report.to)}`
            : "Workload by university."
        }
        actions={controls}
      />
      {report.loading ? (
        <TableSkeleton cols={7} />
      ) : report.error ? (
        <ErrorState message="Unable to load the report" detail={report.error} onRetry={report.reload} />
      ) : report.data ? (
        <>
          <ReportTable rows={report.data.report.rows} />
          <Pagination
            page={report.data.page}
            limit={report.data.limit}
            total={report.data.total}
            hasMore={report.data.hasMore}
            onPageChange={setPage}
          />
        </>
      ) : null}
    </div>
  );
}
