/**
 * Reusable marketing sections, shared across the homepage and the sub-pages.
 *
 * These live together because they are all "one idea, one visual" blocks
 * that more than one page needs. Keeping them here is what stops
 * /platform and / drifting into two slightly different explanations of the
 * same concept.
 */

import { Step } from "@/app/_components/public/marketing";

/* ── Workforce intelligence ────────────────────────────────────────────── */

const CATEGORIES = [
  { label: "Teaching", hours: "29.0h", pct: 46, color: "var(--cat-teaching)" },
  { label: "Learning", hours: "11.5h", pct: 18, color: "var(--cat-learning)" },
  { label: "Meetings", hours: "7.0h", pct: 11, color: "var(--cat-meeting)" },
  { label: "Administrative", hours: "5.5h", pct: 9, color: "var(--cat-admin)" },
  { label: "Support", hours: "4.0h", pct: 6, color: "var(--cat-support)" },
  { label: "Other", hours: "2.0h", pct: 3, color: "var(--cat-other)" },
];

/**
 * How capacity was allocated.
 *
 * The two rows below the categories are the point of the whole component.
 * Unutilized capacity and missing data are shown as SEPARATE lines, because
 * conflating them is the single most consequential mistake a workforce tool
 * can make: "nobody recorded anything" is not evidence that "nobody worked".
 * The hatched track for unutilized time is the product's own convention.
 */
export function WorkloadVisualization() {
  return (
    <div className="rounded-card border border-line bg-surface p-6 sm:p-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="text-base font-semibold text-content">
          How instructor capacity was allocated
        </h3>
        <p className="text-xs text-subtle">Example week</p>
      </div>

      {/* One stacked bar, then the legend — a distribution reads faster as a
          single proportional bar than as six separate meters. */}
      <div className="mt-6 flex h-3 w-full overflow-hidden rounded-pill">
        {CATEGORIES.map((category) => (
          <div
            key={category.label}
            style={{ width: `${category.pct}%`, background: category.color }}
            title={`${category.label} — ${category.hours}`}
          />
        ))}
        <div className="hatched" style={{ width: "7%" }} title="Unutilized capacity" />
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        {CATEGORIES.map((category) => (
          <div key={category.label} className="flex items-center gap-2">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-chip"
              style={{ background: category.color }}
            />
            <dt className="truncate text-sm text-muted">{category.label}</dt>
            <dd className="tabular ml-auto text-sm font-medium text-content">{category.hours}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-6 grid grid-cols-1 gap-3 border-t border-line pt-6 sm:grid-cols-2">
        <div className="flex items-center gap-2">
          <span aria-hidden className="hatched size-2.5 shrink-0 rounded-chip" />
          <p className="text-sm text-muted">
            <span className="font-medium text-content">Unutilized capacity</span> — available time
            with no activity against it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span aria-hidden className="size-2.5 shrink-0 rounded-chip bg-warning" />
          <p className="text-sm text-muted">
            <span className="font-medium text-content">Missing data</span> — working time with no
            records, reported separately rather than counted as unused.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ── Opening and closing ───────────────────────────────────────────────── */

const WORKDAY = [
  { time: "9:00 – 9:15", title: "Opening & team brief", kind: "bookend" as const },
  { time: "9:15 – 10:15", title: "Teaching · CS101", kind: "work" as const },
  { time: "10:30 – 12:00", title: "Teaching · CS201", kind: "work" as const },
  { time: "13:00 – 14:30", title: "Learning & research", kind: "work" as const },
  { time: "15:00 – 16:00", title: "Student support", kind: "work" as const },
  { time: "16:45 – 17:00", title: "Closing & review", kind: "bookend" as const },
];

/**
 * The university workday, start to finish.
 *
 * This visualisation exists specifically to communicate the rule correctly:
 * opening and closing are ONE pair bracketing the university's working day —
 * not a 15-minute block attached to either side of every class. The timeline
 * shows a single opening at the top, a single closing at the bottom, and
 * ordinary work in between, which makes the rule self-evident rather than
 * something the copy has to argue.
 */
export function OpeningClosingTimeline() {
  return (
    <div className="rounded-card border border-line bg-surface p-6 sm:p-8">
      <ol className="relative space-y-5">
        {/* The spine, drawn behind the markers. */}
        <span
          aria-hidden
          className="absolute bottom-2 left-[5px] top-2 w-px bg-line"
        />
        {WORKDAY.map((entry) => (
          <li key={entry.time} className="relative flex items-start gap-4 pl-6">
            <span
              aria-hidden
              className={`absolute left-0 top-1.5 size-[11px] rounded-full border-2 border-surface ${
                entry.kind === "bookend" ? "bg-primary" : "bg-line-strong"
              }`}
            />
            <span className="tabular w-28 shrink-0 text-sm text-muted">{entry.time}</span>
            <span
              className={`text-sm ${
                entry.kind === "bookend"
                  ? "font-semibold text-content"
                  : "font-medium text-content"
              }`}
            >
              {entry.title}
            </span>
            {entry.kind === "bookend" ? (
              <span className="ml-auto shrink-0 rounded-pill bg-primary-subtle px-2.5 py-0.5 text-xs font-medium text-primary-text">
                University-wide
              </span>
            ) : null}
          </li>
        ))}
      </ol>

      <p className="mt-6 border-t border-line pt-5 text-sm leading-relaxed text-muted">
        Opening and closing bracket the university&rsquo;s working day{" "}
        <span className="font-medium text-content">once</span> — they are not repeated around
        every class or activity.
      </p>
    </div>
  );
}

/* ── How it works ──────────────────────────────────────────────────────── */

const STEPS = [
  { number: "01", title: "Collect", body: "Activities, schedules, deliverables and workforce inputs." },
  { number: "02", title: "Analyze", body: "Calculate workload, utilization and available capacity." },
  { number: "03", title: "Detect", body: "Identify risks, patterns and data quality issues." },
  { number: "04", title: "Recommend", body: "Surface actionable insights with the evidence behind them." },
  { number: "05", title: "Improve", body: "Support better operational decisions across the network." },
];

export function HowItWorks() {
  return (
    <div className="grid grid-cols-1 gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-5">
      {STEPS.map((step) => (
        <Step key={step.number} number={step.number} title={step.title}>
          {step.body}
        </Step>
      ))}
    </div>
  );
}

/* ── Multi-university structure ────────────────────────────────────────── */

const NETWORK = [
  { university: "Northfield University", manager: "1 manager", instructors: "128 instructors" },
  { university: "Riverstone University", manager: "1 manager", instructors: "94 instructors" },
  { university: "Westbrook Institute", manager: "1 manager", instructors: "76 instructors" },
];

/**
 * The organisation → university → people structure, drawn as a business
 * diagram rather than an architecture diagram. The point being made is about
 * scope of visibility and access, not about system topology.
 */
export function UniversityNetwork() {
  return (
    <div className="rounded-card border border-line bg-surface p-6 sm:p-8">
      <div className="inline-flex items-center gap-2.5 rounded-control bg-sidebar-bg px-4 py-2.5">
        <svg aria-hidden viewBox="0 0 20 20" className="size-4 text-white" fill="none">
          <rect x="1" y="12" width="4.5" height="7" rx="1" fill="currentColor" opacity="0.5" />
          <rect x="7.75" y="7" width="4.5" height="12" rx="1" fill="currentColor" opacity="0.75" />
          <rect x="14.5" y="1" width="4.5" height="18" rx="1" fill="currentColor" />
        </svg>
        <span className="font-display text-sm font-semibold tracking-tight text-white">
          NEXTWAVE
        </span>
        <span className="text-xs text-sidebar-text-muted">Organization</span>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {NETWORK.map((row) => (
          <div key={row.university} className="rounded-control border border-line p-4">
            <p className="text-sm font-semibold text-content">{row.university}</p>
            <ul className="mt-3 space-y-1.5">
              <li className="flex items-center gap-2 text-xs text-muted">
                <span aria-hidden className="size-1.5 rounded-full bg-primary" />
                {row.manager}
              </li>
              <li className="flex items-center gap-2 text-xs text-muted">
                <span aria-hidden className="size-1.5 rounded-full bg-line-strong" />
                {row.instructors}
              </li>
            </ul>
          </div>
        ))}
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-line pt-6 sm:grid-cols-4">
        {[
          ["One organization", "A single NEXTWAVE tenant."],
          ["Multiple universities", "Each with its own configuration."],
          ["Centralized visibility", "Compare performance across the network."],
          ["Scoped access", "Each role sees only what it should."],
        ].map(([term, detail]) => (
          <div key={term}>
            <dt className="text-sm font-semibold text-content">{term}</dt>
            <dd className="mt-1 text-xs leading-relaxed text-muted">{detail}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
