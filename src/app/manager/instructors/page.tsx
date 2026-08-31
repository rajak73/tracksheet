"use client";

/**
 * A manager's roster — the people who actually report to them.
 *
 * ── Scope is the server's decision, not this page's ────────────────────────
 * The list asks `/api/instructors` with no roster filter at all. `narrowManager`
 * pins a manager to their own `managerId` from the SESSION, so this page cannot
 * widen to a colleague's team even if someone edits the request. Nothing here
 * filters for security; the frontend only decides how to draw what it is given.
 *
 * ── One hours figure, and it is the student-facing one ─────────────────────
 * Working Hours is time spent WITH STUDENTS — lectures, labs, exams, mentoring,
 * student support. Preparation, meetings, reporting and admin still happen and
 * are still recorded; they are simply not what this figure measures. The roster
 * used to carry two more numbers beside it. Utilization divided every recorded
 * minute by the configured working day, so a week of internal meetings scored
 * exactly like a week of teaching — and the band badge, the meter and the
 * "needing attention" count were all that same percentage wearing different
 * clothes. "Deliverable hours" meant a category name here and "anything with a
 * deliverable attached" on the tracker, which is how the same instructor could
 * read as 1h 30m on one screen and 32h 55m on another. A manager comparing two
 * people has to be comparing the same thing they see everywhere else, so this
 * page shows the figure everywhere else agrees on and nothing more.
 *
 * ── "Remove" is an unassignment ────────────────────────────────────────────
 * Removing someone clears `managerId` and nothing else. Their activity,
 * deliverables and audit history survive, and an admin then sees them as
 * unassigned. The wording in the dialog says so, because "remove" reads like
 * deletion and a manager should not have to guess which one this is.
 */

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  CardList,
  CardListItem,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  SearchInput,
  Select,
  StatTile,
  Table,
  TableSkeleton,
  TableWrap,
  TBody,
  TD,
  THead,
  TR,
} from "@/app/_components/ui";
import { ConfirmDialog, useToast } from "@/app/_components/interactive";
import { apiGet, apiSend, fetchMe, useLoad } from "@/app/_lib/api";
import { formatHours, humanizeCode } from "@/app/_lib/format";
import { type InstructorPerf } from "@/app/_components/PerformanceLists";
import { AiInsightCell, type CellInsight } from "@/app/_components/AiInsightCell";

type Instructor = {
  id: string;
  employeeCode: string | null;
  universityId: string;
  user: { name: string; email: string; isActive: boolean };
};

type Row = Instructor & {
  /** Null when the performance response carried no row for this person. */
  workingHours: number | null;
  category: string | null;
};

// Both directions of the one figure worth ordering by. The page opens on the
// lowest because that is the reason a manager comes here: to find who has had
// the least time in front of students this week.
const SORTS: Array<[string, string]> = [
  ["workingHoursAsc", "Working Hours (lowest first)"],
  ["workingHoursDesc", "Working Hours (highest first)"],
  ["name", "Name"],
];

export default function ManagerInstructorsPage() {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("active");
  const [sort, setSort] = useState("workingHoursAsc");
  const [removing, setRemoving] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const me = await fetchMe();
    // No managerId is sent: the server derives it from the session. Asking for
    // "my instructors" and being given someone else's is impossible by
    // construction rather than by convention.
    const [roster, perf] = await Promise.all([
      apiGet<{ instructors: Instructor[]; insights?: Record<string, CellInsight> }>(
        "/api/instructors?limit=200",
        "Could not load your instructors.",
      ),
      apiGet<{ instructors?: InstructorPerf[] }>(
        "/api/managers?includeInstructors=true&status=all",
        "Could not load performance.",
      ).catch(() => ({ instructors: [] as InstructorPerf[] })),
    ]);

    const perfById = new Map((perf.instructors ?? []).map((i) => [i.instructorId, i]));
    const rows: Row[] = roster.instructors.map((i) => {
      const p = perfById.get(i.id);
      return {
        ...i,
        // The response still carries capacity, utilization and the band it
        // produces. None of them are read here: they describe how full a day
        // was, not how much of it a student saw.
        //
        // No row means the week could not be read — the performance request is
        // allowed to fail, and it omits people who have left. That is NOT a
        // week of zero student contact, so it stays null and prints as "—".
        workingHours: p?.workingHours ?? null,
        category: null,
      };
    });

    return { rows, managerName: me.user.name, insights: roster.insights ?? {} };
  }, []);

  const { data, error, loading, reload } = useLoad(load, "manager-roster");

  const rows = useMemo(() => {
    let out = data?.rows ?? [];
    if (status === "active") out = out.filter((r) => r.user.isActive);
    if (status === "inactive") out = out.filter((r) => !r.user.isActive);
    const q = search.trim().toLowerCase();
    if (q) {
      out = out.filter(
        (r) =>
          r.user.name.toLowerCase().includes(q) ||
          r.user.email.toLowerCase().includes(q) ||
          (r.employeeCode ?? "").toLowerCase().includes(q),
      );
    }
    return [...out].sort((a, b) => {
      if (sort === "name") return a.user.name.localeCompare(b.user.name);
      // A row without a figure is unmeasured, not idle. It sorts last in BOTH
      // directions rather than heading the "lowest first" list as if it were
      // the quietest week on the roster.
      if (a.workingHours === null || b.workingHours === null) {
        if (a.workingHours === b.workingHours) return a.user.name.localeCompare(b.user.name);
        return a.workingHours === null ? 1 : -1;
      }
      if (sort === "workingHoursDesc") return b.workingHours - a.workingHours;
      // Working Hours ascending: the people with the least student-facing time
      // come first, which is the reason a manager opens this page.
      return a.workingHours - b.workingHours;
    });
  }, [data, search, status, sort]);

  // Summed over the rows that HAVE a figure. If none of them do — the
  // performance request failed, or every visible person has left — the tile
  // reads "—", because a week nobody could read is not a week of no teaching.
  const totalWorkingHours = useMemo(() => {
    const known = rows.filter((r) => r.workingHours !== null);
    return known.length === 0 ? null : known.reduce((n, r) => n + (r.workingHours ?? 0), 0);
  }, [rows]);

  const remove = useCallback(async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await apiSend(
        `/api/instructors/${removing.id}/manager`,
        "PATCH",
        { managerId: null },
        "Could not remove this instructor from your roster.",
      );
      toast("success", `${removing.user.name} removed from your roster. Their records are intact.`);
      setRemoving(null);
      reload();
    } catch (e) {
      toast("danger", e instanceof Error ? e.message : "Could not remove this instructor.");
    } finally {
      setBusy(false);
    }
  }, [removing, toast, reload]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Instructors"
        description="The instructors who report to you."
      />

      {error ? <ErrorState message="Unable to load your roster" detail={error} onRetry={reload} /> : null}

      {data ? (
        /* Two questions a roster can answer honestly: how many people report to
           you, and how much of their week went to students. The tiles that used
           to stand beside these counted "deliverable hours" — hours whose
           category happened to be named Deliverable Work, which excluded every
           lecture — and a headcount of instructors whose utilization band had
           slipped, which is a statement about recorded minutes rather than
           about teaching. Neither had an honest replacement, so neither is
           drawn. */
        <div className="grid gap-4 sm:grid-cols-2">
          <StatTile label="Assigned instructors" value={rows.length} />
          <StatTile
            label="Working Hours this week"
            value={formatHours(totalWorkingHours)}
          />
        </div>
      ) : null}

      <Card>
        <CardHeader
          title={data ? `${rows.length} instructor${rows.length === 1 ? "" : "s"}` : "Roster"}
          actions={
            <div className="flex flex-wrap items-end gap-2">
              <SearchInput
                label="Search your roster"
                value={search}
                onChange={setSearch}
                placeholder="Name, email or employee ID…"
                className="w-full sm:w-56"
              />
              <Field label="Status">
                <Select value={status} onChange={(e) => setStatus(e.target.value)} className="min-w-32">
                  <option value="active">Active</option>
                  <option value="inactive">Former</option>
                  <option value="all">All</option>
                </Select>
              </Field>
              <Field label="Sort by">
                <Select value={sort} onChange={(e) => setSort(e.target.value)} className="min-w-52">
                  {SORTS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          }
        />

        {loading && !data ? (
          <TableSkeleton cols={5} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={data?.rows.length ? "No instructor matches" : "Nobody reports to you yet"}
            description={
              data?.rows.length
                ? "Adjust the search or filters."
                : "An administrator assigns instructors to a roster. Once they do, your team appears here."
            }
          />
        ) : (
          <>
            {/* Working Hours is the only figure in the row. The meter that once
                followed it charted recorded minutes against the configured
                working day — a day of back-to-back internal meetings filled it
                as convincingly as a day of teaching, and it passed 100% often
                enough that nobody read it. The badge in Status was that same
                percentage under a word, which left the column silent on the one
                thing it is named for; it now answers that instead. */}
            <div className="hidden lg:block">
              <TableWrap>
                <Table caption="Instructors assigned to you, with this week's Working Hours">
                  <THead
                    columns={[
                      { label: "Instructor" },
                      { label: "Employee ID" },
                      { label: "Working Hours", align: "right" },
                      { label: "Status" },
                      { label: "Action" },
                      /* After the action, which is where the client asked for
                         it: the row's figures and its controls first, then the
                         reading of them. */
                      { label: "AI Insight" },
                    ]}
                  />
                  <TBody>
                    {rows.map((r) => (
                      <TR key={r.id}>
                        <TD strong>
                          <Link
                            href={`/manager/instructors/${r.id}/report`}
                            className="font-medium text-primary hover:underline"
                          >
                            {r.user.name}
                          </Link>
                          <span className="block text-xs text-muted">{r.user.email}</span>
                        </TD>
                        <TD>
                          <span className="tabular text-muted">{r.employeeCode ?? "—"}</span>
                        </TD>
                        <TD align="right">
                          <span className="tabular">{formatHours(r.workingHours)}</span>
                        </TD>
                        <TD>
                          {r.user.isActive ? (
                            <Badge tone="success">Active</Badge>
                          ) : (
                            <Badge tone="neutral">Former</Badge>
                          )}
                        </TD>
                        <TD>
                          <span className="flex flex-wrap gap-2">
                            <ButtonLink
                              href={`/manager/instructors/${r.id}/report`}
                              variant="secondary"
                              size="sm"
                              aria-label={`View ${r.user.name}'s report`}
                            >
                              View
                            </ButtonLink>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => setRemoving(r)}
                              aria-label={`Remove ${r.user.name} from your roster`}
                            >
                              Remove
                            </Button>
                          </span>
                        </TD>
                        <TD>
                          <AiInsightCell insight={data?.insights[r.id] ?? null} />
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            </div>

            <div className="lg:hidden">
              {/* The same row, narrower: the trailing figure is labelled rather
                  than left as a bare duration, because the card has no column
                  header to carry the name. It used to be a utilization
                  percentage, which the table no longer shows either. */}
              <CardList>
                {rows.map((r) => (
                  <CardListItem
                    key={r.id}
                    href={`/manager/instructors/${r.id}/report`}
                    title={
                      <>
                        {r.user.name}
                        {!r.user.isActive ? (
                          <span className="ml-2">
                            <Badge tone="neutral">Former</Badge>
                          </span>
                        ) : null}
                      </>
                    }
                    subtitle={
                      `${r.employeeCode ?? "—"}` +
                      (r.category ? ` · ${humanizeCode(r.category)}` : "")
                    }
                    trailing={
                      <span className="text-right">
                        <span className="tabular block text-sm text-content">
                          {formatHours(r.workingHours)}
                        </span>
                        <span className="block text-xs text-muted">Working Hours</span>
                      </span>
                    }
                  />
                ))}
              </CardList>
            </div>
          </>
        )}
      </Card>

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
        pending={busy}
        title="Remove this instructor from your roster?"
        description={
          removing
            ? `${removing.user.name} will be unassigned from you. Their historical activity, deliverables and records are NOT deleted — an administrator will see them as unassigned and can place them on another roster.`
            : ""
        }
        confirmLabel="Remove from roster"
        destructive
      />

      {/* Scoped to this manager's own roster by the endpoint, not by anything
          this page sends. */}
    </div>
  );
}
