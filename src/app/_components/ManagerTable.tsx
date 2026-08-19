"use client";

/**
 * The managers of one university, with each manager's OWN figures.
 *
 * This is the drill-down step between a university and a roster, so the numbers
 * have to be per-manager rather than per-university — two managers in one
 * tenant lead different people, and a table that showed them the same count
 * would make the whole hierarchy look decorative.
 *
 * Everything here is presentation. The figures arrive already aggregated from
 * `GET /api/universities/[id]/managers`, one request for the whole table, so
 * rendering it costs no extra round trips no matter how many managers there
 * are.
 *
 * ── Why the hours column says "Recorded", not "Working" ───────────────────
 * Working Hours counts time spent WITH STUDENTS, and that answer lives on each
 * entry's deliverable — or, when an entry carries none, on its category (see
 * `_lib/student-facing.ts`). What this endpoint reports is `computeAnalytics`'s
 * productive total: every logged minute that is not declared idle time, so a
 * morning of internal meetings lands in it exactly like a morning of lectures.
 * That is a real quantity and worth comparing across managers, but it is not
 * the student-facing one, so it is shown under the name it actually has. The
 * student-facing figure for a manager's people lives on that manager's own
 * roster, one click away through the row.
 *
 * ── Why there is no utilization column ────────────────────────────────────
 * It was recorded minutes over the configured working-day capacity: blind to
 * whether anyone was in front of students, and past 100% on any ordinary busy
 * week. The meter is gone rather than re-pointed at something else, because
 * this response carries no student-facing total to divide and a percentage
 * invented here would answer a question nobody asked. What compares managers
 * now is roster size, hours actually recorded, and deliverables completed —
 * three figures that mean the same thing on every row.
 */

import Link from "next/link";
import {
  Badge,
  ButtonLink,
  Card,
  CardList,
  CardListItem,
  EmptyState,
  Table,
  TableWrap,
  TBody,
  TD,
  THead,
  TR,
} from "@/app/_components/ui";
import { formatHours } from "@/app/_lib/format";

export type ManagerRow = {
  id: string;
  employeeCode: string | null;
  user: { name: string; email: string; isActive: boolean };
  isPrimary: boolean;
  instructorCount: number;
  /**
   * Hours, not minutes: every productive minute this manager's roster recorded
   * in the week, summed. The wire name predates the split between recorded and
   * student-facing time; the column reads "Recorded hours" for the reason set
   * out above.
   */
  currentWeekWorkingHours: number;
  currentWeekDeliverables: number;
};

export function ManagerTable({
  managers,
  unassignedInstructors = 0,
  universityId,
}: {
  managers: ManagerRow[];
  /** Instructors in this university nobody leads yet. */
  unassignedInstructors?: number;
  universityId: string;
}) {
  if (managers.length === 0) {
    return (
      <EmptyState
        title="No managers yet"
        description="Add a manager to this university before assigning instructors to a roster."
      />
    );
  }

  return (
    <>
      {/* Surfaced, never hidden: an instructor on nobody's roster appears in no
          manager row below, and an admin needs to know that rather than
          discover it by arithmetic. */}
      {unassignedInstructors > 0 ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning-subtle px-4 py-3">
          <p className="text-sm text-warning-text">
            <span className="font-medium">{unassignedInstructors}</span>{" "}
            {unassignedInstructors === 1 ? "instructor is" : "instructors are"} not assigned to any
            manager, so they appear in no roster below.
          </p>
          <ButtonLink href="/admin/instructors" variant="secondary" size="sm">
            Assign instructors
          </ButtonLink>
        </div>
      ) : null}

      <Card>
        <div className="hidden md:block">
          <TableWrap>
            <Table caption="Managers in this university, with their own current-week figures">
              <THead
                columns={[
                  { label: "Manager" },
                  { label: "Employee ID" },
                  { label: "Instructors", align: "right" },
                  { label: "Recorded hours", align: "right" },
                  { label: "Deliverables", align: "right" },
                  { label: "Action" },
                ]}
              />
              <TBody>
                {managers.map((m) => (
                  <TR key={m.id}>
                    <TD strong>
                      <Link
                        href={`/admin/managers/${m.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {m.user.name}
                      </Link>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        {m.isPrimary ? <Badge tone="primary">Primary</Badge> : null}
                        {!m.user.isActive ? <Badge tone="warning">Deactivated</Badge> : null}
                      </span>
                    </TD>
                    <TD>
                      <span className="tabular text-muted">{m.employeeCode ?? "—"}</span>
                    </TD>
                    <TD align="right">
                      <span className="tabular">{m.instructorCount}</span>
                    </TD>
                    <TD align="right">
                      <span className="tabular">{formatHours(m.currentWeekWorkingHours)}</span>
                    </TD>
                    <TD align="right">
                      <span className="tabular">{m.currentWeekDeliverables}</span>
                    </TD>
                    <TD>
                      <ButtonLink
                        href={`/admin/managers/${m.id}`}
                        variant="secondary"
                        size="sm"
                        aria-label={`Open ${m.user.name}'s roster`}
                      >
                        View →
                      </ButtonLink>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        </div>

        {/* Mobile: the same facts, stacked — including the Deactivated badge,
            which is the one thing on this row a phone must not lose: an
            account nobody can log into explains a roster's flat week. The row
            ends at its chevron; there is no percentage to park in the trailing
            slot. The hours carry the word "recorded" here because a bare
            duration in a subtitle has no column heading above it to say which
            duration it is. */}
        <div className="md:hidden">
          <CardList>
            {managers.map((m) => (
              <CardListItem
                key={m.id}
                href={`/admin/managers/${m.id}`}
                title={
                  <>
                    {m.user.name}
                    {m.isPrimary ? (
                      <span className="ml-2">
                        <Badge tone="primary">Primary</Badge>
                      </span>
                    ) : null}
                    {!m.user.isActive ? (
                      <span className="ml-2">
                        <Badge tone="warning">Deactivated</Badge>
                      </span>
                    ) : null}
                  </>
                }
                subtitle={
                  `${m.employeeCode ?? "—"} · ${m.instructorCount} instructor` +
                  `${m.instructorCount === 1 ? "" : "s"} · ${formatHours(
                    m.currentWeekWorkingHours,
                  )} recorded · ${m.currentWeekDeliverables} deliverable${
                    m.currentWeekDeliverables === 1 ? "" : "s"
                  }`
                }
              />
            ))}
          </CardList>
        </div>
      </Card>

      <p className="mt-2 text-xs text-subtle">
        Figures cover the current reporting week for each manager&apos;s own assigned instructors.{" "}
        <Link href={`/admin/universities/${universityId}/tracker`} className="text-primary hover:underline">
          Open the university tracker
        </Link>{" "}
        for the full grid.
      </p>
    </>
  );
}
