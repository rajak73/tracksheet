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
import { formatDate, formatHours, formatPct, todayISO } from "@/app/_lib/format";

type Mode = "week" | "month" | "custom";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** A small window of years around today — enough to report on, not a scroll of 50. */
function yearOptions(): number[] {
  const current = new Date().getUTCFullYear();
  return [current + 1, current, current - 1, current - 2];
}

export function TrackerReport({
  universityId,
  /** Narrows the grid to one person, authorised server-side. */
  instructorId,
  /** Shown above the grid; the caller knows whether this is a team or a person. */
  emptyHint,
}: {
  universityId: string;
  instructorId?: string;
  emptyHint?: string;
}) {
  const today = todayISO();
  const [mode, setMode] = useState<Mode>("week");
  const [year, setYear] = useState(() => Number(today.slice(0, 4)));
  const [month, setMonth] = useState(() => Number(today.slice(5, 7)));
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (mode === "month") params.set("month", `${year}-${String(month).padStart(2, "0")}`);
    if (mode === "custom") {
      params.set("from", from);
      params.set("to", to);
    }
    // Absent period means the current week, resolved in the tenant's timezone.
    if (instructorId) params.set("instructorId", instructorId);
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }, [mode, year, month, from, to, instructorId]);

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
            ["week", "Current week"],
            ["month", "Monthly"],
            ["custom", "Custom period"],
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
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <StatTile label="Instructors" value={data.totals.instructors} emphasis />
            <StatTile
              label="Total working hours"
              value={formatHours(data.totals.totalWorkingHours)}
            />
            <StatTile
              label="Deliverable hours"
              value={formatHours(data.totals.deliverableHours)}
            />
            <StatTile label="Deliverable quantity" value={data.totals.quantity} />
            <StatTile label="Utilization" value={formatPct(data.totals.utilizationPct)} />
          </div>

          {/* The distinction is easy to misread, so it is stated once, plainly,
              above the grid rather than left to a tooltip. */}
          <Alert tone="info" title="Two hour figures, deliberately kept apart">
            <strong>Total working hours</strong> is recorded activity — the same figure the
            dashboards and utilization use. <strong>Deliverable hours</strong> is time booked
            against a named deliverable. They measure different things and are never added
            together; only total working hours affects utilization.
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

          <p className="text-sm text-muted">
            {formatDate(data.from)} to {formatDate(data.to)} · {data.weeks.length} week
            {data.weeks.length === 1 ? "" : "s"} · times in {data.timezone}
            {emptyHint && data.rows.length === 0 ? ` · ${emptyHint}` : ""}
          </p>

          {/* The per-category split is only legible on a one-person report;
              on a team grid it repeats for every row. */}
          <TrackerGrid tracker={data} showBreakdown={Boolean(instructorId)} />
        </>
      )}
    </div>
  );
}
