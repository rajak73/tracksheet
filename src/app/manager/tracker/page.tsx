"use client";

/**
 * The manager's team tracker: My Team → Instructor → Instructor Report.
 *
 * The university comes from the session, never the URL, so a manager cannot
 * point this at another tenant — the rule every other manager screen follows.
 */

import { useCallback } from "react";
import {
  ErrorState,
  PageHeader,
  Section,
  TableSkeleton,
} from "@/app/_components/ui";
import { InstructorDirectory } from "@/app/_components/InstructorDirectory";
import { TrackerReport } from "@/app/_components/TrackerReport";
import type { Tracker } from "@/app/_components/TrackerGrid";
import { apiGet, fetchMe, useLoad } from "@/app/_lib/api";

export default function ManagerTrackerPage() {
  const load = useCallback(async () => {
    const me = await fetchMe();
    if (!me.user.universityId) {
      throw new Error("No university is linked to this account.");
    }
    const { tracker } = await apiGet<{ tracker: Tracker }>(
      `/api/universities/${me.user.universityId}/tracker`,
      "Could not load your team's tracker.",
    );
    return { universityId: me.user.universityId, tracker };
  }, []);

  const { data, error, loading, reload } = useLoad(load, "manager-tracker");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Weekly tracker"
        description="Recorded work and deliverable progress for your instructors, week by week."
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
            title="My team"
            description="Current week at a glance. Select someone for their full report."
          >
            <InstructorDirectory
              tracker={data.tracker}
              hrefFor={(row) => `/manager/instructors/${row.instructorId}/report`}
            />
          </Section>

          <Section
            title="Weekly grid"
            description="Everyone across the selected period. Week columns scroll horizontally."
          >
            <TrackerReport
              universityId={data.universityId}
              emptyHint="No instructor has recorded work in this window."
            />
          </Section>
        </>
      )}
    </div>
  );
}
