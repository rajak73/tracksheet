"use client";

import { useEffect, useState } from "react";
import { ButtonLink, ErrorState, PageHeader, TableSkeleton } from "@/app/_components/ui";
import { ReportTable, type ReportRow } from "@/app/_components/ReportTable";

type Report = { from: string; to: string; rows: ReportRow[] };

export default function ManagerReportsPage() {
  const [universityId, setUniversityId] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const meRes = await fetch("/api/auth/me");
        if (!meRes.ok) return setError("Your session has expired.");
        const me = await meRes.json();
        const uid = me.user.universityId as string;
        setUniversityId(uid);

        const res = await fetch(`/api/universities/${uid}/reports`);
        if (!res.ok) return setError(`Could not load the report (HTTP ${res.status})`);
        setReport((await res.json()).report);
      } catch {
        setError("Could not reach the server");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div>
        <PageHeader title="Workload report" />
        <TableSkeleton cols={7} />
      </div>
    );
  }
  if (error || !report) return <ErrorState message={error ?? "No data returned."} />;

  return (
    <div>
      <PageHeader
        title="Workload report"
        description={`${report.from} to ${report.to} — the same figures shown on the dashboard.`}
        actions={
          universityId ? (
            <ButtonLink
              href={`/api/universities/${universityId}/reports?from=${report.from}&to=${report.to}&export=csv`}
            >
              Export CSV
            </ButtonLink>
          ) : null
        }
      />
      <ReportTable rows={report.rows} />
    </div>
  );
}
