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

const NAV_ITEMS: Record<PreviewRole, string[]> = {
  admin: ["Overview", "Universities", "Managers", "Instructors", "Analytics", "AI Insights"],
  manager: ["Overview", "Instructors", "Schedule", "Workload", "Deliverables", "Analytics"],
  instructor: ["Today", "Schedule", "Activities", "Learning", "Deliverables", "Analytics"],
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
          NEXTWAVE
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
  return (
    <div className="flex min-h-72 bg-canvas">
      <PreviewSidebar role={role} />
      <div className="min-w-0 flex-1">{children}</div>
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

export function AdminPreview() {
  return (
    <PreviewShell role="admin">
      <div className="space-y-3 p-4">
        <div>
          <h3 className="text-sm font-semibold text-content">Admin Overview</h3>
          <p className="text-[10px] text-muted">
            Real-time overview of the NEXTWAVE university network
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Kpi label="Universities" value="12" />
          <Kpi label="Instructors" value="1,284" />
          <Kpi label="Avg. utilization" value="87" suffix="%" delta="↑ 3.2%" deltaTone="up" />
          <Kpi label="Compliance" value="94" suffix="%" delta="↑ 1.1%" deltaTone="up" />
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
          <div className="rounded-[6px] border border-line bg-surface p-3 lg:col-span-3">
            <PanelTitle>Network utilization trend</PanelTitle>
            <MiniAreaChart points={[62, 68, 65, 74, 78, 76, 83, 87]} />
          </div>
          <div className="space-y-2.5 rounded-[6px] border border-line bg-surface p-3 lg:col-span-2">
            <PanelTitle>Utilization by university</PanelTitle>
            <BarRow label="Northfield University" pct={92} />
            <BarRow label="Riverstone University" pct={88} />
            <BarRow label="Westbrook Institute" pct={81} />
            <BarRow label="Ashcombe College" pct={74} />
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
          <h3 className="text-sm font-semibold text-content">Manager Dashboard</h3>
          <p className="text-[10px] text-muted">Northfield University · this week</p>
        </div>

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Kpi label="Instructors" value="128" />
          <Kpi label="Avg. utilization" value="92" suffix="%" delta="↑ 2.4%" deltaTone="up" />
          <Kpi label="Compliance" value="95" suffix="%" />
          <Kpi label="Open alerts" value="3" delta="Needs review" deltaTone="down" />
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
          <div className="space-y-2.5 rounded-[6px] border border-line bg-surface p-3 lg:col-span-3">
            <PanelTitle>Workload overview</PanelTitle>
            <BarRow label="Teaching" pct={78} color="var(--cat-teaching)" value="29h" />
            <BarRow label="Learning" pct={42} color="var(--cat-learning)" value="16h" />
            <BarRow label="Meetings" pct={28} color="var(--cat-meeting)" value="11h" />
            <BarRow label="Administrative" pct={19} color="var(--cat-admin)" value="7h" />
            <BarRow label="Support" pct={14} color="var(--cat-support)" value="5h" />
          </div>
          <div className="space-y-2 rounded-[6px] border border-line bg-surface p-3 lg:col-span-2">
            <PanelTitle>Needs attention</PanelTitle>
            {[
              { name: "A. Thompson", detail: "128% workload", tone: "danger" },
              { name: "J. Okafor", detail: "Missing activity", tone: "warning" },
              { name: "M. Lin", detail: "54% utilization", tone: "warning" },
            ].map((row) => (
              <div key={row.name} className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={`size-1.5 shrink-0 rounded-full ${
                    row.tone === "danger" ? "bg-danger" : "bg-warning"
                  }`}
                />
                <span className="truncate text-[10px] font-medium text-content">{row.name}</span>
                <span className="ml-auto shrink-0 text-[10px] text-muted">{row.detail}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </PreviewShell>
  );
}

/* ── Instructor ────────────────────────────────────────────────────────── */

/**
 * Note the timeline's first and last entries: opening and closing are ONE
 * pair bracketing the university workday, not a pair around every class.
 * That business rule is easy to misrepresent in a marketing visual, so the
 * preview encodes it correctly.
 */
export function InstructorPreview() {
  const timeline = [
    { time: "9:00 – 9:15", title: "Opening & team brief", state: "done" },
    { time: "9:15 – 10:15", title: "CS101 · Data Structures", state: "done" },
    { time: "10:30 – 11:30", title: "CS201 · Algorithms", state: "done" },
    { time: "11:45 – 12:30", title: "Department meeting", state: "now" },
    { time: "14:00 – 15:00", title: "Student advising", state: "next" },
    { time: "16:45 – 17:00", title: "Closing & review", state: "next" },
  ];

  return (
    <PreviewShell role="instructor">
      <div className="space-y-3 p-4">
        <div>
          <h3 className="text-sm font-semibold text-content">Today</h3>
          <p className="text-[10px] text-muted">Tuesday, 12 May · Northfield University</p>
        </div>

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Kpi label="Scheduled" value="6" suffix="items" />
          <Kpi label="Teaching" value="4.5" suffix="h" />
          <Kpi label="Learning" value="1.5" suffix="h" />
          <Kpi label="Tasks" value="3" delta="1 due today" deltaTone="neutral" />
        </div>

        <div className="rounded-[6px] border border-line bg-surface p-3">
          <PanelTitle>Today&rsquo;s timeline</PanelTitle>
          <ol className="mt-2.5 space-y-2">
            {timeline.map((row) => (
              <li key={row.time} className="flex items-start gap-2.5">
                <span
                  aria-hidden
                  className={`mt-1 size-1.5 shrink-0 rounded-full ${
                    row.state === "done"
                      ? "bg-success"
                      : row.state === "now"
                        ? "bg-primary"
                        : "bg-line-strong"
                  }`}
                />
                <span className="tabular w-20 shrink-0 text-[10px] text-muted">{row.time}</span>
                <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-content">
                  {row.title}
                </span>
                <span
                  className={`shrink-0 rounded-pill px-1.5 py-px text-[9px] font-medium ${
                    row.state === "done"
                      ? "bg-success-subtle text-success-text"
                      : row.state === "now"
                        ? "bg-primary-subtle text-primary-text"
                        : "bg-sunken text-muted"
                  }`}
                >
                  {row.state === "done" ? "Completed" : row.state === "now" ? "In progress" : "Upcoming"}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </PreviewShell>
  );
}

export const PREVIEW_BY_ROLE: Record<PreviewRole, () => React.ReactElement> = {
  admin: AdminPreview,
  manager: ManagerPreview,
  instructor: InstructorPreview,
};
