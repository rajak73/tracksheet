"use client";

/**
 * The "One platform. Every role." switcher.
 *
 * A real ARIA tablist: arrow keys move between roles, Home/End jump to the
 * ends, and each panel is associated with its tab. A row of `<button>`s that
 * merely swap state looks the same and is far worse to use without a mouse.
 *
 * The three panels are all rendered and toggled with `hidden` rather than
 * conditionally mounted, so switching never reflows the page height — the
 * "no layout jump" requirement.
 */

import { useRef, useState } from "react";
import { ButtonLink } from "@/app/_components/ui";
import {
  AdminPreview,
  InstructorPreview,
  ManagerPreview,
  type PreviewRole,
} from "@/app/_components/public/DashboardPreview";
import {
  BrowserFrame,
  CapabilityItem,
  IllustrativeNote,
} from "@/app/_components/public/marketing";

type RoleContent = {
  id: PreviewRole;
  tab: string;
  title: string;
  description: string;
  capabilities: string[];
  href: string;
  cta: string;
  preview: () => React.ReactElement;
  previewLabel: string;
};

const ROLES: RoleContent[] = [
  {
    id: "admin",
    tab: "Administrator",
    title: "See the bigger picture.",
    description:
      "Monitor universities, managers, instructors and operational performance from one centralized command center.",
    capabilities: [
      "Multi-university visibility",
      "University performance comparison",
      "Instructor workforce analytics",
      "Compliance monitoring",
      "AI insights and alerts",
      "Reports and exports",
    ],
    href: "/solutions/universities",
    cta: "Explore Admin Platform",
    preview: AdminPreview,
    previewLabel: "NEXTWAVE — Admin Overview",
  },
  {
    id: "manager",
    tab: "Manager",
    title: "Turn workforce data into action.",
    description:
      "Understand instructor workload, schedules, deliverables and operational risks inside your university.",
    capabilities: [
      "University workforce visibility",
      "Instructor workload and utilization",
      "Schedule monitoring",
      "Deliverable tracking",
      "Analytics and trends",
      "AI recommendations",
    ],
    href: "/solutions/managers",
    cta: "Explore Manager Platform",
    preview: ManagerPreview,
    previewLabel: "NEXTWAVE — Manager Dashboard",
  },
  {
    id: "instructor",
    tab: "Instructor",
    title: "Your day. Your workload. One clear view.",
    description:
      "Track your schedule, teaching, learning, activities and daily responsibilities from one place.",
    capabilities: [
      "Today's schedule and timeline",
      "Teaching hours",
      "Learning hours",
      "Activity recording",
      "Deliverables",
      "Personal workload trends",
    ],
    href: "/solutions/instructors",
    cta: "Explore Instructor Platform",
    preview: InstructorPreview,
    previewLabel: "NEXTWAVE — Instructor Today",
  },
];

export function RoleSwitcher() {
  const [active, setActive] = useState<PreviewRole>("admin");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    const keys: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: ROLES.length - 1,
    };
    const next = keys[e.key];
    if (next === undefined) return;

    e.preventDefault();
    const wrapped = (next + ROLES.length) % ROLES.length;
    setActive(ROLES[wrapped].id);
    tabRefs.current[wrapped]?.focus();
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label="Choose a role"
        className="inline-flex flex-wrap gap-1 rounded-control border border-line bg-surface p-1"
      >
        {ROLES.map((role, i) => {
          const selected = role.id === active;
          return (
            <button
              key={role.id}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              role="tab"
              id={`role-tab-${role.id}`}
              aria-selected={selected}
              aria-controls={`role-panel-${role.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(role.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={`rounded-[5px] px-4 py-2 text-sm font-medium transition-colors ${
                selected
                  ? "bg-primary text-white"
                  : "text-muted hover:bg-hovered hover:text-content"
              }`}
            >
              {role.tab}
            </button>
          );
        })}
      </div>

      {ROLES.map((role) => {
        const Preview = role.preview;
        const selected = role.id === active;
        return (
          <div
            key={role.id}
            role="tabpanel"
            id={`role-panel-${role.id}`}
            aria-labelledby={`role-tab-${role.id}`}
            hidden={!selected}
            className="mt-10"
          >
            <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-12 lg:gap-14">
              <div className="lg:col-span-5">
                <h3 className="text-2xl font-semibold tracking-tight text-content sm:text-3xl">
                  {role.title}
                </h3>
                <p className="mt-4 text-base leading-relaxed text-muted">{role.description}</p>
                <ul className="mt-7 space-y-3">
                  {role.capabilities.map((capability) => (
                    <CapabilityItem key={capability}>{capability}</CapabilityItem>
                  ))}
                </ul>
                <div className="mt-8">
                  <ButtonLink href={role.href} variant="secondary">
                    {role.cta} →
                  </ButtonLink>
                </div>
              </div>

              <div className="lg:col-span-7">
                <BrowserFrame label={role.previewLabel}>
                  <Preview />
                </BrowserFrame>
                <IllustrativeNote />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
