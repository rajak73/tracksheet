"use client";

/**
 * Manager drill-down: My Team → Instructor → **Instructor Report**.
 *
 * The same component the admin route renders. The server refuses an instructor
 * outside the manager's university with a 404, so this page needs no tenant
 * check of its own — and cannot acquire a different one by accident.
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
  };
};

export default function ManagerInstructorReportPage({
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
    const { tracker } = await apiGet<{ tracker: Tracker }>(
      `/api/universities/${instructor.universityId}/tracker?instructorId=${id}`,
      "Could not load this instructor's report.",
    );
    return { instructor, row: tracker.rows[0] ?? null };
  }, [id]);

  const { data, error, loading, reload } = useLoad(load, `manager-instructor-report:${id}`);

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

  const { instructor, row } = data;

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={
          <Breadcrumb
            items={[
              { label: "Instructors", href: "/manager/instructors" },
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
        category={row?.category ?? null}
      />
    </div>
  );
}
