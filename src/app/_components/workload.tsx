"use client";

import { formatHours } from "@/app/_lib/format";

/**
 * The instructor's workload, as a day timeline, a week grid and an editor.
 *
 * ── Every time here is the UNIVERSITY's time ───────────────────────────────
 * Not the browser's. An instructor in a Kolkata browser looking at a New-York
 * university must see New-York hours, or their 09:00 lecture appears at 18:30
 * and the day boundary lands in the wrong place. So every instant is projected
 * into the tenant's zone by {@link minutesInZone}, and the editor submits the
 * wall-clock fields the person typed for the SERVER to resolve — the browser
 * never builds an instant. That rule is the reason `logActivity` accepts a
 * `local` form at all.
 *
 * ── Colour is not decided here ────────────────────────────────────────────
 * Cards are coloured by `categoryColor()`, the fixed code→colour map the charts
 * already use, so an activity is the same colour everywhere in the product and
 * adding a category cannot recolour Teaching.
 *
 * ── The editor validates twice, and means it both times ───────────────────
 * The drawer refuses an end before a start, a zero-length entry, an overlap
 * with another row in the same draft, and an overlap with what is already
 * recorded — before it sends anything. The server then applies exactly the same
 * rules under an advisory lock. The client checks are for the person; the
 * server checks are the truth, because two tabs can each pass a client check.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  IconButton,
  Select,
  inputClass,
} from "@/app/_components/ui";
import { categoryColor, categoryLabel } from "@/app/_components/charts";

/* ── The window the timeline covers ───────────────────────────────────────── */

export const DAY_START_MIN = 8 * 60; // 08:00
export const DAY_END_MIN = 20 * 60; // 20:00
const SPAN_MIN = DAY_END_MIN - DAY_START_MIN;
/** Pixels per hour. Drives both views so a card's height means the same thing. */
const HOUR_PX = 56;

export type Activity = {
  id: string;
  workDate: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  remarks: string | null;
  /** COMPLETED / LATE / MISSED / EXCUSED. Absent on older payloads. */
  status?: string;
  activityType: { code: string; label: string };
  /* ── The client's report columns ────────────────────────────────────────
   * Optional because the same type describes rows written before deliverables
   * existed and rows a manager typed by hand, neither of which has one. A
   * sheet renders those with an em dash rather than pretending to a value.
   */
  deliverableType?: { code: string; label: string; isCountable: boolean } | null;
  /** Which subject the entry was about, as the reader judged it. */
  broadCategory?: { code: string; label: string } | null;
  quantity?: number;
  rawText?: string | null;
};

export type ActivityTypeOption = {
  code: string;
  label: string;
  isOncePerDay: boolean;
  isDerivedFromWorkingHours: boolean;
  /** The deliverables under this category, when the caller asked for them. */
  deliverables?: Array<{ code: string; label: string; isCountable: boolean }>;
};

/* ── Time, in the tenant's zone ───────────────────────────────────────────── */

/** Minutes past midnight, as the university's clock reads them. */
export function minutesInZone(iso: string, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).formatToParts(new Date(iso));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

/** `HH:MM` in the university's zone — the form's own format. */
export function hhmmInZone(iso: string, timeZone: string): string {
  return String(Math.floor(minutesInZone(iso, timeZone) / 60)).padStart(2, "0") +
    ":" +
    String(minutesInZone(iso, timeZone) % 60).padStart(2, "0");
}

export function formatClock(minutes: number): string {
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** "06h 30m" — the summary's own format, and never a bare decimal. */
/** The same thing `formatHours` writes. Kept as a name, not as a second copy. */
export const formatDuration = formatHours;

function hhmmToMinutes(value: string): number | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

/* ── One activity, positioned ─────────────────────────────────────────────── */

type Placed = { activity: Activity; startMin: number; endMin: number };

/** Projects a day's activities onto the visible window, clipped to it. */
export function placeActivities(activities: Activity[], timeZone: string): Placed[] {
  return activities
    .map((activity) => ({
      activity,
      startMin: minutesInZone(activity.startTime, timeZone),
      endMin: minutesInZone(activity.endTime, timeZone),
    }))
    // An activity ending at midnight reads as 0; treat it as the end of the day
    // rather than as a card of negative height.
    .map((p) => ({ ...p, endMin: p.endMin <= p.startMin ? DAY_END_MIN : p.endMin }))
    .sort((a, b) => a.startMin - b.startMin);
}

function geometry(p: Placed) {
  const top = ((Math.max(p.startMin, DAY_START_MIN) - DAY_START_MIN) / SPAN_MIN) * 100;
  const bottom = ((Math.min(p.endMin, DAY_END_MIN) - DAY_START_MIN) / SPAN_MIN) * 100;
  return { top: `${top}%`, height: `${Math.max(bottom - top, 2.2)}%` };
}

/** The hour rules behind both views. */
function HourGrid({ compact = false }: { compact?: boolean }) {
  const hours = [];
  for (let m = DAY_START_MIN; m <= DAY_END_MIN; m += 60) hours.push(m);
  return (
    <>
      {hours.map((m) => (
        <div
          key={m}
          className="absolute inset-x-0 border-t border-line-subtle"
          style={{ top: `${((m - DAY_START_MIN) / SPAN_MIN) * 100}%` }}
          aria-hidden
        >
          {compact ? null : null}
        </div>
      ))}
    </>
  );
}

/** The 8AM-8PM axis, rendered once beside a timeline. */
function HourAxis() {
  const hours = [];
  for (let m = DAY_START_MIN; m <= DAY_END_MIN; m += 60) hours.push(m);
  return (
    <div className="relative w-16 shrink-0" style={{ height: (SPAN_MIN / 60) * HOUR_PX }}>
      {hours.map((m) => (
        <span
          key={m}
          className="tabular absolute right-2 -translate-y-1/2 text-xs text-muted"
          style={{ top: `${((m - DAY_START_MIN) / SPAN_MIN) * 100}%` }}
        >
          {formatClock(m).replace(":00", "")}
        </span>
      ))}
    </div>
  );
}

/* ── Day view ─────────────────────────────────────────────────────────────── */

export function DayTimeline({
  activities,
  timeZone,
  onEdit,
  onDelete,
  emptyAction,
}: {
  activities: Activity[];
  timeZone: string;
  onEdit?: (activity: Activity) => void;
  onDelete?: (activity: Activity) => void;
  /** Shown inside the empty state — an "add" call to action, or nothing. */
  emptyAction?: React.ReactNode;
}) {
  const placed = useMemo(() => placeActivities(activities, timeZone), [activities, timeZone]);

  return (
    <div className="flex gap-2 px-4 py-4">
      <HourAxis />
      <div
        className="relative flex-1 rounded-control border border-line-subtle bg-canvas"
        style={{ height: (SPAN_MIN / 60) * HOUR_PX }}
      >
        <HourGrid />

        {placed.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm font-medium text-content">No workload recorded</p>
            <p className="text-sm text-muted">
              No workload has been recorded for this date.
            </p>
            {emptyAction}
          </div>
        ) : null}

        {placed.map((p) => (
          <ActivityCard
            key={p.activity.id}
            placed={p}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * One activity on the day timeline.
 *
 * The card body is the edit affordance and the ⋮ menu carries the same edit
 * plus remove — two routes to the same actions, because a small card is an
 * awkward click target and a menu is where people look for "delete".
 */
function ActivityCard({
  placed,
  onEdit,
  onDelete,
}: {
  placed: Placed;
  onEdit?: (activity: Activity) => void;
  onDelete?: (activity: Activity) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { activity, startMin, endMin } = placed;
  const { top, height } = geometry(placed);
  const label = `${activity.activityType.label}, ${formatClock(startMin)} to ${formatClock(endMin)}`;

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [menuOpen]);

  return (
    <div
      className="absolute left-2 right-2 rounded-control border border-l-4 border-line bg-surface shadow-card"
      style={{ top, height, borderLeftColor: categoryColor(activity.activityType.code) }}
    >
      <div className="flex h-full items-start gap-1">
        <button
          type="button"
          onClick={onEdit ? () => onEdit(activity) : undefined}
          disabled={!onEdit}
          aria-label={onEdit ? `Edit ${label}` : label}
          className="min-w-0 flex-1 overflow-hidden px-3 py-2 text-left enabled:hover:bg-hovered disabled:cursor-default"
        >
          <p className="truncate text-sm font-medium text-content">
            {activity.activityType.label}
            {activity.remarks ? (
              <span className="font-normal text-muted">: {activity.remarks}</span>
            ) : null}
          </p>
          <p className="tabular truncate text-xs text-muted">
            {formatClock(startMin)} – {formatClock(endMin)} · {formatDuration(activity.durationHours)}
          </p>
        </button>

        {onEdit || onDelete ? (
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={`Actions for ${label}`}
              className="rounded-control px-2 py-2 text-muted transition hover:bg-hovered hover:text-content"
            >
              <span aria-hidden>⋮</span>
            </button>

            {menuOpen ? (
              <>
                <button
                  aria-hidden
                  tabIndex={-1}
                  onClick={() => setMenuOpen(false)}
                  className="fixed inset-0 z-10 cursor-default"
                />
                <div
                  role="menu"
                  className="absolute right-0 z-20 mt-1 w-36 overflow-hidden rounded-card border border-line bg-surface shadow-raised"
                >
                  {onEdit ? (
                    <button
                      role="menuitem"
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        onEdit(activity);
                      }}
                      className="block w-full px-3 py-2 text-left text-sm text-content transition hover:bg-hovered"
                    >
                      Edit
                    </button>
                  ) : null}
                  {onDelete ? (
                    <button
                      role="menuitem"
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        onDelete(activity);
                      }}
                      className="block w-full px-3 py-2 text-left text-sm text-danger-text transition hover:bg-hovered"
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ── Week view ────────────────────────────────────────────────────────────── */

export type WeekDay = { date: string; label: string; dayNumber: string; isToday: boolean };

export function WeekGrid({
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
  return (
    <div className="overflow-x-auto px-4 py-4">
      <div className="flex min-w-[820px] gap-2">
        <div className="pt-14">
          <HourAxis />
        </div>

        {days.map((day) => {
          const dayActivities = activitiesByDate[day.date] ?? [];
          const placed = placeActivities(dayActivities, timeZone);
          const totalHours = dayActivities.reduce((n, a) => n + a.durationHours, 0);

          return (
            <div key={day.date} className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => onOpenDay(day.date)}
                className={`w-full rounded-t-control border border-b-0 px-2 py-2 text-center transition hover:bg-hovered ${
                  day.isToday ? "border-primary bg-primary-subtle" : "border-line bg-sunken"
                }`}
                aria-label={`Open ${day.label} ${day.dayNumber} in day view`}
              >
                <p className="text-sm font-semibold text-content">
                  <span className="tabular">{day.dayNumber}</span>
                  <span className="ml-1 font-normal text-muted">{day.label}</span>
                </p>
                <p className="tabular mt-0.5 text-xs text-muted">
                  {formatDuration(totalHours)} · {dayActivities.length}{" "}
                  {dayActivities.length === 1 ? "activity" : "activities"}
                </p>
              </button>

              <div
                className="relative rounded-b-control border border-line-subtle bg-canvas"
                style={{ height: (SPAN_MIN / 60) * HOUR_PX }}
              >
                <HourGrid compact />
                {placed.length === 0 ? (
                  <div className="absolute inset-0 flex items-center justify-center px-2">
                    <p className="text-center text-xs text-subtle">No workload recorded</p>
                  </div>
                ) : null}
                {placed.map((p) => {
                  const { top, height } = geometry(p);
                  return (
                    <div
                      key={p.activity.id}
                      className="absolute left-1 right-1 overflow-hidden rounded-chip border-l-4 border border-line bg-surface px-1.5 py-1"
                      style={{
                        top,
                        height,
                        borderLeftColor: categoryColor(p.activity.activityType.code),
                      }}
                      title={`${p.activity.activityType.label} ${formatClock(p.startMin)}–${formatClock(p.endMin)}`}
                    >
                      <p className="truncate text-[11px] font-medium text-content">
                        {p.activity.activityType.label}
                      </p>
                      <p className="tabular truncate text-[10px] text-muted">
                        {formatClock(p.startMin).replace(" ", "")}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The colour key, so a reader can decode the cards. */
export function ActivityLegend({ types }: { types: ActivityTypeOption[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line px-5 py-3">
      {types.map((t) => (
        <span key={t.code} className="flex items-center gap-2 text-xs text-muted">
          <span
            aria-hidden
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: categoryColor(t.code) }}
          />
          {t.label}
        </span>
      ))}
    </div>
  );
}

/* ── The editor ───────────────────────────────────────────────────────────── */

export type DraftRow = {
  key: string;
  /** Present when this row edits an activity that already exists. */
  id: string | null;
  activityTypeCode: string;
  start: string;
  end: string;
  remarks: string;
  /** Marked for removal on save. Only ever set for rows that already exist. */
  removed: boolean;
};

let draftCounter = 0;
export function newDraftRow(): DraftRow {
  draftCounter += 1;
  return {
    key: `draft-${draftCounter}`,
    id: null,
    activityTypeCode: "",
    start: "",
    end: "",
    remarks: "",
    removed: false,
  };
}

export function rowsFromActivities(activities: Activity[], timeZone: string): DraftRow[] {
  return placeActivities(activities, timeZone).map((p) => {
    draftCounter += 1;
    return {
      key: `existing-${p.activity.id}`,
      id: p.activity.id,
      activityTypeCode: p.activity.activityType.code,
      start: hhmmInZone(p.activity.startTime, timeZone),
      end: hhmmInZone(p.activity.endTime, timeZone),
      remarks: p.activity.remarks ?? "",
      removed: false,
    };
  });
}

/**
 * Everything wrong with the draft, keyed by row.
 *
 * Returned rather than thrown so the drawer can mark each field, and computed
 * over the WHOLE draft because the interesting errors are relationships between
 * rows — two entries overlapping each other is not visible from either one.
 */
export function validateDraft(
  rows: DraftRow[],
  existing: Array<{ id: string; startMin: number; endMin: number }>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const live = rows.filter((r) => !r.removed);

  const spans: Array<{ key: string; start: number; end: number }> = [];

  for (const row of live) {
    if (!row.activityTypeCode) {
      errors[row.key] = "Choose an activity type.";
      continue;
    }
    const start = hhmmToMinutes(row.start);
    const end = hhmmToMinutes(row.end);
    if (start === null || end === null) {
      errors[row.key] = "Enter a start and end time.";
      continue;
    }
    if (end <= start) {
      errors[row.key] = "The end time must be after the start time.";
      continue;
    }
    spans.push({ key: row.key, start, end });
  }

  // Half-open [start, end): back-to-back entries touch but do not overlap —
  // the same rule the server applies, so the two cannot disagree.
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length; j++) {
      const a = spans[i]!;
      const b = spans[j]!;
      if (a.start < b.end && a.end > b.start) {
        errors[a.key] ??= "This overlaps another activity in this form.";
        errors[b.key] ??= "This overlaps another activity in this form.";
      }
    }
  }

  const editing = new Set(rows.filter((r) => r.id).map((r) => r.id!));
  for (const span of spans) {
    const row = live.find((r) => r.key === span.key)!;
    const clash = existing.find(
      (e) =>
        e.id !== row.id &&
        !editing.has(e.id) &&
        span.start < e.endMin &&
        span.end > e.startMin,
    );
    if (clash && !errors[span.key]) {
      errors[span.key] = `This overlaps an activity already recorded from ${formatClock(clash.startMin)} to ${formatClock(clash.endMin)}.`;
    }
  }

  if (live.length === 0) errors.__form = "Add at least one activity, or cancel.";

  return errors;
}

/**
 * The add/edit surface.
 *
 * A right-hand drawer on a wide screen and a full-height sheet on a phone —
 * one component, because the difference is layout rather than behaviour. Focus
 * moves into it on open and Escape closes it, so it is usable without a mouse.
 */
export function WorkloadDrawer({
  open,
  mode,
  dateLabel,
  rows,
  errors,
  types,
  busy,
  onChange,
  onAddRow,
  onRemoveRow,
  onClose,
  onSubmit,
}: {
  open: boolean;
  mode: "add" | "edit";
  dateLabel: string;
  rows: DraftRow[];
  errors: Record<string, string>;
  types: ActivityTypeOption[];
  busy: boolean;
  onChange: (key: string, patch: Partial<DraftRow>) => void;
  onAddRow: () => void;
  onRemoveRow: (key: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const live = rows.filter((r) => !r.removed);

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={mode === "add" ? "Add workload" : "Edit workload"}
        className="relative flex h-full w-full flex-col bg-surface shadow-raised outline-none sm:max-w-lg"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-content">
              {mode === "add" ? "Add today's workload" : "Edit today's workload"}
            </h2>
            <p className="mt-0.5 text-sm text-muted">{dateLabel}</p>
          </div>
          <IconButton label="Close" onClick={onClose}>
            <span aria-hidden className="text-lg leading-none">×</span>
          </IconButton>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {errors.__form ? <Alert tone="danger">{errors.__form}</Alert> : null}

          {live.map((row, index) => (
            <Card key={row.key} padded>
              <div className="flex items-center justify-between gap-2 pb-3">
                <p className="text-sm font-medium text-content">Activity {index + 1}</p>
                {live.length > 1 ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => onRemoveRow(row.key)}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>

              <div className="space-y-3">
                <Field label="Activity type" required>
                  <Select
                    value={row.activityTypeCode}
                    onChange={(e) => onChange(row.key, { activityTypeCode: e.target.value })}
                  >
                    <option value="">Select activity type</option>
                    {types.map((t) => (
                      <option key={t.code} value={t.code}>
                        {t.label}
                      </option>
                    ))}
                  </Select>
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Start time" required>
                    <input
                      type="time"
                      className={inputClass}
                      value={row.start}
                      onChange={(e) => onChange(row.key, { start: e.target.value })}
                    />
                  </Field>
                  <Field label="End time" required>
                    <input
                      type="time"
                      className={inputClass}
                      value={row.end}
                      onChange={(e) => onChange(row.key, { end: e.target.value })}
                    />
                  </Field>
                </div>

                <Field label="Remarks" hint="Optional">
                  <input
                    className={inputClass}
                    value={row.remarks}
                    maxLength={2000}
                    onChange={(e) => onChange(row.key, { remarks: e.target.value })}
                  />
                </Field>

                {errors[row.key] ? (
                  <p className="text-xs text-danger-text">{errors[row.key]}</p>
                ) : null}
              </div>
            </Card>
          ))}

          {live.length === 0 ? (
            <Card>
              <EmptyState
                title="Nothing in this form"
                description="Add an activity, or cancel to leave the day as it is."
              />
            </Card>
          ) : null}

          <Button type="button" variant="secondary" onClick={onAddRow} className="w-full">
            + Add another activity
          </Button>

          <Alert tone="info" title="Times must not overlap">
            Two activities cannot cover the same minute. Back-to-back entries are fine — an
            activity ending at 11:00 and another starting at 11:00 do not overlap.
          </Alert>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={onSubmit} disabled={busy}>
            {busy ? "Saving…" : mode === "add" ? "Add workload" : "Save changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Rows the drawer will delete on save, for the confirmation text. */
export function removalCount(rows: DraftRow[]): number {
  return rows.filter((r) => r.removed && r.id).length;
}

/** A stable badge for whether the day has anything recorded. */
export function WorkloadStatusBadge({ added }: { added: boolean }) {
  return (
    <Badge tone={added ? "success" : "neutral"}>{added ? "Workload added" : "Not added"}</Badge>
  );
}

export { categoryLabel };
