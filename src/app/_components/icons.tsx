/**
 * The icon set.
 *
 * Written rather than installed. The spec asks for "one consistent icon
 * library already present in the project" — there was none, and pulling in a
 * general-purpose pack to draw the eighteen glyphs this product actually uses
 * would add far more weight than it earns (§38).
 *
 * Every icon is a 24-unit box, 1.5 stroke, round caps and joins, `currentColor`
 * only. That uniformity is the entire point: consistency here is not a matter
 * of taste but of the icons being generated from one set of constants, so a
 * later addition cannot arrive at a different weight.
 *
 * Icons are decorative by default (`aria-hidden`). An icon that carries meaning
 * on its own — an icon-only button — must be labelled by its container, which
 * `IconButton` in ui.tsx enforces.
 */

import type { SVGProps } from "react";

export type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  /** 16 for inline/table use, 20 for navigation and buttons, 24 for empty states. */
  size?: 16 | 20 | 24;
};

function Icon({ size = 16, children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

/* ── Navigation ────────────────────────────────────────────────────────── */

export const IconOverview = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="3" width="7" height="9" rx="1" />
    <rect x="14" y="3" width="7" height="5" rx="1" />
    <rect x="14" y="12" width="7" height="9" rx="1" />
    <rect x="3" y="16" width="7" height="5" rx="1" />
  </Icon>
);

export const IconUniversity = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 21h18" />
    <path d="M12 3 3 8h18l-9-5Z" />
    <path d="M5 21V11m4.5 10V11m5 10V11M19 21V11" />
  </Icon>
);

export const IconUsers = (p: IconProps) => (
  <Icon {...p}>
    <path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20" />
    <circle cx="10" cy="8" r="3.25" />
    <path d="M20 20v-1.5a3.5 3.5 0 0 0-2.75-3.42M15.5 5.13a3.25 3.25 0 0 1 0 5.74" />
  </Icon>
);

export const IconUser = (p: IconProps) => (
  <Icon {...p}>
    <path d="M19 20v-1.5a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4V20" />
    <circle cx="12" cy="7.5" r="3.5" />
  </Icon>
);

export const IconAnalytics = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 3v16.5A1.5 1.5 0 0 0 4.5 21H21" />
    <path d="m7 15 3.5-4 3 2.5L20 6" />
  </Icon>
);

export const IconInsight = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 18h6" />
    <path d="M10 21h4" />
    <path d="M12 3a6 6 0 0 0-3.6 10.8c.5.4.85.95 1 1.55l.1.65h5l.1-.65c.15-.6.5-1.15 1-1.55A6 6 0 0 0 12 3Z" />
  </Icon>
);

export const IconReport = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
    <path d="M14 3v5h5" />
    <path d="M9 13h6M9 17h4" />
  </Icon>
);

export const IconAudit = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3 4 6v5.5c0 4.4 3.1 8.2 8 9.5 4.9-1.3 8-5.1 8-9.5V6l-8-3Z" />
    <path d="m9 12 2 2 4-4" />
  </Icon>
);

export const IconSettings = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5v2.2M12 19.3v2.2M4.7 4.7l1.6 1.6M17.7 17.7l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.7 19.3l1.6-1.6M17.7 6.3l1.6-1.6" />
  </Icon>
);

export const IconCalendar = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="5" width="17" height="16" rx="2" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Icon>
);

export const IconClock = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5.2l3.2 2" />
  </Icon>
);

export const IconActivity = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 12h4l2.5-7 4.5 14 2.5-7H21" />
  </Icon>
);

export const IconLearning = (p: IconProps) => (
  <Icon {...p}>
    <path d="m12 4 9 4.5-9 4.5-9-4.5L12 4Z" />
    <path d="M7 11v4.5c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5V11" />
    <path d="M21 8.5V14" />
  </Icon>
);

export const IconDeliverable = (p: IconProps) => (
  <Icon {...p}>
    <rect x="4" y="5" width="16" height="16" rx="2" />
    <path d="M9 3v4M15 3v4" />
    <path d="m9 13.5 2 2 4-4" />
  </Icon>
);

/* ── Interface ─────────────────────────────────────────────────────────── */

export const IconBell = (p: IconProps) => (
  <Icon {...p}>
    <path d="M18 8.5a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16s-2-1.5-2-6.5Z" />
    <path d="M13.7 19a2 2 0 0 1-3.4 0" />
  </Icon>
);

export const IconSearch = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.3-4.3" />
  </Icon>
);

export const IconClose = (p: IconProps) => (
  <Icon {...p}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Icon>
);

export const IconMenu = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
);

export const IconChevronRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="m9.5 5 7 7-7 7" />
  </Icon>
);

export const IconChevronDown = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5 9.5 7 7 7-7" />
  </Icon>
);

export const IconArrowUp = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 20V4M5.5 10.5 12 4l6.5 6.5" />
  </Icon>
);

export const IconArrowDown = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 4v16M18.5 13.5 12 20l-6.5-6.5" />
  </Icon>
);

export const IconPlus = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const IconDownload = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 4v11" />
    <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
    <path d="M4.5 19.5h15" />
  </Icon>
);

export const IconCheck = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </Icon>
);

export const IconAlert = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10.3 4.3 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9.5v4M12 16.8h.01" />
  </Icon>
);

export const IconInfo = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5M12 7.7h.01" />
  </Icon>
);

export const IconSignOut = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14 4.5h3.5A1.5 1.5 0 0 1 19 6v12a1.5 1.5 0 0 1-1.5 1.5H14" />
    <path d="M10 8.5 6 12l4 3.5M6 12h9" />
  </Icon>
);

export const IconEmpty = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 9.5 6 4.5h12l2.5 5" />
    <path d="M3.5 9.5h4.8l1.2 3h5l1.2-3h4.8v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-8Z" />
  </Icon>
);
