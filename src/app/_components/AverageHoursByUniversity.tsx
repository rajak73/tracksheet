"use client";

/**
 * Average working hours per instructor, by university.
 *
 * ── What it deliberately is not ───────────────────────────────────────────
 * Not a percentage, not a comparison against a configured capacity, and not
 * coloured red, amber and green. A utilisation percentage was tried and
 * withdrawn because it scored a day of meetings exactly like a day of
 * lectures, so it moved for reasons nobody could act on.
 *
 * So: one accent, one bar, one number, and the bar is scaled against the
 * highest university on screen rather than against any target. It says which
 * university is averaging more than which — a comparison the reader can make
 * something of — and refuses to say whether either is good.
 */

import { useCallback, useState } from "react";
import Link from "next/link";
import { Card, ErrorState, TableSkeleton } from "@/app/_components/ui";
import { PeriodSwitch } from "@/app/_components/PeriodPicker";
import type { View } from "@/app/_components/PeriodPicker";
import { apiGet, useLoad } from "@/app/_lib/api";
import { workingHours } from "@/domain/worklog-report";

type Row = {
  id: string;
  name: string;
  slug: string;
  period: { from: string; to: string };
  totalMinutes: number;
  roster: number;
  averageMinutes: number | null;
};

const LABEL: Record<View, string> = {
  day: "today",
  week: "this week",
  month: "this month",
};

export function AverageHoursByUniversity() {
  /* Each switch starts at the current period. The card holds no anchor of its
     own, so there is no stale date to carry across a view change. */
  const [view, setView] = useState<View>("week");

  const load = useCallback(
    () =>
      apiGet<{ universities: Row[] }>(
        `/api/admin/average-hours?view=${view}`,
        "Could not load average hours.",
      ).then((body) => body.universities),
    [view],
  );
  const { data, error, loading, reload } = useLoad(load, `admin-average-hours:${view}`);

  const rows = data ?? [];
  const widest = rows.reduce((n, r) => Math.max(n, r.averageMinutes ?? 0), 0);

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-content">
            Average working hours per instructor
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            Everything recorded {LABEL[view]}, divided by every instructor on the roster —
            including those who recorded nothing.
          </p>
        </div>
        <PeriodSwitch view={view} onView={setView} />
      </div>

      {error ? (
        <div className="p-5">
          <ErrorState message="Unable to load average hours" detail={error} onRetry={reload} />
        </div>
      ) : loading ? (
        <div className="p-5">
          <TableSkeleton rows={3} />
        </div>
      ) : rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted">No universities yet.</p>
      ) : (
        <ul>
          {rows.map((row) => (
            <li key={row.id} className="border-b border-line last:border-b-0">
              <Link
                href={`/admin/universities/${row.id}`}
                className="flex flex-wrap items-center gap-4 px-5 py-4 transition-colors hover:bg-primary-subtle"
              >
                <div className="min-w-0 flex-1 basis-56">
                  <p className="truncate text-sm font-semibold text-content">{row.name}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {row.roster === 0
                      ? "No instructors yet"
                      : `${row.roster} instructor${row.roster === 1 ? "" : "s"} · ${workingHours(row.totalMinutes)} recorded`}
                  </p>
                </div>

                {/* One accent, scaled against the highest on screen. No target
                    line, because there is no target. */}
                <div className="min-w-0 flex-1 basis-64">
                  <div className="h-2 overflow-hidden rounded-chip bg-sunken">
                    {row.averageMinutes !== null && widest > 0 ? (
                      <span
                        className="block h-full rounded-chip bg-primary"
                        style={{ width: `${Math.max(2, (row.averageMinutes / widest) * 100)}%` }}
                      />
                    ) : null}
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <p className="tabular text-base font-semibold text-content">
                    {row.averageMinutes === null ? "—" : workingHours(row.averageMinutes)}
                  </p>
                  <p className="text-xs text-subtle">per instructor</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
