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
  TableSkeleton,
} from "@/app/_components/ui";
import { InstructorDirectory } from "@/app/_components/InstructorDirectory";
import { TrackerReport } from "@/app/_components/TrackerReport";
import type { Tracker } from "@/app/_components/TrackerGrid";
import { apiGet, useLoad } from "@/app/_lib/api";
import { TimeZoneProvider } from "@/app/_lib/zone";

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
{/* No stat row here.

              It used to hold Instructors / Former staff / Recorded hours, and
              the report below opens with the same figures — but the two never
              had to agree. These were pinned to whatever period the PAGE
              loaded, while the report has its own picker and fetches its own,
              so switching it to Current Month left one Working Hours tile
              reading the week and another reading the month, on one screen,
              with nothing to say which was which.

              The report's row is the one kept: it moves with the period it
              labels, and it carries Deliverable quantity as well. Former staff
              are not lost — the report raises a warning for them, which says it
              only when there are any rather than printing a zero forever. */}

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
            {/* ── An admin's "today" is the SUBJECT's, not their own ──────
              * An administrator belongs to no university, so there is no
              * "their today" to use — and reading the browser's would show a
              * Westbrook grid opening on whatever day it is wherever the admin
              * happens to be sitting.
              *
              * The tracker payload already carries the university's zone, so
              * the report is wrapped in it: the same screen viewed from Delhi
              * and from New York shows the same current week, because the week
              * belongs to the university being looked at. */}
            <TimeZoneProvider timeZone={data.timezone}>
              <TrackerReport universityId={id} />
            </TimeZoneProvider>
          </Section>
        </>
      )}
    </div>
  );
}
