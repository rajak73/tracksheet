"use client";

/**
 * The admin's dashboard: the network, one row per university.
 *
 * ── The question this page answers ────────────────────────────────────────
 * A manager asks "how is MY roster doing". An admin is not managing a roster
 * and cannot usefully read thirty of them; the admin's question is whether the
 * day is being RECORDED across the institute, and where it is not. So the
 * centrepiece is a league table of universities, and the loudest figure on the
 * page is the count of people who wrote nothing.
 *
 * ── Why it was rewritten ──────────────────────────────────────────────────
 * The previous version led with a Utilization percentage taken from the
 * engine's `productiveMinutes` — every recorded minute, meetings and
 * preparation included — and ranked "top performing managers" by it. Working
 * Hours had since been defined as time spent WITH STUDENTS, and the instructor
 * sheet, the manager sheet, the manager dashboard and the client's tracker were
 * all rebuilt around that. This page was the last one still adding up a
 * different number and calling it the same thing, and it also still spoke the
 * old vocabulary: "Teaching" hours after that category was renamed Lecture,
 * bare decimal hours after the product settled on `01h 30m`.
 *
 * Ranking people by that figure was the part that had to go rather than be
 * relabelled. It rewarded whoever recorded the most minutes of anything.
 *
 * ── What is deliberately absent ───────────────────────────────────────────
 * No utilization percentage. It needs a capacity to divide by, and capacity is
 * configured per university — an institute-wide percentage would be dividing by
 * a number that means something different in each row. The drill-through leads
 * to the university's own page, where capacity is known.
 *
 * The average hours per instructor IS here, and the distinction is the
 * denominator: it divides by headcount, which counts the same thing everywhere,
 * rather than by capacity, which does not. That also fixes what it is an
 * average OF — the divisor is the whole roster, so an instructor who logged
 * nothing is a zero in the average rather than absent from it. See
 * `averageMinutesPerInstructor`.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { KpiCard } from "@/app/_components/ManagerDashboard";
import { PeriodPicker, type View } from "@/app/_components/PeriodPicker";
import { AverageHoursByUniversity } from "@/app/_components/AverageHoursByUniversity";
import {
  IconUniversity,
  IconUsers,
  IconActivity,
  IconAlert,
} from "@/app/_components/icons";
import {
  Card,
  ErrorState,
  EmptyState,
  PageHeader,
  StatGridSkeleton,
  TableSkeleton,
} from "@/app/_components/ui";
import { apiGet, useLoad } from "@/app/_lib/api";
import { useUniversityToday } from "@/app/_lib/zone";
import { formatDayAs, formatHours } from "@/app/_lib/format";
import { categoryColor } from "@/app/_components/charts";

/* ── What the endpoint returns ────────────────────────────────────────────── */

type Line = { code: string; label: string; hours: number; countable: boolean };

type UniversityRow = {
  id: string;
  name: string;
  slug: string;
  instructors: number;
  recording: number;
  silent: number;
  workingHours: number;
  otherHours: number;
  lines: Line[];
  lastRecordedOn: string | null;
};

type Network = {
  period: { from: string; to: string };
  universities: UniversityRow[];
  totals: {
    universities: number;
    silentUniversities: number;
    instructors: number;
    recording: number;
    silent: number;
    workingHours: number;
    otherHours: number;
  };
};

/* ── Dates. The same rules as the manager dashboard, so the two agree. ────── */

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  return addDays(iso, -((d.getUTCDay() + 6) % 7));
}

/** The month as WHOLE weeks — a week clipped at the 1st is not comparable. */
function monthEdges(iso: string): { from: string; to: string } {
  const d = new Date(`${iso}T00:00:00.000Z`);
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  return { from: mondayOf(first), to: addDays(mondayOf(last), 6) };
}



const VIEW_KEY = "niat:admin:view";

type Sort = "name" | "hours-desc" | "hours-asc" | "silent-desc";

/* ── The page ─────────────────────────────────────────────────────────────── */

export default function AdminDashboardPage() {
  /**
   * Today, in the UNIVERSITY's zone.
   *
   * This was a hand-rolled helper reading `getFullYear()/getMonth()/getDate()` —
   * the BROWSER's date. The audit that removed every other one of these missed
   * all three, because it searched for the name `todayISO` and these were spelled
   * `todayIso` and defined locally rather than imported. The guard is a pattern
   * now, not a name.
   */
  const today = useUniversityToday();
  const [view, setView] = useState<View>("day");
  const [anchor, setAnchor] = useState(today);
  /* Silent first by default. The reason to open this page is to find what is
   * missing, and sorting by name would bury it behind whoever is alphabetically
   * first. */
  const [sort, setSort] = useState<Sort>("silent-desc");
  const [restored, setRestored] = useState(false);

  /* The chosen view survives a refresh; the chosen DATE does not. Coming back
   * to the page tomorrow should land on tomorrow, but it should not silently
   * switch from the month you were reading back to a single day. */
  useEffect(() => {
    // Scheduled rather than set here: setting state synchronously inside an
    // effect cascades one render into another before the first has painted.
    const restore = setTimeout(() => {
      const saved = window.localStorage.getItem(VIEW_KEY);
      if (saved === "day" || saved === "week" || saved === "month") setView(saved);
      setRestored(true);
    }, 0);
    return () => clearTimeout(restore);
  }, []);

  useEffect(() => {
    if (restored) window.localStorage.setItem(VIEW_KEY, view);
  }, [restored, view]);

  const range = useMemo(() => {
    if (view === "day") return { from: anchor, to: anchor };
    if (view === "week") {
      const monday = mondayOf(anchor);
      return { from: monday, to: addDays(monday, 6) };
    }
    return monthEdges(anchor);
  }, [view, anchor]);

  const load = useCallback(
    () =>
      apiGet<Network>(
        `/api/admin/network?from=${range.from}&to=${range.to}`,
        "Could not load the network.",
      ),
    [range.from, range.to],
  );
  const network = useLoad(load, `admin-network:${range.from}:${range.to}`);

  const rows = useMemo(() => {
    const all = network.data?.universities ?? [];
    if (sort === "name") return [...all].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "silent-desc") {
      // Ties broken by name, so the order is stable rather than incidental.
      return [...all].sort((a, b) => b.silent - a.silent || a.name.localeCompare(b.name));
    }
    return [...all].sort((a, b) =>
      sort === "hours-desc"
        ? b.workingHours - a.workingHours
        : a.workingHours - b.workingHours,
    );
  }, [network.data, sort]);

  const totals = network.data?.totals ?? null;

  if (network.error && !network.data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Dashboard" />
        <ErrorState message="Unable to load the dashboard" detail={network.error} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Every university delivering the programme, in the period you are looking at."
        actions={
          <PeriodPicker
            view={view}
            onView={setView}
            selected={anchor}
            onSelect={setAnchor}
            today={today}
          />
        }
      />

      {/* ── What each university averages per active instructor-day ────────
        * Shown first, ahead of the network totals below: it is the one figure
        * on this page an admin reads university-by-university rather than as
        * a single network-wide number, so it leads rather than follows.
        * Σ(active minutes) ÷ Σ(active instructor-count) — see
        * `src/domain/average-hours.ts` for the confirmed formula. Its own
        * Day/Week/Month switch, because the question "what are we averaging"
        * is asked at a granularity of its own rather than whatever the page
        * below happens to be showing. */}
      <AverageHoursByUniversity />

      {/* ── The four figures ─────────────────────────────────────────────── */}
      {network.loading && !totals ? (
        <StatGridSkeleton />
      ) : totals ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Universities"
            value={String(totals.universities)}
            icon={<IconUniversity size={20} />}
            tint="blue"
            footnote={
              totals.silentUniversities > 0
                ? `${totals.silentUniversities} recorded nothing`
                : "All recorded something"
            }
          />
          <KpiCard
            label="Instructors"
            value={String(totals.instructors)}
            icon={<IconUsers size={20} />}
            tint="violet"
            footnote={`${totals.recording} recorded in this period`}
          />
          <KpiCard
            label="Working Hours"
            value={formatHours(totals.workingHours)}
            icon={<IconActivity size={20} />}
            tint="green"
            footnote={
              /* Stated, not hidden. The two figures do not add up to a day's
               * work by accident — one of them is deliberately excluded, and a
               * total with no explanation invites the arithmetic anyway. */
              <>Time with students. {formatHours(totals.otherHours)} recorded elsewhere.</>
            }
          />
          <KpiCard
            label="Recorded nothing"
            value={String(totals.silent)}
            icon={<IconAlert size={20} />}
            tint="amber"
            footnote={
              totals.silent === 0
                ? "Everyone wrote something"
                : "Not the same as zero hours — nothing was written"
            }
          />
        </div>
      ) : null}

      {/* ── The network ──────────────────────────────────────────────────── */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-content">Universities</h2>
            <p className="mt-0.5 text-sm text-muted">
              {formatDayAs(range.from, { day: "numeric", month: "short", year: "numeric" })}
              {range.from === range.to
                ? null
                : ` – ${formatDayAs(range.to, { day: "numeric", month: "short", year: "numeric" })}`}
            </p>
          </div>
          <SortControl sort={sort} onSort={setSort} />
        </div>

        {network.loading && !network.data ? (
          <TableSkeleton rows={5} cols={4} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No universities yet"
            description="Add a university and its instructors before anything can be recorded."
          />
        ) : (
          <ul>
            {rows.map((row) => (
              <UniversityCard key={row.id} row={row} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ── Sorting ──────────────────────────────────────────────────────────────── */

function SortControl({ sort, onSort }: { sort: Sort; onSort: (next: Sort) => void }) {
  const options: Array<[Sort, string]> = [
    ["silent-desc", "Not recording first"],
    ["hours-desc", "Most hours"],
    ["hours-asc", "Fewest hours"],
    ["name", "Name"],
  ];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {options.map(([value, label]) => (
        <button
          key={value}
          type="button"
          onClick={() => onSort(value)}
          aria-pressed={sort === value}
          className={`rounded-chip px-3 py-1.5 text-xs font-medium transition-colors ${
            sort === value
              ? "bg-primary-subtle text-primary-text"
              : "text-muted hover:bg-hovered hover:text-content"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/* ── One university ───────────────────────────────────────────────────────── */

function UniversityCard({ row }: { row: UniversityRow }) {
  const nothingWritten = row.instructors > 0 && row.recording === 0;

  return (
    <li className="border-b border-line last:border-b-0">
      <Link
        href={`/admin/universities/${row.id}`}
        className="flex flex-wrap items-start gap-4 px-5 py-4 transition-colors hover:bg-primary-subtle"
      >
        {/* Identity and the recording count, fixed at the left, because these
            are what the row is scanned for. */}
        <div className="min-w-0 flex-1 basis-64">
          <p className="truncate text-sm font-semibold text-content">{row.name}</p>
          <p className="mt-1 text-xs text-muted">
            {row.instructors === 0 ? (
              "No instructors yet"
            ) : (
              <>
                <span className={nothingWritten ? "font-medium text-warning-text" : undefined}>
                  {row.recording} of {row.instructors}
                </span>{" "}
                recorded
                {row.lastRecordedOn ? (
                  <>
                    {" · last on "}
                    {formatDayAs(row.lastRecordedOn, { day: "numeric", month: "short" })}
                  </>
                ) : null}
              </>
            )}
          </p>
        </div>

        {/* What the hours were spent on. Muted segments are the ones that do
            not count toward Working Hours — shown, because the work happened,
            and muted, so nobody adds the bar up to the figure beside it. */}
        <div className="min-w-0 flex-1 basis-72">
          {row.lines.length === 0 ? (
            <p className="text-xs text-subtle">Nothing recorded</p>
          ) : (
            <>
              <div className="flex h-2 overflow-hidden rounded-chip bg-sunken">
                {row.lines.map((line) => (
                  <span
                    key={`${line.code}:${line.countable}`}
                    title={`${line.label} – ${formatHours(line.hours)}${
                      line.countable ? "" : " (not counted in Working Hours)"
                    }`}
                    style={{
                      width: `${(line.hours / (row.workingHours + row.otherHours)) * 100}%`,
                      background: categoryColor(line.code),
                      opacity: line.countable ? 1 : 0.35,
                    }}
                  />
                ))}
              </div>
              <p className="mt-1.5 truncate text-xs text-muted">
                {row.lines
                  .slice(0, 3)
                  .map((l) => `${l.label} ${formatHours(l.hours)}`)
                  .join(" · ")}
                {row.lines.length > 3 ? ` · +${row.lines.length - 3} more` : ""}
              </p>
            </>
          )}
        </div>

        {/* The figure the table sorts on, last and right-aligned, the same
            place the manager sheet puts it. */}
        <div className="shrink-0 text-right">
          <p className="tabular text-base font-semibold text-content">
            {formatHours(row.workingHours)}
          </p>
          <p className="text-xs text-subtle">Working Hours</p>
        </div>
      </Link>
    </li>
  );
}
