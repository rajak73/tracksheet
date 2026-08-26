/**
 * Product previews for the public website.
 *
 * WHY THESE ARE MARKUP AND NOT SCREENSHOTS
 *
 * There are no screenshot assets in this repository (only Next.js' default
 * SVGs), and no capture tooling is available in this environment. Rather
 * than ship a stock image or an invented dashboard that contradicts the real
 * one, these previews are rebuilt in markup from the SAME design tokens the
 * product uses — `--app-sidebar-bg`, `--color-primary`, `--color-line`, the
 * category palette, the radius scale. That has a real advantage over a PNG:
 * it cannot drift from the product's palette, it stays crisp at any
 * resolution, it reflows on a phone instead of becoming unreadably small,
 * its text is selectable and screen-reader accessible, and it costs a few KB
 * of HTML instead of a large image.
 *
 * Every figure here is REPRESENTATIVE, not customer data — each preview is
 * published alongside `IllustrativeNote` saying exactly that.
 *
 * When real screenshots exist, swapping them in means replacing the body of
 * these three components; the `BrowserFrame` wrapper and all call sites stay
 * as they are.
 */

import type { ReactNode } from "react";

/* ── Shared chrome ─────────────────────────────────────────────────────── */

/* Copied from the product's real navigation — see `nav.tsx`.
 *
 * These listed six items each, most of which have since been removed:
 * Analytics and AI Insights are gone from the admin rail, Managers and
 * Instructors collapsed into one Employees list, and the manager's rail is two
 * items rather than six. A marketing site advertising screens the product no
 * longer has is worse than one showing fewer. */
const NAV_ITEMS: Record<PreviewRole, string[]> = {
  admin: ["Dashboard", "Employees", "Worklog", "Settings"],
  manager: ["Dashboard", "Worklog"],
  instructor: ["Work Log", "Activity Tracker", "My Performance", "Settings"],
};

export type PreviewRole = "admin" | "manager" | "instructor";

const ROLE_LABEL: Record<PreviewRole, string> = {
  admin: "Administrator",
  manager: "Manager",
  instructor: "Instructor",
};

/**
 * The navy sidebar rail, reproducing the product's own: wordmark, role
 * label, nav list with one active item carrying the blue wash and left
 * accent bar. Hidden below `sm` so the content half stays legible on a
 * phone rather than shrinking to fit two columns.
 */
function PreviewSidebar({ role }: { role: PreviewRole }) {
  return (
    <div className="hidden w-40 shrink-0 flex-col bg-sidebar-bg p-3 sm:flex">
      <div className="flex items-center gap-1.5 px-1 pb-3">
        <svg aria-hidden viewBox="0 0 20 20" className="size-3 text-white" fill="none">
          <rect x="1" y="12" width="4.5" height="7" rx="1" fill="currentColor" opacity="0.5" />
          <rect x="7.75" y="7" width="4.5" height="12" rx="1" fill="currentColor" opacity="0.75" />
          <rect x="14.5" y="1" width="4.5" height="18" rx="1" fill="currentColor" />
        </svg>
        <span className="font-display text-[10px] font-semibold tracking-tight text-white">
          NIAT
        </span>
      </div>
      <p className="px-1 pb-2 text-[9px] uppercase tracking-wider text-sidebar-text-muted">
        {ROLE_LABEL[role]}
      </p>
      <ul className="space-y-0.5">
        {NAV_ITEMS[role].map((item, i) => (
          <li key={item} className="relative">
            {i === 0 ? (
              <span
                aria-hidden
                className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-sidebar-active-accent"
              />
            ) : null}
            <span
              className={`block rounded-[3px] px-2 py-1.5 text-[10px] font-medium ${
                i === 0
                  ? "bg-sidebar-active-bg text-white"
                  : "text-sidebar-text-muted"
              }`}
            >
              {item}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PreviewShell({ role, children }: { role: PreviewRole; children: ReactNode }) {
  /* ── An instructor has no sidebar ──────────────────────────────────────
   * Admin and manager sit inside `AppShell`, which is a fixed navy rail.
   * An instructor sits inside `InstructorShell`, which is a full-width BLUE
   * BAR across the top and no rail at all — a different chrome entirely.
   * Drawing all three with a sidebar showed instructors a screen the product
   * has never had. */
  if (role === "instructor") {
    return (
      <div className="min-h-72 bg-canvas">
        <PreviewTopBar />
        <div className="min-w-0">{children}</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-72 bg-canvas">
      <PreviewSidebar role={role} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** The instructor's blue bar: clipboard tile, WorkLog wordmark, identity chip. */
function PreviewTopBar() {
  return (
    <div className="flex items-center justify-between bg-primary px-3.5 py-2">
      <span className="flex items-center gap-2">
        <span className="inline-flex size-6 items-center justify-center rounded-[6px] bg-white text-primary">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden className="size-3.5">
            <rect x="5" y="3" width="14" height="18" rx="2" stroke="currentColor" strokeWidth="2" />
            <path d="M9 3.5h6v2H9z" fill="currentColor" />
            <path d="m9 12 2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </span>
        <span className="font-display text-sm font-bold tracking-tight text-white">WorkLog</span>
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-flex size-5 items-center justify-center rounded-full bg-white/25 text-[8px] font-semibold text-white">
          AV
        </span>
        <span className="text-[10px] font-semibold text-white">Arun Verma</span>
      </span>
    </div>
  );
}

/** A compact KPI tile matching the product's `StatTile`. */
function Kpi({
  label,
  value,
  suffix,
  delta,
  deltaTone = "neutral",
}: {
  label: string;
  value: string;
  suffix?: string;
  delta?: string;
  deltaTone?: "up" | "down" | "neutral";
}) {
  const tone = {
    up: "text-success",
    down: "text-danger",
    neutral: "text-subtle",
  }[deltaTone];

  return (
    <div className="rounded-[6px] border border-line bg-surface p-3">
      <p className="truncate text-[9px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="tabular mt-1.5 text-lg font-semibold text-content">
        {value}
        {suffix ? <span className="ml-0.5 text-[11px] font-normal text-muted">{suffix}</span> : null}
      </p>
      {delta ? <p className={`tabular mt-0.5 text-[9px] font-medium ${tone}`}>{delta}</p> : null}
    </div>
  );
}

function PanelTitle({ children }: { children: ReactNode }) {
  return <p className="text-[11px] font-semibold text-content">{children}</p>;
}

/**
 * A small area chart in the product's primary blue.
 *
 * Same technique as `charts.tsx`: `preserveAspectRatio="none"` so the shape
 * stretches to its container, `vector-effect="non-scaling-stroke"` so the
 * line weight stays constant while it does.
 */
function MiniAreaChart({ points }: { points: number[] }) {
  const max = Math.max(...points, 1);
  const step = 100 / (points.length - 1);
  const line = points.map((p, i) => `${i * step} ${100 - (p / max) * 92}`).join(" L ");

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="h-24 w-full"
      role="img"
      aria-label="Utilization trending upward across the period"
    >
      {[25, 50, 75].map((y) => (
        <line
          key={y}
          x1="0"
          x2="100"
          y1={y}
          y2={y}
          stroke="var(--app-border)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <path d={`M ${line} L 100 100 L 0 100 Z`} fill="var(--app-primary)" opacity="0.08" />
      <path
        d={`M ${line}`}
        fill="none"
        stroke="var(--app-primary)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** A labelled horizontal bar, used for per-university and per-category rows. */
function BarRow({
  label,
  pct,
  color = "var(--app-primary)",
  value,
}: {
  label: string;
  pct: number;
  color?: string;
  value?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[10px] text-muted">{label}</span>
        <span className="tabular text-[10px] font-medium text-content">{value ?? `${pct}%`}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sunken">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

/* ── Admin ─────────────────────────────────────────────────────────────── */

/**
 * The three previews below mirror the REAL screens, figure for figure.
 *
 * They used to show Avg. utilization, Compliance and a "Network utilization
 * trend" — three metrics the product does not have any more. Utilization was
 * removed because it divided every recorded minute by a configured day, so a
 * week of internal meetings scored like a week of teaching; compliance went
 * with it. A public site is the last place those should have survived, because
 * it is the one surface nobody signs in to check.
 *
 * What is shown now is what the screens show: head count, today's submissions,
 * what is outstanding, hours for the month, the submission curve, and the list
 * of who has not filed. Figures are representative — every call site publishes
 * `IllustrativeNote` beside them saying so.
 */
export function AdminPreview() {
  return (
    <PreviewShell role="admin">
      <div className="space-y-3 p-4">
        <div>
          <h3 className="text-sm font-semibold text-content">Dashboard</h3>
          <p className="text-[10px] text-muted">Tuesday, 25 August 2026 · August to date</p>
        </div>

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Kpi label="Total employees" value="128" />
          <Kpi label="Today's submissions" value="112" />
          <Kpi label="Pending submissions" value="16" />
          <Kpi label="Total work hours" value="1,248" delta="↑ 10%" deltaTone="up" />
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
          <div className="rounded-[6px] border border-line bg-surface p-3 lg:col-span-3">
            <PanelTitle>Submission overview</PanelTitle>
            <MiniAreaChart points={[42, 58, 51, 74, 66, 88, 79, 96]} />
          </div>
          <div className="space-y-2.5 rounded-[6px] border border-line bg-surface p-3 lg:col-span-2">
            <PanelTitle>Pending submissions</PanelTitle>
            <BarRow label="Northfield University" pct={94} value="94%" />
            <BarRow label="Riverstone University" pct={88} value="88%" />
            <BarRow label="Westbrook Institute" pct={81} value="81%" />
            <BarRow label="Ashcombe College" pct={76} value="76%" />
          </div>
        </div>
      </div>
    </PreviewShell>
  );
}

/* ── Manager ───────────────────────────────────────────────────────────── */

export function ManagerPreview() {
  return (
    <PreviewShell role="manager">
      <div className="space-y-3 p-4">
        <div>
          <h3 className="text-sm font-semibold text-content">Team Dashboard</h3>
          <p className="text-[10px] text-muted">16 instructors · August to date</p>
        </div>

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Kpi label="Team members" value="16" />
          <Kpi label="Today's submissions" value="15" />
          <Kpi label="Pending" value="1" />
          <Kpi label="Work hours" value="167" />
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
          <div className="rounded-[6px] border border-line bg-surface p-3 lg:col-span-3">
            <PanelTitle>Team submission overview</PanelTitle>
            <MiniAreaChart points={[11, 14, 12, 15, 13, 16, 15, 16]} />
          </div>
          <div className="space-y-2.5 rounded-[6px] border border-line bg-surface p-3 lg:col-span-2">
            <PanelTitle>Working hours by instructor</PanelTitle>
            <BarRow label="Aditi Rao" pct={88} value="10h 15m" />
            <BarRow label="Ananya Bose" pct={79} value="09h 15m" />
            <BarRow label="Arjun Kapoor" pct={73} value="08h 30m" />
            <BarRow label="Arun Verma" pct={52} value="06h 00m" />
          </div>
        </div>
      </div>
    </PreviewShell>
  );
}

/* ── Instructor ────────────────────────────────────────────────────────── */

export function InstructorPreview() {
  return (
    <PreviewShell role="instructor">
      <div className="space-y-2.5 p-3.5">
        {/* Page heading, then the card — the two levels the real screen has. */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-bold tracking-tight text-primary-text">
              Work Log History
            </h3>
            <p className="text-[10px] text-muted">View and manage submitted work logs</p>
          </div>
          <span className="shrink-0 rounded-[5px] bg-primary px-2.5 py-1.5 text-[10px] font-semibold text-white">
            + Today&rsquo;s Work Log
          </span>
        </div>

        <div className="overflow-hidden rounded-[6px] border border-line bg-surface">
          {/* Card header: its own quieter heading, and the view switch. */}
          <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
            <span className="text-[11px] font-bold tracking-tight text-primary-text">
              Work Log History
            </span>
            <span className="inline-flex gap-0.5 rounded-[5px] border border-line p-0.5">
              <span className="rounded-[3px] bg-primary px-2 py-0.5 text-[9px] font-semibold text-white">
                Date Wise
              </span>
              <span className="px-2 py-0.5 text-[9px] font-semibold text-muted">Weekly</span>
            </span>
          </div>

          {/* Filters: two dates, a search, a reset. */}
          <div className="flex items-center gap-1.5 border-b border-line px-3 py-2">
            <span className="text-[9px] text-muted">From</span>
            <span className="rounded-[4px] border border-line px-1.5 py-0.5 text-[9px] text-content">
              17/08/2026
            </span>
            <span className="text-[9px] text-muted">To</span>
            <span className="rounded-[4px] border border-line px-1.5 py-0.5 text-[9px] text-content">
              25/08/2026
            </span>
            <span className="ml-1 flex-1 rounded-[4px] border border-line px-1.5 py-0.5 text-[9px] text-subtle">
              Search by deliverable, remarks…
            </span>
            <span className="rounded-[4px] border border-primary/40 px-1.5 py-0.5 text-[9px] font-semibold text-primary-text">
              Reset Filters
            </span>
          </div>

          {/* The sheet, in the client's own columns. */}
          <div className="grid grid-cols-[0.95fr_0.7fr_1.35fr_0.8fr_0.55fr_0.9fr_0.45fr] gap-1.5 border-b border-line bg-primary-subtle px-3 py-1.5 text-[8px] font-semibold uppercase tracking-wide text-primary-text">
            <span>Date</span>
            <span>Broad Category</span>
            <span>Deliverable</span>
            <span>Deliv. Qty</span>
            <span>Hours</span>
            <span>Remarks</span>
            <span>Actions</span>
          </div>

          {[
            {
              date: "Today — 25 Aug",
              cat: "Technical",
              lines: ["Live Class - 4h", "Doubt Clearing - 45m"],
              qty: ["2 Classes", "1 Doubt Session"],
              hours: "06h 15m",
              remark: "Binary trees, section A",
            },
            {
              date: "24 Aug 2026",
              cat: "Technical",
              lines: ["Live Class - 2h", "Documentation - 1h"],
              qty: ["1 Class"],
              hours: "05h 00m",
              remark: "Slide deck for next week",
            },
            {
              date: "23 Aug 2026",
              cat: "Mathematics",
              lines: ["Practical / Lab Session - 3h"],
              qty: ["1 Lab Session"],
              hours: "04h 30m",
              remark: "Unit 3 practicals",
            },
          ].map((r) => (
            <div
              key={r.date}
              className="grid grid-cols-[0.95fr_0.7fr_1.35fr_0.8fr_0.55fr_0.9fr_0.45fr] gap-1.5 border-b border-line-subtle px-3 py-1.5 text-[9px] leading-snug text-content last:border-b-0"
            >
              <span>{r.date}</span>
              <span className="text-muted">{r.cat}</span>
              <span>
                {r.lines.map((l) => (
                  <span key={l} className="flex items-start gap-1">
                    <span aria-hidden className="mt-[0.45em] size-1 shrink-0 rounded-full bg-primary" />
                    {l}
                  </span>
                ))}
              </span>
              <span className="text-muted">
                {r.qty.map((q) => (
                  <span key={q} className="block">
                    {q}
                  </span>
                ))}
              </span>
              <span className="tabular font-semibold">{r.hours}</span>
              <span className="truncate text-muted">{r.remark}</span>
              {/* Edit and delete, the two the row actually offers. */}
              <span className="flex gap-1">
                <span className="inline-flex size-3.5 items-center justify-center rounded-[3px] border border-primary/40 text-[7px] text-primary-text">
                  &#9998;
                </span>
                <span className="inline-flex size-3.5 items-center justify-center rounded-[3px] border border-danger/40 text-[7px] text-danger-text">
                  &#128465;
                </span>
              </span>
            </div>
          ))}

          <div className="flex items-center justify-between px-3 py-1.5 text-[8px] text-muted">
            <span>Showing 1 to 3 of 9 entries</span>
            <span className="flex gap-1">
              <span className="rounded-[3px] bg-primary px-1.5 py-0.5 font-semibold text-white">1</span>
              <span className="rounded-[3px] border border-line px-1.5 py-0.5">2</span>
              <span className="rounded-[3px] border border-line px-1.5 py-0.5">Next</span>
            </span>
          </div>
        </div>
      </div>
    </PreviewShell>
  );
}
