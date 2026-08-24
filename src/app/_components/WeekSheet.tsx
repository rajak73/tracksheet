"use client";

/**
 * A week of an instructor's work, in the client's own report columns.
 *
 * ── Why the week is a sheet and not only a calendar ───────────────────────
 * `WeekGrid` answers "when did I work?" — it is a clock, and a person reading
 * their own Tuesday wants a clock. It cannot answer "how many quizzes did I
 * evaluate this week?", because a coloured block has no room for a deliverable
 * and a quantity, and those two columns are what the client's report is
 * actually made of. So the same week is offered twice, and neither view is
 * asked to be the other.
 *
 * ── Day-wise, not one flat list ───────────────────────────────────────────
 * The rows are grouped by day with a per-day subtotal, because a week's total
 * on its own hides the shape a manager and an instructor both read first:
 * which day was heavy, which day is empty. A day with nothing recorded still
 * gets its heading rather than vanishing — an absent Wednesday is information,
 * and a list that silently skips it looks like a full week.
 *
 * ── Read-only, on purpose ─────────────────────────────────────────────────
 * Correction belongs to the day view, next to the sentence that produced the
 * row and the submission it came from. Editing here would be editing a figure
 * with its context two clicks away. The day heading is the way through.
 */

import { categoryColor } from "@/app/_components/charts";
import { sumQuantities } from "@/domain/worklog-taxonomy";
import { UNSTATED } from "@/domain/worklog-report";
import {
  countsAsWorking,
  didHappen,
  formatClock,
  formatDuration,
  minutesInZone,
  type Activity,
  type WeekDay,
} from "@/app/_components/workload";

/* "Category", not "Broad Category".
 *
 * Broad Category means something specific in the client's monthly sheet: the
 * stream the INSTRUCTOR belongs to — Technical, English, Aptitude, Mathematics.
 * This column holds what a single entry was, which is a different thing
 * entirely, and two columns sharing one name across two reports is how a review
 * meeting ends up arguing about which number is which. */
const COLUMNS = [
  "Your entry",
  "Category",
  "Deliverable",
  "Deliverable Quantity",
  "Working Hours",
  "Remarks",
] as const;

/** Right-aligned: the two columns that are counted rather than read. */
const NUMERIC = new Set([3, 4]);

/* The server's own figure, computed from the two instants. Subtracting
 * minutes-past-midnight breaks on any activity that crosses midnight, which
 * this database contains. */
const hoursOf = (a: Activity, timeZone: string) =>
  a.durationHours ??
  (minutesInZone(a.endTime, timeZone) - minutesInZone(a.startTime, timeZone) + 24 * 60) %
    (24 * 60) /
    60;

export function WeekSheet({
  days,
  activitiesByDate,
  timeZone,
  onOpenDay,
}: {
  days: WeekDay[];
  activitiesByDate: Record<string, Activity[]>;
  timeZone: string;
  onOpenDay: (date: string) => void;
}) {
  const all = days.flatMap((d) => activitiesByDate[d.date] ?? []);
  /* Countable rows only, so the footer agrees with the column above it.
   *
   * `?? 1` used to sit in here and in the two places below: a row whose count
   * nobody stated was silently added as one of them. Unknown now propagates —
   * one unstated count makes the total `?`, because a partial sum of the rows
   * that happened to state a number reads exactly like a complete one. */
  const weekQuantity = sumQuantities(
    all.filter((a) => a.deliverableType?.isCountable).map((a) => a.quantity ?? null),
  );
  /* Working Hours, by the product's own rule — which is what the column above
   * this footer is called. It summed every row: an absence counted, and so did
   * a meeting, so the instructor's own week disagreed with the manager's sheet
   * and with the client's report, all three claiming the same name. The per-row
   * cells still show what each entry took; only rows that COUNT reach the
   * total, exactly as `rollUp` does it for every other sheet. */
  const weekHours = all.filter(countsAsWorking).reduce((n, a) => n + hoursOf(a, timeZone), 0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] border-collapse text-sm">
        <caption className="sr-only-text">
          Your week, day by day: what you wrote and the category, deliverable, quantity and hours it
          was recorded as.
        </caption>
        <thead>
          <tr className="border-y border-sidebar-border bg-sidebar-bg">
            {COLUMNS.map((label, i) => (
              <th
                key={label}
                scope="col"
                className={`px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-sidebar-text-muted ${
                  NUMERIC.has(i) ? "text-right" : "text-left"
                }`}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>

        {days.map((day) => {
          const rows = [...(activitiesByDate[day.date] ?? [])].sort((a, b) =>
            a.startTime.localeCompare(b.startTime),
          );
          const dayQuantity = sumQuantities(
            rows.filter((a) => a.deliverableType?.isCountable).map((a) => a.quantity ?? null),
          );
          const dayHours = rows.filter(countsAsWorking).reduce((n, a) => n + hoursOf(a, timeZone), 0);

          return (
            <tbody key={day.date} className="border-t border-line">
              <tr className={day.isToday ? "bg-primary-subtle" : "bg-sunken/60"}>
                <th scope="colgroup" colSpan={3} className="px-3 py-2 text-left">
                  <button
                    type="button"
                    onClick={() => onOpenDay(day.date)}
                    className="text-sm font-semibold text-content underline-offset-2 hover:underline"
                    aria-label={`Open ${day.label} ${day.dayNumber} in day view`}
                  >
                    <span className="tabular">{day.dayNumber}</span> {day.label}
                    {day.isToday ? <span className="ml-2 text-xs text-primary-text">Today</span> : null}
                  </button>
                </th>
                {/* The day's subtotals sit under the columns they subtotal, so
                    a day, a week and the report all add up in the same place. */}
                <td className="tabular px-3 py-2 text-right text-sm font-semibold text-content">
                  {rows.length > 0 ? dayQuantity : ""}
                </td>
                <td className="tabular px-3 py-2 text-right text-sm font-semibold text-content">
                  {rows.length > 0 ? formatDuration(dayHours) : ""}
                </td>
                <td className="px-3 py-2 text-right text-xs text-muted">
                  {rows.length > 0
                    ? `${rows.length} ${rows.length === 1 ? "entry" : "entries"}`
                    : ""}
                </td>
              </tr>

              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-3 text-sm text-subtle">
                    No workload recorded
                  </td>
                </tr>
              ) : (
                rows.map((a) => (
                  <tr key={a.id} className="border-t border-line-subtle align-top">
                    <td className="max-w-[22rem] px-3 py-2.5 text-content">
                      {/* What they typed, when it came from a worklog. A row a
                          manager entered by hand has no sentence, and its clock
                          range is the honest stand-in. */}
                      {a.rawText ?? (
                        <span className="tabular text-muted">
                          {formatClock(minutesInZone(a.startTime, timeZone))} –{" "}
                          {formatClock(minutesInZone(a.endTime, timeZone))}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-1.5 text-content">
                        <span
                          aria-hidden
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ background: categoryColor(a.activityType.code) }}
                        />
                        {a.activityType.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-content">
                      {a.deliverableType?.label ?? <span className="text-subtle">—</span>}
                    </td>
                    <td className="tabular px-3 py-2.5 text-right text-content">
                      {/* Preparation, meetings, reporting and admin have hours
                          but no unit — a dash rather than a 1 that means
                          nothing. */}
                      {a.deliverableType?.isCountable ? (
                        (a.quantity ?? UNSTATED)
                      ) : (
                        <span className="text-subtle">—</span>
                      )}
                    </td>
                    {/* An absence has no hours to report, and a row that is
                        not student-facing has hours that do not count — muted
                        with the same wording the monthly sheet uses, so the two
                        explain themselves the same way. Both were rendered as
                        plain durations here, indistinguishable from taught
                        time. */}
                    <td className="tabular px-3 py-2.5 text-right text-content">
                      {!didHappen(a) ? (
                        <span className="text-subtle" title="This did not happen, so it is not counted">
                          {a.status === "EXCUSED" ? "Excused" : "Missed"}
                        </span>
                      ) : countsAsWorking(a) ? (
                        formatDuration(hoursOf(a, timeZone))
                      ) : (
                        <span className="text-muted" title="Not counted in Working Hours">
                          {formatDuration(hoursOf(a, timeZone))}
                        </span>
                      )}
                    </td>
                    <td className="max-w-[16rem] px-3 py-2.5 text-muted">
                      {a.remarks ?? <span className="text-subtle">—</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          );
        })}

        <tfoot>
          <tr className="border-t-2 border-line bg-sunken">
            <th
              scope="row"
              colSpan={3}
              className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted"
            >
              Week total
            </th>
            <td className="tabular px-3 py-2.5 text-right text-sm font-semibold text-content">
              {weekQuantity}
            </td>
            <td className="tabular px-3 py-2.5 text-right text-sm font-semibold text-content">
              {formatDuration(weekHours)}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
