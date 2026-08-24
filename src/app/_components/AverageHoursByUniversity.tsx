"use client";

/**
 * Active-Instructor Average Hours, by university.
 *
 * ── What it deliberately is not ───────────────────────────────────────────
 * Not a percentage, not a comparison against a configured capacity, and not
 * coloured red, amber and green. A utilisation percentage was tried and
 * withdrawn because it scored a day of meetings exactly like a day of
 * lectures, so it moved for reasons nobody could act on.
 *
 * ── What "active" means here ───────────────────────────────────────────────
 * The denominator is instructor-DAYS that were active, not the roster and not
 * unique people. An instructor who logged time on three of the period's five
 * days contributes three to the count and their three days' minutes to the
 * total; a day nobody logged anything on contributes nothing to either. See
 * `src/domain/average-hours.ts` for the confirmed formula and why the two
 * simpler-looking alternatives were tried first and superseded.
 *
 * So: one accent, one bar, one number, and the bar is scaled against the
 * highest university on screen rather than against any target. It says which
 * university is averaging more than which — a comparison the reader can make
 * something of — and refuses to say whether either is good.
 *
 * ── Manager and instructor counts are roster context, not part of the sum ──
 * Shown beside each row so "2h 13.75m" reads against the size of the team it
 * came from. Sourced from a separate query (`Manager`/`Instructor` directly,
 * never `UniversityDailyMetric`) and never fed into the average — two
 * universities with identical activity produce identical figures whatever
 * their manager counts are. See the route's own doc and
 * `tests/average-hours.test.ts`.
 */

import { useCallback, useState } from "react";
import Link from "next/link";
import { Card, ErrorState, TableSkeleton } from "@/app/_components/ui";
import { PeriodSwitch } from "@/app/_components/PeriodPicker";
import type { View } from "@/app/_components/PeriodPicker";
import { apiGet, useLoad } from "@/app/_lib/api";
import { formatActiveAverage } from "@/domain/average-hours";
import { workingHours } from "@/domain/worklog-report";

type Row = {
  id: string;
  name: string;
  slug: string;
  period: { from: string; to: string };
  activeMinutes: number;
  activeInstructorDays: number;
  averageMinutes: number | null;
  /** Roster size — NOT the calculation's denominator. See the file doc. */
  managerCount: number;
  instructorCount: number;
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
            Average working hours per active instructor
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            Time logged {LABEL[view]}, divided by how many instructor-days were active — a day or
            an instructor with nothing logged counts in neither.
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
                  <p className="mt-0.5 text-xs text-subtle">
                    {row.managerCount} manager{row.managerCount === 1 ? "" : "s"}, {row.instructorCount}{" "}
                    instructor{row.instructorCount === 1 ? "" : "s"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {row.activeInstructorDays === 0
                      ? "No activity recorded"
                      : `${row.activeInstructorDays} active instructor-day${row.activeInstructorDays === 1 ? "" : "s"} · ${workingHours(row.activeMinutes)} recorded`}
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
                    {row.averageMinutes === null ? "No activity recorded" : formatActiveAverage(row.averageMinutes)}
                  </p>
                  {row.averageMinutes !== null ? (
                    <p className="text-xs text-subtle">per active instructor-day</p>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
