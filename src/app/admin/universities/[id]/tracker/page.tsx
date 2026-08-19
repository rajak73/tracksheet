"use client";

/**
 * Drill-down step 3 (admin): a university's instructor directory and weekly grid.
 *
 * Universities → University → **Instructor Directory** → Instructor Report.
 *
 * The directory and the grid are two renderings of ONE tracker response for the
 * current week, so they cannot disagree; the grid below adds the period
 * controls for looking at other weeks or months.
 */

import { use, useCallback } from "react";
import {
  Breadcrumb,
  ErrorState,
  PageHeader,
  Section,
  StatTile,
  TableSkeleton,
} from "@/app/_components/ui";
import { InstructorDirectory } from "@/app/_components/InstructorDirectory";
import { TrackerReport } from "@/app/_components/TrackerReport";
import type { Tracker } from "@/app/_components/TrackerGrid";
import { apiGet, useLoad } from "@/app/_lib/api";
import { formatHours } from "@/app/_lib/format";

export default function AdminUniversityTrackerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const load = useCallback(
    () =>
      apiGet<{ tracker: Tracker }>(
        `/api/universities/${id}/tracker`,
        "Could not load this university's tracker.",
      ).then((body) => body.tracker),
    [id],
  );

  const { data, error, loading, reload } = useLoad(load, `admin-university-tracker:${id}`);

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={
          <Breadcrumb
            items={[
              { label: "Universities", href: "/admin/universities" },
              { label: data?.universityName ?? "University", href: `/admin/universities/${id}` },
              { label: "Weekly tracker" },
            ]}
          />
        }
        title={data ? `${data.universityName} — weekly tracker` : "Weekly tracker"}
        description="Recorded work and deliverable progress for every instructor in this university."
      />

      {loading ? (
        <TableSkeleton cols={6} />
      ) : error || !data ? (
        <ErrorState
          message="Unable to load the tracker"
          detail={error ?? undefined}
          onRetry={reload}
        />
      ) : (
        <>
          {/* ── University-level headline for the current week ──────────────
           * Headcount and one hour figure. No percentage, and no split.
           *
           * There is no utilization tile because recorded minutes over the
           * configured working day says nothing about students: a week of
           * back-to-back internal meetings scores exactly as a week of
           * lectures, and the ratio runs past 100% often enough that nobody
           * reads it as a target. Nothing replaces it — the tracker carries
           * no student-facing capacity to divide by, and a headline number
           * invented here would be one more figure to reconcile.
           *
           * There is no "Deliverable hours" tile because that name meant two
           * quantities. On this screen it was hours on entries carrying any
           * named deliverable, countable or not; on the roster and manager
           * screens it was hours whose category happened to be "Deliverable
           * Work" — the same instructor, the same week, 32h 55m here and
           * 1h 30m there. Deliverable titles and quantities stay in the grid
           * below as reporting detail about what was booked, which is what
           * they always were.
           *
           * The hours tile is the tracker's own total under an honest name:
           * this response sums every recorded minute, student-facing or not,
           * so it reads "Recorded hours". Working Hours means time spent WITH
           * STUDENTS (see `domain/working-hours.ts`), the tracker does not
           * carry that figure, and borrowing the label here would publish a
           * number that disagrees with every screen that does.
           */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            <StatTile label="Instructors" value={data.totals.instructors} emphasis />
            <StatTile label="Former staff shown" value={data.totals.formerInstructors} />
            <StatTile label="Recorded hours" value={formatHours(data.totals.totalWorkingHours)} />
          </div>

          <Section
            title="Instructor directory"
            description="Current week at a glance. Select someone for their full report."
          >
            <InstructorDirectory
              tracker={data}
              hrefFor={(row) => `/admin/instructors/${row.instructorId}/report`}
            />
          </Section>

          <Section
            title="Weekly grid"
            description="All instructors across the selected period. Week columns scroll horizontally."
          >
            <TrackerReport universityId={id} />
          </Section>
        </>
      )}
    </div>
  );
}
