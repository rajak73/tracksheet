/**
 * Role navigation, defined once.
 *
 * Lives in a client module rather than in the three layouts because each entry
 * carries an icon COMPONENT, and a component reference cannot cross the
 * server/client boundary. Keeping it here has a second benefit: the three role
 * menus sit next to each other, so it is obvious when one has drifted.
 *
 * Every href points at a route that exists. There are deliberately no
 * placeholders — a nav item that leads nowhere is indistinguishable from a
 * broken one, and it is worse than an absent feature because it promises.
 */

import type { IconProps } from "@/app/_components/icons";
import {
  IconActivity,
  IconAnalytics,
  IconOverview,
  IconSettings,
  IconUser,
  IconUsers,
} from "@/app/_components/icons";

export type NavItem = {
  href: string;
  label: string;
  icon: (props: IconProps) => React.ReactElement;
  /** Items sharing a group are drawn together, separated from the next group. */
  group: "main" | "intelligence" | "admin";
};

export type Role = "ADMIN" | "MANAGER" | "INSTRUCTOR";

const ADMIN_NAV: NavItem[] = [
  // Four items. The admin's work is: see whether the institute is recording its
  // day (Dashboard), operate on the people who own rosters (Managers) and the
  // people on them (Instructors), and configure the tenant (Settings).
  // Universities, Staff, Reports and Insights all still exist and are still
  // reachable — from manager and university context, where they carry meaning —
  // but none of them is a destination an admin starts from, and a sidebar that
  // lists everything makes the ones that matter harder to find.
  //
  // Activity Tracker, Audit Logs and Analytics were removed outright rather
  // than demoted: the raw entry list and the analytics page both restated what
  // Dashboard and the university pages already show, in a vocabulary the rest
  // of the product had moved off — Analytics was still leading with a
  // utilization percentage over every recorded minute. The audit trail itself
  // is untouched: thirty-two server paths still write it, and
  // `GET /api/universities/[id]/audit` still serves it.
  { href: "/admin/dashboard", label: "Dashboard", icon: IconOverview, group: "main" },
  { href: "/admin/managers", label: "Managers", icon: IconUsers, group: "main" },
  // The instructor directory was reachable only by following a link from a
  // manager's page, which meant the one screen where an instructor's Broad
  // Category is set could not be found from the sidebar at all.
  { href: "/admin/instructors", label: "Instructors", icon: IconUser, group: "main" },
  { href: "/admin/settings", label: "Settings", icon: IconSettings, group: "admin" },
];

const MANAGER_NAV: NavItem[] = [
  // Two items. A manager's job is one team, not a tenant: how is my roster
  // doing, and what did they record.
  //
  // Worklog replaces Activity Tracker as the third item. They are not the same
  // screen: the tracker SEARCHES the log, which is what you do when you already
  // know what you are looking for. Worklog answers the question a manager
  // actually opens the product with — "who has not submitted?" — so it is the
  // one that belongs in the sidebar. The tracker still exists and is linked
  // from Worklog itself.
  //
  // Settings, Audit Logs and Instructors were dropped from the sidebar. A
  // manager configures nothing (the tenant's hours, holidays and thresholds are
  // the admin's), the audit trail is a compliance surface rather than a daily
  // one, and the roster is already on both remaining screens — the dashboard
  // lists every instructor's day and the worklog lists their recorded work, so
  // a third page whose answer is "here are their names" was a detour.
  //
  // Every PAGE and every authorisation rule is untouched: they remain reachable
  // by URL for anyone who needs them. This removes permanent distractions, not
  // capabilities. The account controls a manager does use (profile, change
  // password, sign out) live in the identity menu at the foot of the sidebar,
  // which is where the reference design puts them too.
  { href: "/manager/dashboard", label: "Dashboard", icon: IconOverview, group: "main" },
  { href: "/manager/worklog", label: "Worklog", icon: IconActivity, group: "main" },
];

const INSTRUCTOR_NAV: NavItem[] = [
  // Four items. An instructor's day is: where do I stand, log what I did, how
  // am I doing, and my own details. Schedule, Learning, Deliverables, Report
  // and Analytics all still exist and still work — they are reached from the
  // dashboard and the tracker, in context — but a person logging an hour of
  // work should not have to choose between eight destinations first.
  { href: "/instructor/dashboard", label: "Dashboard", icon: IconOverview, group: "main" },
  // The client's own design for writing up a day and reading back what was
  // written. Sits next to the dashboard rather than replacing it: the dashboard
  // is the week at a glance, this is the log.
  { href: "/instructor/worklog", label: "Work Log History", icon: IconActivity, group: "main" },
  {
    href: "/instructor/activity-tracker",
    label: "Activity Tracker",
    icon: IconActivity,
    group: "main",
  },
  { href: "/instructor/performance", label: "My Performance", icon: IconAnalytics, group: "main" },
  { href: "/instructor/settings", label: "Settings", icon: IconSettings, group: "admin" },
];

export const NAV_BY_ROLE: Record<Role, NavItem[]> = {
  ADMIN: ADMIN_NAV,
  MANAGER: MANAGER_NAV,
  INSTRUCTOR: INSTRUCTOR_NAV,
};

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Administrator",
  MANAGER: "Manager",
  INSTRUCTOR: "Instructor",
};
