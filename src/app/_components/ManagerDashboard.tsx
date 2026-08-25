"use client";

/**
 * The pieces of the manager's dashboard.
 *
 * ── Why these live apart from the page ────────────────────────────────────
 * The page is arrangement and data fetching; these are the four shapes that
 * arrangement is made of. Keeping them here means the day timeline can be read
 * on its own — it is the piece most likely to be wanted somewhere else — and
 * the page file stays short enough to see the layout in.
 *
 * ── Every figure is passed in, none is computed twice ─────────────────────
 * Not one of these components adds hours up. They render what the endpoints
 * already derived from `computeAnalytics`, because a total computed in a chart
 * and the same total computed in a table are two numbers that will eventually
 * disagree.
 */

import type { ReactNode } from "react";
import { categoryColor } from "@/app/_components/charts";
import { Badge, Button } from "@/app/_components/ui";
import { Avatar } from "@/app/_components/AccountDialogs";
import { rollUp } from "@/domain/rollup";
import { IconArrowDown, IconArrowUp } from "@/app/_components/icons";
import { formatDuration, minutesInZone, type Activity } from "@/app/_components/workload";
import { formatDayShort } from "@/app/_lib/format";

/* ── The four figures a manager opens the page for ────────────────────────── */

export function KpiCard({
  label,
  value,
  icon,
  tint,
  footnote,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  /** Which of the four this is, for the icon chip only — never the figure. */
  tint: "blue" | "green" | "amber" | "violet";
  footnote?: ReactNode;
}) {
  // The colour lives on the icon and nowhere else. Tinting the number would
  // make "132h 45m" look like a judgement about 132h 45m, which it is not.
  const chip = {
    blue: "bg-primary-subtle text-primary-text",
    green: "bg-success-subtle text-success-text",
    amber: "bg-warning-subtle text-warning-text",
    violet: "bg-info-subtle text-info-text",
  }[tint];

  return (
    <div className="flex items-start gap-4 rounded-card border border-line bg-surface p-5 shadow-card">
      <span className={`flex size-11 shrink-0 items-center justify-center rounded-card ${chip}`}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium uppercase tracking-wide text-muted">
          {label}
        </span>
        <span className="tabular mt-1 block text-2xl font-semibold text-content">{value}</span>
        {footnote ? <span className="mt-1 block text-xs text-muted">{footnote}</span> : null}
      </span>
    </div>
  );
}

/** "↑ 6.4% vs yesterday", or an honest silence when there is nothing to compare. */
export function Change({ pct, direction }: { pct: number | null; direction: string }) {
  // A change against a day with no hours is not "+100%", it is unmeasurable —
  // and a made-up arrow on a dashboard is exactly the kind of number people
  // repeat in meetings.
  if (pct === null) return <span className="text-subtle">No comparison for yesterday</span>;

  const up = direction === "UP";
  const tone = up ? "text-success-text" : direction === "DOWN" ? "text-danger-text" : "text-muted";
  const Arrow = up ? IconArrowUp : IconArrowDown;

  return (
    <span className={`inline-flex items-center gap-1 ${tone}`}>
      {direction === "FLAT" ? null : <Arrow size={16} />}
      <span className="tabular">{Math.abs(pct)}%</span>
      <span className="text-muted">vs yesterday</span>
    </span>
  );
}

/* ── One instructor's day, drawn on a clock ───────────────────────────────── */

export type DayInstructor = {
  instructorId: string;
  name: string;
  avatarUrl: string | null;
  employeeCode: string | null;
  totalHours: number;
  activityCount: number;
  status: "complete" | "partial" | "missing" | "off";
  activities: Activity[];
};

const STATUS_BADGE: Record<DayInstructor["status"], { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  complete: { label: "Completed", tone: "success" },
  partial: { label: "Partial", tone: "warning" },
  missing: { label: "Missing", tone: "danger" },
  off: { label: "Not a working day", tone: "neutral" },
};

/**
 * The roster's day, as a table.
 *
 * ── Why a table and not a card each ───────────────────────────────────────
 * This was a card per instructor with the day drawn to scale beside it, and
 * proportional blocks meant every card scrolled sideways on its own. Reading
 * "who is light today" then took sixteen separate scrolls, and comparing two
 * people meant holding one card's afternoon in your head while you dragged
 * another's into view. A table answers the same question by running the eye
 * down one column, which is how the client reads their own sheet.
 *
 * The width is what was lost and it is not much: the blocks were proportional
 * to duration, but every one of them also carried its length in words, so the
 * scale was decoration over a figure already written down.
 *
 * ── Same treatment as `RosterGrid` ────────────────────────────────────────
 * Same rules, same sticky header, same bounded scroll box, so switching Day →
 * Week does not change what kind of thing you are looking at. It also shows the
 * WHOLE roster like those two do — the "view more" that used to sit under the
 * cards existed because cards are tall, and a scroll box has replaced it.
 *
 * ── Working Hours is every hour recorded ──────────────────────────────
 * The same rule the sheets use, from the same `rollUp`: classes and labs and
 * mentoring, and equally preparation, meetings and admin. The client defines an
 * instructor's working time as what they wrote down. Taking it from `rollUp`
 * rather than adding it up here is what keeps a manager comparing two people on
 * the same figure they see everywhere else.
 */
export function DayTable({
  rows,
  timeZone,
  onRemind,
  reminding,
}: {
  rows: DayInstructor[];
  timeZone: string;
  onRemind?: (instructorId: string) => void;
  /** The instructor a reminder is currently being sent to, if any. */
  reminding?: string | null;
}) {
  /* Matches `COLUMN_RULE` in `ui/tables.tsx` and `RosterGrid` below. Both
     tables are hand-built rather than assembled from those primitives, so the
     rule is repeated — `last:border-r-0` keeps the final column off the card's
     own edge. */
  const rule = "border-r border-line last:border-r-0";
  const head =
    `${rule} sticky top-0 z-10 border-b border-line bg-primary-subtle ` +
    "px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-primary-text";
  /* Row dividers sit on the CELLS, not the row: `border-separate` is what makes
     the header stick — a collapsed table drops `position: sticky` on its cells
     — and under that model a `<tr>`'s own border stops painting. `align-top`
     because a row is as tall as its longest day. */
  const cell = `${rule} border-b border-line-subtle px-3 py-2.5 align-top`;

  return (
    <div className="max-h-[60vh] overflow-auto">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <caption className="sr-only-text">
          Every instructor on your roster, with what they recorded on this day.
        </caption>
        <thead>
          <tr>
            <th scope="col" className={`${head} text-left`}>
              Instructor
            </th>
            <th scope="col" className={`${head} text-left`}>
              Recorded work
            </th>
            <th scope="col" className={`${head} text-right`}>
              Working Hours
            </th>
            <th scope="col" className={`${head} text-right`}>
              Activities
            </th>
            <th scope="col" className={`${head} text-left`}>
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const badge = STATUS_BADGE[row.status];
            /* Laid out by the same function the timeline used, then stripped of
               its gaps. That is what keeps a length-only entry reading as a
               length here too — see `when` below. */
            const blocks = layOutDay(row.activities, timeZone).filter(
              (segment): segment is Extract<Segment, { kind: "block" }> =>
                segment.kind === "block",
            );
            const { hours } = rollUp(row.activities);

            return (
              <tr key={row.instructorId} className="transition-colors hover:bg-hovered">
                <th scope="row" className={`${cell} w-[15rem] text-left font-normal`}>
                  <span className="flex items-center gap-2">
                    <Avatar name={row.name} avatarUrl={row.avatarUrl} size={28} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-content">{row.name}</span>
                      {row.employeeCode ? (
                        <span className="tabular block truncate text-xs text-muted">
                          {row.employeeCode}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </th>

                <td className={cell}>
                  {blocks.length === 0 ? (
                    <span className="flex flex-wrap items-center gap-3">
                      <span className="text-danger-text">Worklog not submitted.</span>
                      {onRemind ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={reminding === row.instructorId}
                          onClick={() => onRemind(row.instructorId)}
                        >
                          {reminding === row.instructorId ? "Sending…" : "Send reminder"}
                        </Button>
                      ) : null}
                    </span>
                  ) : (
                    <ul className="space-y-1.5">
                      {blocks.map((block) => (
                        <li key={block.key} className="flex items-start gap-2">
                          <span
                            aria-hidden
                            style={{
                              backgroundColor: categoryColor(block.activity.activityType.code),
                            }}
                            className="mt-[0.4rem] h-1.5 w-1.5 shrink-0 rounded-full"
                          />
                          {/* A fixed column for the time, so the labels line up
                              down the cell instead of stepping in and out with
                              the length of each range. */}
                          <span className="tabular w-[8.5rem] shrink-0 text-xs text-muted">
                            {when(block)}
                          </span>
                          <span className="min-w-0 text-content">{label(block.activity)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>

                <td className={`tabular ${cell} text-right font-semibold text-content`}>
                  {formatDuration(hours)}
                </td>
                <td className={`tabular ${cell} text-right text-content`}>{row.activityCount}</td>
                <td className={cell}>
                  <Badge tone={badge.tone}>{badge.label}</Badge>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * What a block says about its own time.
 *
 * A clock range ONLY when the instructor gave one. The four-field form asks for
 * a length and no clock, and `placeOnDay` lays those end to end from the start
 * of the day — so "9 AM – 12 PM" on one of those was our arithmetic presented
 * as their testimony, and a manager reading the timeline had no way to tell the
 * two apart. Where the range is ours, the length is the only thing that was
 * actually claimed, so the length is what it shows.
 *
 * The BLOCK's width is unaffected either way: it is proportional to the
 * duration, which is true in both cases. Only the label changes.
 */
function when(segment: { start: number; end: number; activity: Activity }): string {
  return segment.activity.timesStated
    ? `${clock(segment.start)} – ${clock(segment.end)}`
    : formatDuration((segment.end - segment.start) / 60);
}

type Segment =
  | { kind: "gap"; key: string; minutes: number }
  | { kind: "block"; key: string; minutes: number; start: number; end: number; activity: Activity };

/**
 * The day as an alternating run of gaps and blocks, in clock order.
 *
 * Overlaps cannot occur — the writer refuses them — but a defensive clamp keeps
 * a negative gap from inverting the layout if one ever did.
 */
function layOutDay(activities: Activity[], timeZone: string): Segment[] {
  const sorted = [...activities].sort((a, b) => a.startTime.localeCompare(b.startTime));
  const segments: Segment[] = [];
  let cursor: number | null = null;

  for (const activity of sorted) {
    const start = minutesInZone(activity.startTime, timeZone);
    const end = minutesInZone(activity.endTime, timeZone);

    if (cursor !== null && start > cursor) {
      segments.push({ kind: "gap", key: `gap-${activity.id}`, minutes: start - cursor });
    }
    segments.push({
      kind: "block",
      key: activity.id,
      // Wrapped for an activity that crosses midnight, where a plain
      // subtraction of clock positions goes negative and inverts the block.
      minutes: Math.max(((end - start + 24 * 60) % (24 * 60)) || 1, 1),
      start,
      end,
      activity,
    });
    cursor = Math.max(cursor ?? end, end);
  }

  return segments;
}

/**
 * What the block says the person was doing.
 *
 * The most specific thing the row can support, always as "what : which":
 *
 *     Lecture: Data Structures      deliverable, then the instructor's remark
 *     Practical / Lab: Lab Session  category, then the deliverable
 *     Research                      category alone, when the row has no more
 *
 * A block that reads only "Teaching" tells a manager nothing the colour did not
 * already tell them; the point of the line is the half after the colon.
 */
function label(a: Activity): string {
  const deliverable = a.deliverableType?.label ?? null;
  const category = a.activityType.label;

  if (a.remarks) return `${deliverable ?? category}: ${a.remarks}`;
  if (deliverable && deliverable !== category) return `${category}: ${deliverable}`;
  return category;
}

function clock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h >= 12 ? "PM" : "AM";
  const display = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${display} ${suffix}` : `${display}:${String(m).padStart(2, "0")} ${suffix}`;
}

/* ── The month, week by week ──────────────────────────────────────────────── */

export type WeekBar = {
  from: string;
  to: string;
  hours: number;
  future: boolean;
  current: boolean;
};

export function WeekBars({ weeks }: { weeks: WeekBar[] }) {
  // Bars are scaled to the busiest week rather than to a fixed ceiling: the
  // question a manager asks here is which week was heavier, and a bar scaled to
  // an invented maximum answers a question nobody asked.
  const peak = Math.max(...weeks.map((w) => w.hours), 1);

  return (
    <ul className="space-y-3">
      {weeks.map((week, i) => (
        <li
          key={week.from}
          className="-mx-2 flex items-center gap-3 rounded-control px-2 py-1 transition-colors hover:bg-hovered"
        >
          <span className="w-40 shrink-0 text-xs text-muted">
            Week {i + 1} ({range(week.from, week.to)})
          </span>
          <span className="h-2 flex-1 overflow-hidden rounded-chip bg-sunken">
            <span
              className={`block h-full rounded-chip ${week.current ? "bg-primary" : "bg-primary/50"}`}
              style={{ width: `${(week.hours / peak) * 100}%` }}
            />
          </span>
          <span className="tabular w-20 shrink-0 text-right text-sm font-medium text-content">
            {/* A week that has not happened is not a week of zero hours. */}
            {week.future && week.hours === 0 ? (
              <span className="text-subtle">—</span>
            ) : (
              formatDuration(week.hours)
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

const range = (from: string, to: string) => `${formatDayShort(from)} – ${formatDayShort(to)}`;

/* ── Where the hours went ─────────────────────────────────────────────────── */

/** Keeps the biggest slices and sums the rest into one row. */
function foldTail(slices: Slice[]): Slice[] {
  if (slices.length <= MAX_SLICES) return slices;

  const head = slices.slice(0, MAX_SLICES - 1);
  const tail = slices.slice(MAX_SLICES - 1);

  return [
    ...head,
    {
      code: "OTHER",
      label: `${tail.length} other categories`,
      hours: Math.round(tail.reduce((n, s) => n + s.hours, 0) * 100) / 100,
      // Summed from the parts rather than recomputed, so the rows still add up
      // to what the header says even when rounding nudges a share.
      pct:
        tail.every((s) => s.pct === null)
          ? null
          : Math.round(tail.reduce((n, s) => n + (s.pct ?? 0), 0) * 10) / 10,
    },
  ];
}

export type Slice = { code: string; label: string; hours: number; pct: number | null };

/**
 * A doughnut, drawn as one circle per slice.
 *
 * Stroke offsets rather than paths: an arc path needs the large-arc flag
 * computed per slice and gets it wrong at exactly 50%, which is a bug that
 * appears only when one category dominates — the case this chart exists for.
 */
/**
 * How many hues go on screen at once.
 *
 * Thirteen categories exist; thirteen colours a person can tell apart do not.
 * Past about six slices the tail is small enough that its identity matters less
 * than the ability to read the rest, so it is folded into one honest "Other"
 * row — the hours are still counted, they are just not each given a colour that
 * would be mistaken for another one.
 */
const MAX_SLICES = 6;

export function HoursDonut({ slices, totalHours }: { slices: Slice[]; totalHours: number }) {
  const R = 54;
  const C = 2 * Math.PI * R;

  // Each slice needs where the one before it ended, so the running offsets are
  // worked out first rather than accumulated while drawing — a render that
  // mutates as it goes is a render that reads differently the second time.
  const shown = foldTail(slices);

  const arcs: Array<{ slice: Slice; dash: number; offset: number }> = [];
  let running = 0;
  for (const slice of shown) {
    const dash = (totalHours > 0 ? slice.hours / totalHours : 0) * C;
    arcs.push({ slice, dash, offset: running });
    running += dash;
  }

  // Stacked, not side by side. In the column this sits in, a row layout leaves
  // the legend about seven characters wide and `truncate` quietly removes the
  // category names — the half of the legend that says what the colours MEAN.
  return (
    <div className="flex flex-col items-center gap-5">
      <div className="relative size-40 shrink-0">
        <svg viewBox="0 0 140 140" className="size-full -rotate-90" role="img" aria-label="Hours by category">
          <circle cx="70" cy="70" r={R} fill="none" strokeWidth="16" className="stroke-sunken" />
          {arcs.map(({ slice, dash, offset }) => (
            <circle
              key={slice.code}
              cx="70"
              cy="70"
              r={R}
              fill="none"
              strokeWidth="16"
              stroke={categoryColor(slice.code)}
              strokeDasharray={`${dash} ${C - dash}`}
              strokeDashoffset={-offset}
            />
          ))}
        </svg>
        <span className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xs text-muted">Total</span>
          <span className="tabular text-lg font-semibold text-content">
            {formatDuration(totalHours)}
          </span>
        </span>
      </div>

      <ul className="w-full space-y-2">
        {shown.map((s) => (
          <li
            key={s.code}
            className="-mx-2 flex items-center gap-2 rounded-control px-2 py-1 text-sm transition-colors hover:bg-hovered"
          >
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: categoryColor(s.code) }}
            />
            <span className="min-w-0 flex-1 truncate text-muted">{s.label}</span>
            <span className="tabular shrink-0 text-content">{formatDuration(s.hours)}</span>
            <span className="tabular w-14 shrink-0 text-right text-muted">
              {s.pct === null ? "—" : `${s.pct}%`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
