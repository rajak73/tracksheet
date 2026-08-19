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
  StatTile,
  TableSkeleton,
} from "@/app/_components/ui";
import { InstructorDirectory } from "@/app/_components/InstructorDirectory";
import { TrackerReport } from "@/app/_components/TrackerReport";
import type { Tracker } from "@/app/_components/TrackerGrid";
import { apiGet, fetchMe, useLoad } from "@/app/_lib/api";
import { formatHours } from "@/app/_lib/format";

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
          {/* ── The team's week in three figures ────────────────────────
           * Headcount, who is here from before, and one hour figure. No
           * percentage and no split.
           *
           * There is no utilization tile, because a manager asks whether their
           * instructors are in front of students and that ratio never answered
           * it: recorded minutes over the configured working day scores a week
           * of back-to-back internal meetings exactly as a week of lectures,
           * and it runs past 100% often enough that nobody reads it as a
           * target. Nothing takes its place — the tracker carries no
           * student-facing capacity to divide by, and a ratio invented on this
           * screen would be one more number to reconcile with the report a
           * manager opens next.
           *
           * There is no "Deliverable hours" tile, because those words meant two
           * different quantities. Here they meant hours on entries carrying any
           * named deliverable, countable or not; on the roster and manager
           * instructor screens they meant hours whose category happened to be
           * "Deliverable Work" — the same person, the same week, 32h 55m
           * against 1h 30m. Deliverable titles and quantities stay in the grid
           * below, where they are reporting detail about what was booked rather
           * than a headline.
           *
           * The hours tile is the tracker's own total under an honest name:
           * this response sums every recorded minute, student-facing or not, so
           * it reads "Recorded hours". Working Hours means time spent WITH
           * STUDENTS (see `domain/working-hours.ts`), the tracker does not carry
           * that figure, and borrowing the label here would put a number on
           * screen that disagrees with every screen that does.
           */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            <StatTile label="Team members" value={data.tracker.totals.instructors} emphasis />
            <StatTile label="Former staff shown" value={data.tracker.totals.formerInstructors} />
            <StatTile
              label="Recorded hours"
              value={formatHours(data.tracker.totals.totalWorkingHours)}
            />
          </div>

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
