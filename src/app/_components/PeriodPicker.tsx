"use client";

/**
 * One control for choosing what you are looking at.
 *
 * ── A bar, with the calendar behind it ────────────────────────────────────
 * The grid used to sit open on the page. It is the biggest thing on the screen
 * and it is used for a few seconds a day — every other minute it was pushing
 * the actual work below the fold. So the bar states the period and the picker
 * opens over the page when somebody wants to jump somewhere.
 *
 * ── The arrows move the SELECTION, the popover jumps ──────────────────────
 * With the calendar hidden, stepping is what people reach for most: the arrows
 * move a day, a week or a month depending on the view. The popover is for
 * "take me to the 4th", which is the rarer, deliberate act.
 *
 * ── What you pick looks like what you are picking ─────────────────────────
 * Days are a calendar, weeks are the weeks of a month, months are the months
 * of a year. Same control, same place, three shapes — nobody has to learn a
 * second way to navigate when they switch view.
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "@/app/_components/ui";
import { IconCalendar, IconChevronDown } from "@/app/_components/icons";
import { formatDayAs } from "@/app/_lib/format";

export type View = "day" | "week" | "month";

const VIEWS: Array<[View, string]> = [
  ["day", "Day"],
  ["week", "Week"],
  ["month", "Month"],
];

/* ── Hover has to be SEEN, not merely present ─────────────────────────────
 * These cells used `bg-hovered`, which is #f1f5f9 against a #ffffff panel —
 * a change of about two percent lightness, technically applied and visually
 * absent. A picker whose cells give no feedback reads as a picture of a
 * calendar rather than a control.
 *
 * They now take the product's own selection tint, so hovering says "this is
 * the thing you are about to choose" in the same colour that choosing it will
 * use. */
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  return addDays(iso, -((d.getUTCDay() + 6) % 7));
}

const parts = (iso: string) => {
  const d = new Date(`${iso}T00:00:00.000Z`);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
};

const isoOf = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);

function weeksOfMonth(iso: string): Array<{ from: string; to: string }> {
  const { year, month } = parts(iso);
  const last = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
  const weeks: Array<{ from: string; to: string }> = [];
  for (let start = mondayOf(isoOf(year, month, 1)); start <= last; start = addDays(start, 7)) {
    weeks.push({ from: start, to: addDays(start, 6) });
  }
  return weeks;
}

/** What the bar says it is showing. */
function label(view: View, selected: string): string {
  if (view === "day") {
    return formatDayAs(selected, { weekday: "short", day: "numeric", month: "long", year: "numeric" });
  }
  if (view === "week") {
    const from = mondayOf(selected);
    const to = addDays(from, 6);
    const short = (iso: string) => formatDayAs(iso, { day: "numeric", month: "short" });
    return `${short(from)} – ${short(to)}`;
  }
  return formatDayAs(selected, { month: "long", year: "numeric" });
}

export function PeriodPicker({
  view,
  onView,
  selected,
  onSelect,
  today,
}: {
  view: View;
  onView: (next: View) => void;
  /** The selected day. Week and Month are derived from it. */
  selected: string;
  onSelect: (date: string) => void;
  today: string | null;
}) {
  const [open, setOpen] = useState(false);
  /* The month the POPOVER is looking at, which is not the selection: paging to
   * December to see what is there should not move the day you are reading. */
  const [browsing, setBrowsing] = useState(selected);
  const box = useRef<HTMLDivElement>(null);

  // Opening always starts from where the selection actually is.
  const openPicker = () => {
    setBrowsing(selected);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const choose = (date: string) => {
    onSelect(date);
    setOpen(false);
  };

  /* Stepping moves one of whatever is being viewed. */
  const step = (direction: 1 | -1) => {
    if (view === "day") return onSelect(addDays(selected, direction));
    if (view === "week") return onSelect(addDays(mondayOf(selected), direction * 7));
    const d = new Date(`${selected}T00:00:00.000Z`);
    d.setUTCMonth(d.getUTCMonth() + direction, 1);
    onSelect(d.toISOString().slice(0, 10));
  };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 shadow-card">
      <div className="flex items-center gap-1 rounded-control border border-line p-0.5">
        {VIEWS.map(([id, name]) => (
          <button
            key={id}
            type="button"
            onClick={() => onView(id)}
            aria-pressed={view === id}
            className={`rounded-[0.4rem] px-3 py-1.5 text-sm font-medium transition ${
              view === id ? "bg-primary text-white" : "text-muted hover:bg-hovered hover:text-content"
            }`}
          >
            {name}
          </button>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Button size="sm" variant="ghost" aria-label={`Previous ${view}`} onClick={() => step(-1)}>
          ←
        </Button>

        <div ref={box} className="relative">
          <button
            type="button"
            onClick={() => (open ? setOpen(false) : openPicker())}
            aria-haspopup="dialog"
            aria-expanded={open}
            className="flex items-center gap-2 rounded-control border border-line px-3 py-1.5 text-sm font-semibold text-content transition hover:border-line-strong hover:bg-hovered"
          >
            <IconCalendar size={16} className="text-muted" />
            {label(view, selected)}
            <IconChevronDown
              size={16}
              className={`text-muted transition-transform ${open ? "rotate-180" : ""}`}
            />
          </button>

          {open ? (
            <>
              {/* Clicking anywhere else closes it, without a library. */}
              <button
                aria-hidden
                tabIndex={-1}
                onClick={() => setOpen(false)}
                className="fixed inset-0 z-30 cursor-default"
              />
              <div
                role="dialog"
                aria-label="Choose a period"
                className="absolute right-0 z-40 mt-2 w-[22rem] rounded-card border border-line bg-surface p-3 shadow-raised"
              >
                <Panel
                  view={view}
                  browsing={browsing}
                  setBrowsing={setBrowsing}
                  selected={selected}
                  today={today}
                  onChoose={choose}
                />
              </div>
            </>
          ) : null}
        </div>

        <Button size="sm" variant="ghost" aria-label={`Next ${view}`} onClick={() => step(1)}>
          →
        </Button>

        <Button size="sm" variant="secondary" disabled={!today} onClick={() => today && choose(today)}>
          Today
        </Button>
      </div>
    </div>
  );
}

/* ── Inside the popover ───────────────────────────────────────────────────── */

function Panel({
  view,
  browsing,
  setBrowsing,
  selected,
  today,
  onChoose,
}: {
  view: View;
  browsing: string;
  setBrowsing: (iso: string) => void;
  selected: string;
  today: string | null;
  onChoose: (iso: string) => void;
}) {
  const { year, month } = parts(browsing);

  const page = (direction: 1 | -1) => {
    const d = new Date(`${browsing}T00:00:00.000Z`);
    if (view === "month") d.setUTCFullYear(d.getUTCFullYear() + direction);
    else d.setUTCMonth(d.getUTCMonth() + direction, 1);
    setBrowsing(d.toISOString().slice(0, 10));
  };

  const heading =
    view === "month" ? String(year) : formatDayAs(isoOf(year, month, 1), { month: "long", year: "numeric" });

  return (
    <>
      <div className="mb-2 flex items-center justify-between">
        <Button size="sm" variant="ghost" aria-label="Previous" onClick={() => page(-1)}>
          ←
        </Button>
        <span className="text-sm font-semibold text-content">{heading}</span>
        <Button size="sm" variant="ghost" aria-label="Next" onClick={() => page(1)}>
          →
        </Button>
      </div>

      {view === "day" ? (
        <DayGrid year={year} month={month} selected={selected} today={today} onChoose={onChoose} />
      ) : view === "week" ? (
        <WeekList browsing={browsing} selected={selected} today={today} onChoose={onChoose} />
      ) : (
        <MonthGrid year={year} selected={selected} today={today} onChoose={onChoose} />
      )}
    </>
  );
}

function DayGrid({
  year,
  month,
  selected,
  today,
  onChoose,
}: {
  year: number;
  month: number;
  selected: string;
  today: string | null;
  onChoose: (iso: string) => void;
}) {
  const first = isoOf(year, month, 1);
  // Monday-based, matching the week the rest of the product uses.
  const lead = (new Date(`${first}T00:00:00.000Z`).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  return (
    <div>
      <div className="grid grid-cols-7 gap-0.5">
        {WEEKDAYS.map((w) => (
          <span key={w} className="py-1 text-center text-[11px] font-medium text-subtle">
            {w}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {Array.from({ length: lead }, (_, i) => (
          <span key={`lead-${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const date = isoOf(year, month, i + 1);
          const isSelected = date === selected;
          const isToday = date === today;
          const weekend = (lead + i) % 7 >= 5;

          return (
            <button
              key={date}
              type="button"
              onClick={() => onChoose(date)}
              aria-current={isSelected ? "date" : undefined}
              className={`tabular cursor-pointer rounded-control border py-1.5 text-sm transition-colors ${
                isSelected
                  ? "border-primary bg-primary font-semibold text-white hover:bg-primary-hover"
                  : isToday
                    ? "border-primary bg-primary-subtle font-semibold text-primary-text hover:bg-primary-subtle/70"
                    : `border-transparent hover:border-primary hover:bg-primary-subtle hover:text-primary-text ${
                        weekend ? "text-danger-text" : "text-content"
                      }`
              }`}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WeekList({
  browsing,
  selected,
  today,
  onChoose,
}: {
  browsing: string;
  selected: string;
  today: string | null;
  onChoose: (iso: string) => void;
}) {
  const weeks = weeksOfMonth(browsing);
  const current = mondayOf(selected);
  const short = (iso: string) => formatDayAs(iso, { day: "numeric", month: "short" });

  return (
    <ul className="space-y-0.5">
      {weeks.map((week, i) => {
        const isSelected = week.from === current;
        const hasToday = Boolean(today && today >= week.from && today <= week.to);

        return (
          <li key={week.from}>
            <button
              type="button"
              onClick={() => onChoose(week.from)}
              aria-current={isSelected ? "true" : undefined}
              className={`flex w-full cursor-pointer items-baseline justify-between gap-3 rounded-control border px-3 py-2 text-left transition-colors ${
                isSelected
                  ? "border-primary bg-primary text-white hover:bg-primary-hover"
                  : hasToday
                    ? "border-primary bg-primary-subtle text-primary-text hover:bg-primary-subtle/70"
                    : "border-transparent text-content hover:border-primary hover:bg-primary-subtle hover:text-primary-text"
              }`}
            >
              <span className="text-sm font-medium">Week {i + 1}</span>
              <span className={`tabular text-xs ${isSelected ? "text-white/80" : "text-muted"}`}>
                {short(week.from)} – {short(week.to)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function MonthGrid({
  year,
  selected,
  today,
  onChoose,
}: {
  year: number;
  selected: string;
  today: string | null;
  onChoose: (iso: string) => void;
}) {
  const chosen = parts(selected);
  const now = today ? parts(today) : null;

  return (
    <div className="grid grid-cols-3 gap-1">
      {MONTHS.map((name, i) => {
        const isSelected = chosen.year === year && chosen.month === i;
        const isNow = now?.year === year && now?.month === i;

        return (
          <button
            key={name}
            type="button"
            onClick={() => onChoose(isoOf(year, i, 1))}
            aria-current={isSelected ? "true" : undefined}
            className={`cursor-pointer rounded-control border py-2 text-sm font-medium transition-colors ${
              isSelected
                ? "border-primary bg-primary text-white hover:bg-primary-hover"
                : isNow
                  ? "border-primary bg-primary-subtle text-primary-text hover:bg-primary-subtle/70"
                  : "border-transparent text-content hover:border-primary hover:bg-primary-subtle hover:text-primary-text"
            }`}
          >
            {name}
          </button>
        );
      })}
    </div>
  );
}
