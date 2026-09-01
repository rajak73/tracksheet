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
  /* Three items: is the institute recording its day, who are the people, and
   * how is the tenant configured.
   *
   * ── Why one Employees list and not Managers + Instructors ───────────────
   * They were two sidebar entries onto the same population, split by a field
   * that is a COLUMN — and a filter — on either of them. An admin thinks
   * "find Priya", not "find Priya, who is a manager, therefore the second
   * list"; getting it wrong meant a search that returned nothing on a screen
   * that looked right. One list, with Role beside Status and University, is
   * what a staff console normally is.
   *
   * Both detail pages survive and are still linked from the rows and the
   * breadcrumbs — /admin/managers/[id] for a roster and its weekly report,
   * /admin/instructors/[id] for one person's days. What they stopped being is
   * places you START from.
   *
   * Broad Category moved with the list: it is SUPPLIED on the client's report
   * rather than derived, so somebody has to be able to set it, and it is now
   * editable on the Employees row instead of only on the directory that left
   * the sidebar.
   *
   * Universities, Reports and Insights are unchanged and still reachable from
   * the context where they mean something. Activity Tracker, Audit Logs and
   * Analytics were removed outright: they restated what Dashboard and the
   * university pages already show, in a vocabulary the rest of the product had
   * moved off. The audit trail itself is untouched — thirty-two server paths
   * still write it and `GET /api/universities/[id]/audit` still serves it. */
  { href: "/admin/dashboard", label: "Dashboard", icon: IconOverview, group: "main" },
  { href: "/admin/staff", label: "Employees", icon: IconUsers, group: "main" },
  /* The same sheet the manager reads, scoped to the whole network by the
     server rather than by a second page — see `WorklogScreen`. Day, Week and
     Month all work here as they do there. */
  { href: "/admin/worklog", label: "Worklog", icon: IconActivity, group: "main" },
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
  /* The instructor's home. It replaced the dashboard rather than sitting beside
   * it — two screens showing one person their own day is one screen too many,
   * and /instructor/dashboard now redirects here. */
  { href: "/instructor/worklog", label: "Work Log", icon: IconOverview, group: "main" },
  
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
