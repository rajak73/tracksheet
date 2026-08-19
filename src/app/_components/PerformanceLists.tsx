"use client";

/**
 * The two performance lists the dashboard and analytics both need: who is doing
 * well, and who needs looking at.
 *
 * They live here rather than in either page because a "manager needing
 * attention" must mean the same thing on both screens. Both read the SAME
 * `/api/managers` response — the API decides who appears and in what order, so
 * neither page can quietly disagree with the other or with the managers table.
 *
 * ── One hours figure, and it is about students ─────────────────────────────
 * A row is read by its Working Hours: time spent WITH STUDENTS — lectures,
 * labs, exams, mentoring, student support. Preparation, meetings, reporting and
 * admin still happen and are still recorded; they are simply not what this
 * figure measures. Three older numbers used to share the row. Utilization —
 * the meter, the percentage, and the Healthy / Borderline / Needs attention
 * badge derived from it — divided every recorded minute by the configured
 * working day, so a week of internal meetings scored exactly like a week of
 * teaching, and it routinely passed 100%. "Deliverable hours" meant hours whose
 * CATEGORY was named "Deliverable Work" here and "anything with a deliverable
 * attached" on the tracker, which is how one instructor could read 1h 30m on
 * one screen and 32h 55m on another. None of the three had an honest
 * replacement, so each row carries the figure every other screen agrees on and
 * links through for anything finer.
 */

import Link from "next/link";
import { Card, EmptyState } from "@/app/_components/ui";
import { formatHours } from "@/app/_lib/format";

export type ManagerPerf = {
  id: string;
  name: string;
  universityName: string;
  instructorCount: number;
  /** Time the roster spent with students. See `working-hours.ts`. */
  workingHours: number;
};

export type InstructorPerf = {
  instructorId: string;
  instructorName: string;
  employeeCode: string | null;
  universityName: string;
  managerName: string | null;
  /** Time with students. The response carries more; this is what a row means. */
  workingHours: number;
};

export function ManagerPerformanceList({
  managers,
  emptyTitle,
  emptyDescription,
}: {
  managers: ManagerPerf[];
  emptyTitle: string;
  emptyDescription: string;
}) {
  if (managers.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }
  return (
    <Card>
      <ul className="divide-y divide-line">
        {managers.map((m) => (
          <li key={m.id} className="px-5 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <Link
                  href={`/admin/managers/${m.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {m.name}
                </Link>
                <p className="mt-0.5 text-xs text-muted">
                  {m.universityName} · {m.instructorCount} instructor
                  {m.instructorCount === 1 ? "" : "s"}
                </p>
              </div>
              {/* The trailing slot is where the eye compares one row against the
                  next, so it carries Working Hours and nothing else. The badge
                  that stood here named a utilization band and the meter beside
                  it was that same percentage drawn a second way — two readings
                  of a number that never asked about students. */}
              <span className="text-right">
                <span className="tabular block text-sm text-content">
                  {formatHours(m.workingHours)}
                </span>
                <span className="text-xs text-subtle">Working Hours</span>
              </span>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function InstructorProblemList({ instructors }: { instructors: InstructorPerf[] }) {
  if (instructors.length === 0) {
    return (
      <EmptyState
        title="No instructor needs a closer look"
        description="The server decides who belongs on this list; this week it returned nobody."
      />
    );
  }
  return (
    <Card>
      <ul className="divide-y divide-line">
        {instructors.map((i) => (
          <li key={i.instructorId} className="px-5 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <Link
                  href={`/admin/instructors/${i.instructorId}/report`}
                  className="font-medium text-primary hover:underline"
                >
                  {i.instructorName}
                </Link>
                <p className="tabular mt-0.5 text-xs text-muted">
                  {i.employeeCode ?? "—"} · {i.universityName} ·{" "}
                  {i.managerName ?? "Unassigned"}
                </p>
              </div>
              {/* Someone opens this list to see how little time an instructor
                  spent in front of students, so that is the figure it shows.
                  The band badge and the utilization percentage that used to sit
                  here read the same recorded minutes twice and said nothing
                  about teaching. The name links through to the full report. */}
              <span className="text-right">
                <span className="tabular block text-sm text-content">
                  {formatHours(i.workingHours)}
                </span>
                <span className="text-xs text-subtle">Working Hours</span>
              </span>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
