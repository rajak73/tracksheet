"use client";

import { useEffect, useState } from "react";
import { ButtonLink, ErrorState, Field, PageHeader, TableSkeleton, inputClass } from "@/app/_components/ui";
import { ReportTable, type ReportRow } from "@/app/_components/ReportTable";

type University = { id: string; name: string };

export default function AdminReportsPage() {
  const [universities, setUniversities] = useState<University[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [report, setReport] = useState<{ from: string; to: string; rows: ReportRow[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/universities");
        if (!res.ok) return setError(`Could not load universities (HTTP ${res.status})`);
        const list = (await res.json()).universities as University[];
        setUniversities(list);
        if (list[0]) setSelected(list[0].id);
      } catch {
        setError("Could not reach the server");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selected) return;
    (async () => {
      const res = await fetch(`/api/universities/${selected}/reports`);
      if (res.ok) setReport((await res.json()).report);
    })();
  }, [selected]);

  if (loading) {
    return (
      <div>
        <PageHeader title="Reports" />
        <TableSkeleton cols={7} />
      </div>
    );
  }
  if (error) return <ErrorState message={error} />;

  return (
    <div>
      <PageHeader
        title="Reports"
        description={report ? `${report.from} to ${report.to}` : "Workload by university."}
        actions={
          <div className="flex items-end gap-3">
            <Field label="University">
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                className={inputClass}
              >
                {universities.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </Field>
            {selected && report ? (
              <ButtonLink
                href={`/api/universities/${selected}/reports?from=${report.from}&to=${report.to}&export=csv`}
              >
                Export CSV
              </ButtonLink>
            ) : null}
          </div>
        }
      />
      {report ? <ReportTable rows={report.rows} /> : <TableSkeleton cols={7} />}
    </div>
  );
}
