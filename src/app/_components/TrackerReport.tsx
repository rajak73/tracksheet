"use client";

/**
 * The tracker screen: period controls, headline figures, and the grid.
 *
 * One component serves all three roles. The API narrows by scope — an
 * instructor's `self` scope returns only their own row — so "My Report", the
 * manager's team view and the admin's university view are the same screen with
 * different data, and cannot drift apart into three implementations.
 *
 * ── Period model ───────────────────────────────────────────────────────────
 * The client's workflow is month-then-week, so that is what the controls
 * prioritise. The default is deliberately the CURRENT WEEK rather than a
 * historical range: the question people open this screen to answer is "how is
 * this week going", and defaulting to an arbitrary past period answers a
 * question nobody asked.
 */

import { useCallback, useMemo, useState } from "react";
import { useUniversityToday } from "@/app/_lib/zone";
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  ErrorState,
  Field,
  Select,
  StatTile,
  TableSkeleton,
  inputClass,
} from "@/app/_components/ui";
import { TrackerGrid, type Tracker } from "@/app/_components/TrackerGrid";
import { apiGet, useLoad } from "@/app/_lib/api";
import { formatDate, formatHours } from "@/app/_lib/format";

/**
 * The four reporting periods the client works in. `currentMonth` and `month`
 * both resolve to a `?month=` query — the difference is only whether the user
 * picks it or the app does — but they are separate modes because "this month"
 * must keep meaning this month when the page is left open across a month
 * boundary, rather than freezing whatever was selected on load.
 */
type Mode = "week" | "currentMonth" | "month" | "custom";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** What the currently selected period is called, for the heading above the grid. */
const PERIOD_LABEL: Record<Mode, string> = {
  week: "Current Week",
  currentMonth: "Current Month",
  month: "Selected Month",
  custom: "Custom Date Range",
};

/** A small window of years around today — enough to report on, not a scroll of 50. */
function yearOptions(): number[] {
  const current = new Date().getUTCFullYear();
  return [current + 1, current, current - 1, current - 2];
}

export function TrackerReport({
  universityId,
  /** Narrows the grid to one person, authorised server-side. */
  instructorId,
  /** Narrows the grid to one manager's roster, authorised server-side. */
  managerId,
  /** Shown above the grid; the caller knows whether this is a team or a person. */
  emptyHint,
}: {
  universityId: string;
  instructorId?: string;
  managerId?: string;
  emptyHint?: string;
}) {
  /* The UNIVERSITY's today. This seeds the year, the month and the date
   * filters, so a browser a day out opens the report on the wrong month at the
   * turn of one. See `useUniversityToday`. */
  const today = useUniversityToday();
  const [mode, setMode] = useState<Mode>("week");
  const [year, setYear] = useState(() => Number(today.slice(0, 4)));
  const [month, setMonth] = useState(() => Number(today.slice(5, 7)));
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    // Read from `today` rather than from state, so this stays correct even if
    // the month turns over while the page is open.
    if (mode === "currentMonth") params.set("month", today.slice(0, 7));
    if (mode === "month") params.set("month", `${year}-${String(month).padStart(2, "0")}`);
    if (mode === "custom") {
      params.set("from", from);
      params.set("to", to);
    }
    // Absent period means the current week, resolved in the tenant's timezone.
    if (instructorId) params.set("instructorId", instructorId);
    if (managerId) params.set("managerId", managerId);
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }, [mode, year, month, from, to, instructorId, managerId, today]);

  const load = useCallback(
    () =>
      apiGet<{ tracker: Tracker }>(
        `/api/universities/${universityId}/tracker${query}`,
        "Could not load the workload report.",
      ).then((body) => body.tracker),
    [universityId, query],
  );

  const { data, error, loading, reload } = useLoad(load, `tracker:${universityId}:${query}`);

  // The export must cover exactly the period on screen, so it reuses the same
  // query string rather than rebuilding one that could drift out of step.
  const exportHref = `/api/universities/${universityId}/tracker${
    query ? `${query}&` : "?"
  }export=csv`;

  const controls = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["week", "Current Week"],
            ["currentMonth", "Current Month"],
            ["month", "Custom Month"],
            ["custom", "Custom Date Range"],
          ] as Array<[Mode, string]>
        ).map(([value, label]) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={mode === value ? "primary" : "secondary"}
            onClick={() => setMode(value)}
          >
            {label}
          </Button>
        ))}
        <ButtonLink external href={exportHref} variant="secondary" size="sm" className="ml-auto">
          Export CSV
        </ButtonLink>
      </div>

      {mode === "month" ? (
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Year" className="w-full sm:w-auto">
            <Select
              value={String(year)}
              onChange={(e) => setYear(Number(e.target.value))}
              className="w-full min-w-0 sm:w-auto sm:min-w-32"
            >
              {yearOptions().map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Month" className="w-full sm:w-auto">
            <Select
              value={String(month)}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="w-full min-w-0 sm:w-auto sm:min-w-40"
            >
              {MONTHS.map((name, i) => (
                <option key={name} value={i + 1}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ) : null}

      {mode === "custom" ? (
        <div className="flex flex-wrap items-end gap-3">
          <Field label="From" className="w-full sm:w-auto">
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="To" className="w-full sm:w-auto">
            <input
              type="date"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-5">
      <Card>
        <div className="p-5">{controls}</div>
      </Card>

      {loading ? (
        <TableSkeleton cols={5} />
      ) : error ? (
        <ErrorState message="Unable to load the report" detail={error} onRetry={reload} />
      ) : !data ? null : (
        <>
          {/* ── What this row reports, and what it stopped reporting ────────
              Utilization is gone. Recorded minutes over configured capacity
              said nothing about students — a day of back-to-back internal
              meetings scored exactly like a day of lectures — and it ran past
              100% routinely enough that the percentage taught the reader to
              ignore it.

              The deliverable-hours tile went with it, because the label
              covered two different figures. Here it meant hours on entries
              carrying any named deliverable; on the roster screens it meant
              hours whose category was literally "Deliverable Work". Same
              underlying data, answers an order of magnitude apart, one name.

              What remains is named for what it actually holds. The tracker's
              hours come from the engine, which counts preparation, meetings
              and admin exactly like teaching, so this tile says "Recorded
              hours" — not "Working Hours", which counts only student-facing
              time and is the smaller figure the grid below totals out of the
              same response. Quantity stays: a count of deliverables completed
              is its own question, not an hours figure wearing a misleading
              name. */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            <StatTile label="Instructors" value={data.totals.instructors} emphasis />
            <StatTile label="Recorded hours" value={formatHours(data.totals.totalWorkingHours)} />
            <StatTile label="Deliverable quantity" value={data.totals.quantity} />
          </div>

          {/* Both figures are on THIS screen — this tile above, the grid's
              Working Hours column below — and the tile is the larger of the
              two, so a reader who conflates them overstates teaching load.
              The difference is therefore stated once, plainly, between them
              rather than left to a tooltip. It must not send the reader off to
              some other page: the smaller figure is a scroll away, not a
              screen away. */}
          <Alert tone="info" title="Recorded hours is not Working Hours">
            <strong>Recorded hours</strong> is every minute logged in this period — preparation,
            meetings, reporting and admin included. <strong>Working Hours</strong>, the column in
            the grid below, counts only time spent with students, so it is the smaller figure.
            They answer different questions and are never added together.
          </Alert>

          {data.totals.formerInstructors > 0 ? (
            <Alert tone="warning" title="Includes former staff">
              {data.totals.formerInstructors} instructor
              {data.totals.formerInstructors === 1 ? "" : "s"} in this period no longer
              {data.totals.formerInstructors === 1 ? "s" : ""} hold an active account. They are
              shown because they recorded work in this window; historical reports must not lose
              them.
            </Alert>
          ) : null}

          {/* The period, stated plainly. The grid below repeats each week's own
              dates, but the reader needs to know what window they are looking
              at before they start scrolling it. */}
          <div>
            <p className="text-sm font-semibold text-content">{PERIOD_LABEL[mode]}</p>
            <p className="tabular mt-0.5 text-sm text-muted">
              {formatDate(data.from)} – {formatDate(data.to)} · {data.weeks.length} week
              {data.weeks.length === 1 ? "" : "s"} · times in {data.timezone}
            </p>
            {emptyHint && data.rows.length === 0 ? (
              <p className="mt-1 text-sm text-subtle">{emptyHint}</p>
            ) : null}
          </div>

          {/* The per-category split is only legible on a one-person report;
              on a team grid it repeats for every row. */}
          <TrackerGrid tracker={data} showBreakdown={Boolean(instructorId)} />
        </>
      )}
    </div>
  );
}
