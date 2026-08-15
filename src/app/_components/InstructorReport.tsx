"use client";

/**
 * One instructor's weekly report — the last step of the drill-down.
 *
 * Deliberately thin: it is `TrackerReport` narrowed to a single person, so the
 * grid, the period controls, the two-hour-figure rule and the CSV export are
 * the same code the team view uses. Duplicating the report here is exactly how
 * an admin's number and a manager's number start disagreeing.
 *
 * The narrowing happens SERVER-side via `?instructorId=`, authorised with the
 * same rule as every other instructor-scoped route — this component cannot be
 * used to see someone the caller is not allowed to see.
 */

import { Badge, Card, CardBody, StatusPill } from "@/app/_components/ui";
import { TrackerReport } from "@/app/_components/TrackerReport";
import { humanizeCode } from "@/app/_lib/format";

export function InstructorReport({
  universityId,
  instructorId,
  instructorName,
  employeeCode,
  isActive,
  category,
}: {
  universityId: string;
  instructorId: string;
  instructorName: string;
  employeeCode: string | null;
  isActive: boolean;
  category: string | null;
}) {
  return (
    <div className="space-y-5">
      <Card>
        <CardBody>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="min-w-0">
              <p className="text-lg font-semibold text-content">{instructorName}</p>
              <p className="tabular mt-0.5 text-sm text-muted">{employeeCode ?? "—"}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={isActive ? "ACTIVE" : "FORMER"} />
              {category ? <Badge tone="neutral">{humanizeCode(category)}</Badge> : null}
            </div>
          </div>
          {!isActive ? (
            <p className="mt-3 text-sm text-muted">
              This person no longer has an active account. Their historical records are shown
              in full — leaving the organisation does not remove work they already did.
            </p>
          ) : null}
        </CardBody>
      </Card>

      <TrackerReport universityId={universityId} instructorId={instructorId} />
    </div>
  );
}
