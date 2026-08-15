"use client";

/**
 * "My Report" — the instructor's own weekly workload.
 *
 * The server narrows this to the signed-in instructor through their `self`
 * scope, so this page passes no instructor id and cannot be pointed at a
 * colleague by editing the URL.
 */

import { useCallback } from "react";
import { ErrorState, PageHeader, TableSkeleton } from "@/app/_components/ui";
import { TrackerReport } from "@/app/_components/TrackerReport";
import { fetchMe, useLoad } from "@/app/_lib/api";

export default function InstructorReportPage() {
  const load = useCallback(async () => {
    const me = await fetchMe();
    if (!me.user.universityId) {
      throw new Error("No university is linked to this account.");
    }
    return me.user.universityId;
  }, []);

  const { data: universityId, error, loading, reload } = useLoad(load, "instructor-report");

  return (
    <div className="space-y-6">
      <PageHeader
        title="My report"
        description="Your recorded work and deliverable progress, week by week. Only your own records are shown."
      />
      {loading ? (
        <TableSkeleton cols={5} />
      ) : error || !universityId ? (
        <ErrorState
          message="Unable to load your report"
          detail={error ?? undefined}
          onRetry={reload}
        />
      ) : (
        <TrackerReport universityId={universityId} />
      )}
    </div>
  );
}
