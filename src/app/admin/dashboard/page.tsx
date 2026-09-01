"use client";

/**
 * The admin's dashboard: is the institute writing its work down.
 *
 * ── The shape ─────────────────────────────────────────────────────────────
 * Four figures, then the month's curve beside what just happened, then the
 * people who have not filed. It reads top-down as the questions arrive: how
 * many people, how many wrote today, how many did not, how much work
 * altogether — then the trend, then the names.
 *
 * ── One payload ───────────────────────────────────────────────────────────
 * Everything comes from `/api/admin/dashboard`. Four endpoints answering four
 * corners of one screen eventually disagree, because each answers as of its
 * own moment with its own idea of which people count. See the route's own
 * note.
 *
 * ── What is deliberately not here ─────────────────────────────────────────
 * A Remind action on the outstanding list. The client removed it from the
 * manager's dashboard, and an admin nudging somebody else's instructor over
 * their manager's head is the version of it with the least standing.
 *
 * The per-university breakdown, the period picker and the average-hours card
 * moved off this screen rather than being deleted: they answer "which campus"
 * and this one answers "which person". `/admin/universities` still carries
 * them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Badge,
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

/**
 * The chart's drawing height, which sets how tall this row is.
 *
 * It used to be paired with a hand-kept `max-h-[15.5rem]` on the panel beside
 * it — two numbers that had to agree and did not. The panel now stretches to
 * the row instead of restating this one.
 */
const PANEL_BODY_PX = 170;
import { Avatar } from "@/app/_components/AccountDialogs";
import { apiGet, useLoad } from "@/app/_lib/api";
import { useUniversityToday } from "@/app/_lib/zone";
import { formatDayAs, formatHours } from "@/app/_lib/format";

/* ── What the endpoint returns ────────────────────────────────────────────── */

type Dashboard = {
  date: string;
  month: { from: string; to: string };
  totals: {
    employees: number;
    instructors: number;
    submittedToday: number;
    pendingToday: number;
    monthHours: number;
    lastMonthHours: number;
  };
  /** `count` is null for a day still ahead — see the route. */
  series: Array<{ date: string; count: number | null }>;
  compare: Array<{ date: string; count: number }>;
  recent: Array<{
    id: string;
    name: string;
    employeeCode: string | null;
    at: string;
    workDate: string;
    label: string;
  }>;
  outstanding: Array<{
    instructorId: string;
    name: string;
    employeeCode: string | null;
    universityName: string;
    lastRecordedOn: string | null;
  }>;
};

const shortDay = (iso: string) => formatDayAs(iso, { day: "numeric", month: "short" });

/** "10 May 2026, 06:15 PM" — when an entry was written, not the day it covers. */
function writtenAt(iso: string): string {
  const at = new Date(iso);
  return `${formatDayAs(at.toISOString().slice(0, 10), { day: "numeric", month: "short", year: "numeric" })}, ${at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true })}`;
}

/* ── The page ─────────────────────────────────────────────────────────────── */

export default function AdminDashboardPage() {
  const today = useUniversityToday();

  /* ── The activity card is exactly as tall as the chart card ──────────────
   * Both sit in one grid row, and a grid row is as tall as its tallest item, so
   * whichever card grows decides for both. Left alone the list wins and the
   * chart floats above a stretch of nothing.
   *
   * Capping the list to the chart's DRAWING height does not fix it either: the
   * two card headers are different heights, so a body capped to the same number
   * still leaves a gap under one of them. The chart card is measured instead
   * and this one is told to be that — measured rather than calculated because
   * the only thing that reliably knows how tall a card is, with its header
   * wrapped to however many lines today's text needs, is the card.
   *
   * The manager's dashboard does the same thing for the same reason. */
  const chartCard = useRef<HTMLDivElement>(null);
  const [rowHeight, setRowHeight] = useState(0);

  useEffect(() => {
    const el = chartCard.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setRowHeight(entry?.contentRect.height ?? 0);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const load = useCallback(
    () =>
      apiGet<Dashboard>(
        `/api/admin/dashboard?date=${today}`,
        "Could not load the dashboard.",
      ),
    [today],
  );
  const { data, error, loading, reload } = useLoad(load, `admin-dashboard:${today}`);

  const series = useMemo<TrendPoint[]>(
    () => (data?.series ?? []).map((p) => ({ label: shortDay(p.date), value: p.count })),
    [data],
  );
  const compare = useMemo<TrendPoint[]>(
    () => (data?.compare ?? []).map((p) => ({ label: shortDay(p.date), value: p.count })),
    [data],
  );

  /** Hours this month against last, as a percentage the tile can print. */
  const hoursDelta = useMemo(() => {
    const before = data?.totals.lastMonthHours ?? 0;
    if (!data || before <= 0) return null;
    const pct = Math.round(((data.totals.monthHours - before) / before) * 100);
    return { pct, up: pct >= 0 };
  }, [data]);

  if (error && !data) {
    return (
      <div>
        <PageHeader title="Dashboard" />
        <ErrorState message={error} onRetry={reload} />
      </div>
    );
  }

  const monthName = data ? formatDayAs(data.month.from, { month: "long", year: "numeric" }) : "";

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={`${formatDayAs(today, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · ${monthName} to date`}
      />

      {/* ── The four figures ───────────────────────────────────────────────
          Head count first, because the three after it are read against it.

          No "+12 this month" under the head count: nothing in this product
          records when somebody joined, so that comparison could only have been
          invented. The three that CAN be compared say so. */}
      {loading && !data ? (
        <StatGridSkeleton />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Total employees" value={data?.totals.employees ?? 0} />
          <StatTile
            label="Today's submissions"
            value={data?.totals.submittedToday ?? 0}
            hint={
              data && data.totals.instructors > 0
                ? `${Math.round((data.totals.submittedToday / data.totals.instructors) * 100)}% of instructors`
                : undefined
            }
          />
          <StatTile
            label="Pending submissions"
            value={data?.totals.pendingToday ?? 0}
            tone={(data?.totals.pendingToday ?? 0) > 0 ? "warning" : "neutral"}
            hint={
              data && data.totals.instructors > 0
                ? `${Math.round((data.totals.pendingToday / data.totals.instructors) * 100)}% still to record`
                : undefined
            }
          />
          <StatTile
            label={`Total work hours (${formatDayAs(data?.month.from ?? today, { month: "short" })})`}
            value={formatHours(data?.totals.monthHours ?? 0)}
            delta={hoursDelta ? `${hoursDelta.up ? "+" : ""}${hoursDelta.pct}% vs last month` : undefined}
            deltaTone={hoursDelta ? (hoursDelta.up ? "success" : "warning") : undefined}
          />
        </div>
      )}

      {/* ── The month, and what just happened ──────────────────────────────
          The curve is the shape of the month; the list beside it is the last
          few things anybody wrote. Together they answer "is it working" and
          "is it working right now", which are different questions. */}
      {/* `items-start` so neither card is stretched by the other — the
          activity panel is sized from the measurement above instead. */}
      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div ref={chartCard}>
        <Card>
          <CardHeader
            title="Submission overview"
            description="How many instructors recorded on each day."
          />
          <div className="px-5 pb-5">
            {loading && !data ? (
              <TableSkeleton rows={4} cols={1} />
            ) : series.length === 0 ? (
              <EmptyState title="Nothing recorded yet" />
            ) : (
              <TrendLine
                points={series}
                seriesLabel="This month"
                compare={{ label: "Last month", points: compare }}
                unit="submissions"
                height={PANEL_BODY_PX}
              />
            )}
          </div>
        </Card>
        </div>

        {/* Exactly the chart card's height. The height sits on a wrapper rather
            than on `Card`, which takes a className but not a style — giving a
            shared primitive an inline-style hatch for one screen is how it
            stops being shared. */}
        <div style={rowHeight ? { height: rowHeight } : undefined}>
        <Card className="flex h-full flex-col">
          <CardHeader title="Recent activity" description="The latest entries written." />
          {/* A fixed box that scrolls, not a list that grows.
            *
            * Eight entries made this card taller than the chart beside it, so
            * the row below was pushed down by however busy the last hour
            * happened to be. Bounded to roughly the chart's height: the panel
            * is now the same size whatever it holds, and the rest is reached by
            * scrolling inside it.
            *
            * `max-h` rather than `h`, so a quiet morning with two entries does
            * not leave a card two thirds empty. */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
            {loading && !data ? (
              <TableSkeleton rows={5} cols={1} />
            ) : (data?.recent.length ?? 0) === 0 ? (
              <EmptyState title="Nothing recorded yet" />
            ) : (
              <ul className="divide-y divide-line">
                {data!.recent.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 py-2.5">
                    <Avatar name={r.name} avatarUrl={null} size={28} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-content">
                        <span className="font-medium">{r.name}</span> recorded {r.label}
                      </span>
                      {/* When it was WRITTEN, and — only when they differ — the
                          day it was written ABOUT. A backdated entry filed this
                          morning is this morning's news, and saying so is the
                          difference between the two dates being visible and
                          being a discrepancy somebody has to notice. */}
                      <span className="block truncate text-xs text-muted">
                        {writtenAt(r.at)}
                        {r.workDate !== r.at.slice(0, 10) ? ` · for ${shortDay(r.workDate)}` : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
        </div>
      </div>

      {/* ── Who has not filed ─────────────────────────────────────────────── */}
      <Card className="mt-4">
        <CardHeader
          title="Pending submissions"
          description={`Instructors with nothing recorded for ${formatDayAs(today, { day: "numeric", month: "long" })}. Longest silent first.`}
        />

        {loading && !data ? (
          <TableSkeleton rows={5} cols={6} />
        ) : (data?.outstanding.length ?? 0) === 0 ? (
          <EmptyState
            title="Everybody is up to date"
            description="Every active instructor has recorded today."
          />
        ) : (
          <TableWrap
            /* Bounded and scrolling, like the activity panel above it: the
               table is as tall as the layout says, not as tall as the number of
               people who have not filed. */
            maxHeight="22rem"
          >
            <Table caption="Instructors with nothing recorded today, longest silent first.">
              <THead
                columns={[
                  { label: "Employee name" },
                  { label: "Employee ID" },
                  { label: "University" },
                  { label: "Last submission" },
                  { label: "Status" },
                ]}
              />
              <TBody>
                {data!.outstanding.map((p) => (
                  <TR key={p.instructorId}>
                    <TD strong>
                      <span className="flex items-center gap-2">
                        <Avatar name={p.name} avatarUrl={null} size={28} />
                        <Link
                          href={`/admin/instructors/${p.instructorId}/report`}
                          className="truncate hover:underline"
                        >
                          {p.name}
                        </Link>
                      </span>
                    </TD>
                    <TD>
                      <span className="tabular">{p.employeeCode ?? "—"}</span>
                    </TD>
                    <TD>{p.universityName}</TD>
                    <TD>
                      {p.lastRecordedOn ? (
                        <span className="tabular">
                          {formatDayAs(p.lastRecordedOn, {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                        </span>
                      ) : (
                        /* Never, which is not the same as a long time ago —
                           one is somebody who has stopped, the other is
                           somebody who never started. */
                        <span className="text-subtle">Never</span>
                      )}
                    </TD>
                    <TD>
                      <Badge tone="warning">Pending</Badge>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
