"use client";

/**
 * Drill-down step 4 (admin): one instructor's weekly report.
 *
 * Universities → University → Instructor Directory → **Instructor Report**.
 */

import { use, useCallback } from "react";
import { Breadcrumb, ErrorState, PageHeader, TableSkeleton } from "@/app/_components/ui";
import { InstructorReport } from "@/app/_components/InstructorReport";
import { apiGet, useLoad } from "@/app/_lib/api";
import type { Tracker } from "@/app/_components/TrackerGrid";

type InstructorResponse = {
  instructor: {
    id: string;
    universityId: string;
    employeeCode: string | null;
    user: { name: string; isActive: boolean };
    university?: { name: string };
  };
};

export default function AdminInstructorReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const load = useCallback(async () => {
    const { instructor } = await apiGet<InstructorResponse>(
      `/api/instructors/${id}`,
      "Could not load this instructor.",
    );
    // rather than a stored field — one fetch, current week.
    const { tracker } = await apiGet<{ tracker: Tracker }>(
      `/api/universities/${instructor.universityId}/tracker?instructorId=${id}`,
      "Could not load this instructor's report.",
    );
    return { instructor, row: tracker.rows[0] ?? null };
  }, [id]);

  const { data, error, loading, reload } = useLoad(load, `admin-instructor-report:${id}`);

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Instructor report" />
        <TableSkeleton cols={5} />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Instructor report" />
        <ErrorState
          message="Unable to load this instructor's report"
          detail={error ?? undefined}
          onRetry={reload}
        />
      </div>
    );
  }

  const { instructor } = data;

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={
          <Breadcrumb
            items={[
              { label: "Universities", href: "/admin/universities" },
              {
                label: instructor.university?.name ?? "University",
                href: `/admin/universities/${instructor.universityId}`,
              },
              { label: instructor.user.name },
            ]}
          />
        }
        title="Instructor report"
        description="Recorded work and deliverable progress, week by week."
      />
      <InstructorReport
        universityId={instructor.universityId}
        instructorId={instructor.id}
        instructorName={instructor.user.name}
        employeeCode={instructor.employeeCode}
        isActive={instructor.user.isActive}
      />
    </div>
  );
}
