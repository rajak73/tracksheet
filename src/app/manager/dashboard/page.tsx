"use client";

/**
 * The manager's dashboard: is my team writing their work down, and how much.
 *
 * ── The shape, and why it is this shape ───────────────────────────────────
 * Four figures, then today's picture beside the month's, then the roster. It
 * answers in that order because that is the order the questions arrive: how
 * many people, how many wrote today, how many did not, how much work in total —
 * then who, specifically, and when they last did.
 *
 * ── "Pending" is not an approval ──────────────────────────────────────────
 * There IS an approval concept in this product — a submission written outside
 * the university's hours waits for a manager's decision — and it is NOT what
 * this page means by pending. Here pending is simply: today is a working day
 * for this person and they have not recorded it yet. Approvals live on
 * `/manager/worklog`, where the decision can actually be taken.
 *
 * ── One fetch per month, and everything derived from it ───────────────────
 * Every figure on this page comes from `/api/manager/worklog` over the calendar
 * month, plus the same call for the month before it. Nothing is added up twice
 * from two sources: the KPI row, the chart, the pending list and the table are
 * four readings of one payload, so they cannot disagree with each other the way
 * two endpoints eventually would.
 *
 * ── What is deliberately NOT here ─────────────────────────────────────────
 * The Day/Week/Month roster grid, the period stepper and the CSV export. All
 * three already exist on `/manager/worklog`, in fuller form, with the per
 * activity detail this page's status column only summarises. A dashboard that
 * reproduced them would be a second copy to keep in step.
 */

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  StatGridSkeleton,
  StatTile,
  Table,
  TableSkeleton,
  TableWrap,
  TBody,
  TD,
  THead,
  TR,
} from "@/app/_components/ui";
import { TrendLine, type TrendPoint } from "@/app/_components/charts";
import { Avatar } from "@/app/_components/AccountDialogs";
import { useToast } from "@/app/_components/interactive";
import { pingNotifications } from "@/app/_components/NotificationBell";
import { apiGet, apiSend, useLoad } from "@/app/_lib/api";
import { useQueryState } from "@/app/_lib/query-state";
import { useUniversityToday } from "@/app/_lib/zone";
import { formatDayAs, formatHours } from "@/app/_lib/format";

/* ── Shapes ───────────────────────────────────────────────────────────────── */

type DayCell = {
  date: string;
  hours: number;
  activityCount: number;
  isWorkingDay: boolean;
  capacityHours: number;
  status: "complete" | "partial" | "missing" | "off";
};

type Row = {
  instructorId: string;
  name: string;
  avatarUrl: string | null;
  employeeCode: string | null;
  totalHours: number;
  activityCount: number;
  days: DayCell[];
};

type Worklog = {
  period: { from: string; to: string };
  /** Everyone on the roster, including anyone with nothing in this window. */
  rosterTotal: number;
  summary: {
    instructors: number;
    submitted: number;
    missing: number;
    totalHours: number;
    totalActivities: number;
  };
  instructors: Row[];
};

/* ── Dates ────────────────────────────────────────────────────────────────── */

/* The CALENDAR month, not the whole-week month the roster grid uses. This page
 * plots a point per day and names the axis by date, so a column belonging to
 * the previous month would be a day of the wrong month sitting under a heading
 * that names this one. */
function monthBounds(iso: string): { from: string; to: string } {
  const [y, m] = [Number(iso.slice(0, 4)), Number(iso.slice(5, 7))];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${iso.slice(0, 7)}-01`, to: `${iso.slice(0, 7)}-${String(last).padStart(2, "0")}` };
}

function previousMonthOf(iso: string): string {
  const [y, m] = [Number(iso.slice(0, 4)), Number(iso.slice(5, 7))];
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 10);
}

function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00.000Z`); d.toISOString().slice(0, 10) <= to; ) {
    out.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 86_400_000);
  }
  return out;
}

/* ── Reading one day ──────────────────────────────────────────────────────── */

const cellOn = (row: Row, date: string): DayCell | null =>
  row.days.find((d) => d.date === date) ?? null;

/** Did they write anything down? `complete` and `partial` both did. */
const recorded = (cell: DayCell | null): boolean =>
  cell !== null && (cell.status === "complete" || cell.status === "partial");

/**
 * Are they late, or is it simply not their working day?
 *
 * `off` is a Sunday or a holiday and must not count as pending — a roster shown
 * as "16 pending" every weekend teaches the reader to ignore the figure.
 */
const owing = (cell: DayCell | null): boolean => cell !== null && cell.status === "missing";

/** The last day in the window they recorded on, or null if they never did. */
function lastRecorded(row: Row): string | null {
  for (let i = row.days.length - 1; i >= 0; i -= 1) {
    if (recorded(row.days[i]!)) return row.days[i]!.date;
  }
  return null;
}

/* ── The page ─────────────────────────────────────────────────────────────── */

export default function ManagerDashboardPage() {
  const today = useUniversityToday();
  const toast = useToast();

  /* Search and sort are on the URL, so a refresh comes back to the same roster
   * and the view can be sent to somebody. See `useQueryState`. */
  const [q, setQ] = useQueryState({ search: "", sort: "name" });
  const search = q.search;
  const sort = (["name", "hours-desc", "hours-asc"].includes(q.sort) ? q.sort : "name") as
    | "name"
    | "hours-desc"
    | "hours-asc";

  const [reminding, setReminding] = useState<string | null>(null);

  const thisMonth = useMemo(() => monthBounds(today), [today]);
  const lastMonth = useMemo(() => monthBounds(previousMonthOf(today)), [today]);

  const loadThis = useCallback(
    () =>
      apiGet<Worklog>(
        `/api/manager/worklog?from=${thisMonth.from}&to=${thisMonth.to}`,
        "Could not load your team.",
      ),
    [thisMonth.from, thisMonth.to],
  );
  const current = useLoad(loadThis, `mgr-month:${thisMonth.from}`);

  /* The month before, for the dashed line and the hours comparison. Its failure
   * is not this page's failure: a dashboard that refuses to render because it
   * could not fetch LAST month would be worse than one drawn without the
   * comparison, so this is read defensively everywhere below. */
  const loadPrev = useCallback(
    () =>
      apiGet<Worklog>(
        `/api/manager/worklog?from=${lastMonth.from}&to=${lastMonth.to}`,
        "Could not load last month.",
      ),
    [lastMonth.from, lastMonth.to],
  );
  const previous = useLoad(loadPrev, `mgr-month:${lastMonth.from}`);

  /* Memoised because `?? []` is a fresh array on every render, and four memos
   * below depend on it — without this they would all recompute continuously. */
  const rows = useMemo(() => current.data?.instructors ?? [], [current.data]);

  /** Today, per person. */
  const todayStats = useMemo(() => {
    const submitted = rows.filter((r) => recorded(cellOn(r, today))).length;
    const pending = rows.filter((r) => owing(cellOn(r, today))).length;
    // Working today at all? If nobody is, the percentages below are meaningless
    // rather than zero, and are suppressed.
    const working = rows.filter((r) => cellOn(r, today)?.status !== "off").length;
    return { submitted, pending, working };
  }, [rows, today]);

  /**
   * Submissions per day, this month against last.
   *
   * A day in the future is `null`, not `0` — the difference between "nobody
   * recorded" and "it has not happened yet" is the whole point of the gap
   * handling in `TrendLine`, and drawing tomorrow as a zero would put a cliff
   * at the end of every month.
   */
  const series = useMemo((): { points: TrendPoint[]; compare: TrendPoint[] } => {
    const count = (source: Row[], date: string) =>
      source.reduce((n, r) => n + (recorded(cellOn(r, date)) ? 1 : 0), 0);

    const points = datesBetween(thisMonth.from, thisMonth.to).map((date) => ({
      label: formatDayAs(date, { day: "numeric", month: "short" }),
      value: date > today ? null : count(rows, date),
    }));

    const prevRows = previous.data?.instructors ?? [];
    const compare = datesBetween(lastMonth.from, lastMonth.to).map((date) => ({
      label: formatDayAs(date, { day: "numeric", month: "short" }),
      value: count(prevRows, date),
    }));

    return { points, compare };
  }, [rows, previous.data, thisMonth, lastMonth, today]);

  /** Hours this month against last, as the client's own "+10%" reading. */
  const hoursDelta = useMemo(() => {
    const now = current.data?.summary.totalHours ?? 0;
    const before = previous.data?.summary.totalHours ?? 0;
    if (!previous.data || before <= 0) return null;
    const pct = Math.round(((now - before) / before) * 100);
    return { pct, up: pct >= 0 };
  }, [current.data, previous.data]);

  /** Who has not recorded today, soonest-silent first. */
  const pending = useMemo(
    () =>
      rows
        .filter((r) => owing(cellOn(r, today)))
        .map((r) => ({ row: r, since: lastRecorded(r) }))
        .sort((a, b) => (a.since ?? "").localeCompare(b.since ?? "") || a.row.name.localeCompare(b.row.name)),
    [rows, today],
  );

  /** The roster table: searched, then sorted. */
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const matched = needle
      ? rows.filter(
          (r) =>
            r.name.toLowerCase().includes(needle) ||
            (r.employeeCode ?? "").toLowerCase().includes(needle),
        )
      : rows;

    return [...matched].sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : sort === "hours-desc"
          ? b.totalHours - a.totalHours
          : a.totalHours - b.totalHours,
    );
  }, [rows, search, sort]);

  /** A nudge, not a record: it writes a notification and changes no hours. */
  async function remind(instructorId: string) {
    setReminding(instructorId);
    try {
      await apiSend(
        `/api/instructors/${instructorId}/remind`,
        "POST",
        { workDate: today },
        "That reminder could not be sent.",
      );
      toast("success", "Reminder sent.");
      pingNotifications();
    } catch (e) {
      toast("danger", e instanceof Error ? e.message : "That reminder could not be sent.");
    } finally {
      setReminding(null);
    }
  }

  if (current.error && !current.data) {
    return (
      <div>
        <PageHeader title="Team Dashboard" />
        <ErrorState message={current.error} onRetry={current.reload} />
      </div>
    );
  }

  const monthName = formatDayAs(thisMonth.from, { month: "long", year: "numeric" });

  return (
    <div>
      <PageHeader
        title="Team Dashboard"
        description={`${formatDayAs(today, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · ${monthName} to date`}
      />

      {/* ── The four figures ───────────────────────────────────────────────
          Team size first because every other number on the row is read against
          it, then today split into done and outstanding, then the month's
          total.

          Note what is NOT claimed: the roster tile carries no "+2 this month".
          Nothing in this product records when somebody joined a roster, so that
          delta could only have been invented. Each of the other three states a
          comparison it can actually make. */}
      {current.loading && !current.data ? (
        <StatGridSkeleton />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Total team members"
            value={current.data?.rosterTotal ?? 0}
            emphasis
          />
          <StatTile
            label="Today's submissions"
            value={todayStats.submitted}
            hint={
              todayStats.working > 0
                ? `${Math.round((todayStats.submitted / todayStats.working) * 100)}% of those working today`
                : "Nobody is scheduled today"
            }
          />
          <StatTile
            label="Pending submissions"
            value={todayStats.pending}
            tone={todayStats.pending > 0 ? "warning" : "neutral"}
            hint={
              todayStats.working > 0
                ? `${Math.round((todayStats.pending / todayStats.working) * 100)}% still to record`
                : "Not a working day"
            }
          />
          <StatTile
            label={`Total work hours (${formatDayAs(thisMonth.from, { month: "short" })})`}
            value={formatHours(current.data?.summary.totalHours ?? 0)}
            delta={hoursDelta ? `${hoursDelta.up ? "+" : ""}${hoursDelta.pct}% vs last month` : undefined}
            deltaTone={hoursDelta ? (hoursDelta.up ? "success" : "warning") : undefined}
          />
        </div>
      )}

      {/* ── Today beside the month ─────────────────────────────────────────
          The chart is how the month has gone; the list is who is outstanding
          right now. Side by side because the second is the reason to look at
          the first: a dip in the line is a question, and the names answer it. */}
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader
            title="Team submission overview"
            description="How many of the roster recorded on each day."
          />
          <div className="px-5 pb-5">
            {current.loading && !current.data ? (
              <TableSkeleton rows={4} cols={1} />
            ) : rows.length === 0 ? (
              <EmptyState title="Nobody on your roster yet" />
            ) : (
              <TrendLine
                points={series.points}
                seriesLabel="This month"
                compare={{ label: "Last month", points: series.compare }}
                unit="submissions"
                height={200}
              />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Pending today"
            description="Working today, nothing recorded yet."
          />
          <div className="px-5 pb-5">
            {current.loading && !current.data ? (
              <TableSkeleton rows={4} cols={1} />
            ) : pending.length === 0 ? (
              <EmptyState
                title="Everybody is up to date"
                description="Nobody working today is outstanding."
              />
            ) : (
              <ul className="divide-y divide-line">
                {pending.map(({ row, since }) => (
                  <li key={row.instructorId} className="flex items-center gap-3 py-3">
                    <Avatar name={row.name} avatarUrl={row.avatarUrl} size={32} />
                    <span className="min-w-0 flex-1">
                      <Link
                        href={`/manager/instructors/${row.instructorId}/report`}
                        className="block truncate text-sm font-medium text-content hover:underline"
                      >
                        {row.name}
                      </Link>
                      {/* When they last wrote, which is what turns "pending"
                          into "pending since when" — one day late and eleven
                          days late are not the same problem. */}
                      <span className="block truncate text-xs text-muted">
                        {since
                          ? `Last recorded ${formatDayAs(since, { day: "numeric", month: "short" })}`
                          : `Nothing recorded in ${monthName}`}
                      </span>
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={reminding === row.instructorId}
                      onClick={() => remind(row.instructorId)}
                    >
                      {reminding === row.instructorId ? "Sending…" : "Remind"}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      {/* ── The roster ─────────────────────────────────────────────────────── */}
      <Card className="mt-6">
        <CardHeader
          title="Team members status"
          description={`Today's record and the month's hours. ${monthName}.`}
          actions={
            <input
              type="search"
              value={search}
              onChange={(e) => setQ({ search: e.target.value })}
              placeholder="Search name or ID"
              aria-label="Search the roster"
              className="h-9 w-full rounded-control border border-line bg-surface px-3 text-sm text-content sm:w-56"
            />
          }
        />

        {current.loading && !current.data ? (
          <TableSkeleton rows={6} cols={5} />
        ) : visible.length === 0 ? (
          <EmptyState
            title={search.trim() ? "Nobody matches that search" : "Nobody on your roster yet"}
            description={
              search.trim()
                ? "Clear the search to see the whole roster."
                : "Instructors assigned to you appear here."
            }
          />
        ) : (
          <TableWrap>
            <Table caption="Every instructor on your roster, with today's record and this month's hours.">
              <THead
                columns={[
                  { label: "Employee name", sortKey: "name" },
                  { label: "Employee ID" },
                  { label: "Today's status" },
                  { label: "Last submission" },
                  { label: "Working hours (month)", align: "right", sortKey: "hours" },
                ]}
                sort={
                  sort === "name"
                    ? { key: "name", direction: "asc" }
                    : { key: "hours", direction: sort === "hours-desc" ? "desc" : "asc" }
                }
                onSort={(key) =>
                  setQ({
                    sort:
                      key === "name"
                        ? "name"
                        : sort === "hours-desc"
                          ? "hours-asc"
                          : "hours-desc",
                  })
                }
              />
              <TBody>
                {visible.map((row) => {
                  const cell = cellOn(row, today);
                  const since = lastRecorded(row);
                  return (
                    <TR key={row.instructorId}>
                      <TD strong>
                        <span className="flex items-center gap-2">
                          <Avatar name={row.name} avatarUrl={row.avatarUrl} size={28} />
                          <Link
                            href={`/manager/instructors/${row.instructorId}/report`}
                            className="truncate hover:underline"
                          >
                            {row.name}
                          </Link>
                        </span>
                      </TD>
                      <TD>
                        <span className="tabular">{row.employeeCode ?? "—"}</span>
                      </TD>
                      <TD>
                        {/* Three outcomes, not two. A day off is not a failure
                            to submit, and colouring it like one is how a roster
                            comes to read as half-delinquent every weekend. */}
                        {recorded(cell) ? (
                          <Badge tone="success">Submitted</Badge>
                        ) : owing(cell) ? (
                          <Badge tone="danger">Pending</Badge>
                        ) : (
                          <Badge tone="neutral">Not a working day</Badge>
                        )}
                      </TD>
                      <TD>
                        {since ? (
                          <span className="tabular">
                            {formatDayAs(since, { day: "numeric", month: "short", year: "numeric" })}
                          </span>
                        ) : (
                          <span className="text-subtle">—</span>
                        )}
                      </TD>
                      <TD align="right" strong>
                        {formatHours(row.totalHours)}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
