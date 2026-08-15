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
  IconAudit,
  IconCalendar,
  IconDeliverable,
  IconInsight,
  IconLearning,
  IconOverview,
  IconReport,
  IconSettings,
  IconUniversity,
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
  { href: "/admin/dashboard", label: "Overview", icon: IconOverview, group: "main" },
  { href: "/admin/universities", label: "Universities", icon: IconUniversity, group: "main" },
  { href: "/admin/staff", label: "Staff", icon: IconUsers, group: "main" },
  { href: "/admin/managers", label: "Managers", icon: IconUsers, group: "main" },
  { href: "/admin/instructors", label: "Instructors", icon: IconUser, group: "main" },
  { href: "/admin/analytics", label: "Analytics", icon: IconAnalytics, group: "intelligence" },
  { href: "/admin/insights", label: "AI Insights", icon: IconInsight, group: "intelligence" },
  { href: "/admin/reports", label: "Reports", icon: IconReport, group: "intelligence" },
  { href: "/admin/audit", label: "Audit Logs", icon: IconAudit, group: "admin" },
  { href: "/admin/settings", label: "Settings", icon: IconSettings, group: "admin" },
];

const MANAGER_NAV: NavItem[] = [
  { href: "/manager/dashboard", label: "Overview", icon: IconOverview, group: "main" },
  { href: "/manager/instructors", label: "Instructors", icon: IconUsers, group: "main" },
  { href: "/manager/schedule", label: "Schedule", icon: IconCalendar, group: "main" },
  { href: "/manager/activities", label: "Workload", icon: IconActivity, group: "main" },
  { href: "/manager/deliverables", label: "Deliverables", icon: IconDeliverable, group: "main" },
  { href: "/manager/analytics", label: "Analytics", icon: IconAnalytics, group: "intelligence" },
  { href: "/manager/insights", label: "AI Insights", icon: IconInsight, group: "intelligence" },
  { href: "/manager/tracker", label: "Weekly Tracker", icon: IconReport, group: "intelligence" },
  { href: "/manager/reports", label: "Reports", icon: IconReport, group: "intelligence" },
  { href: "/manager/settings", label: "Settings", icon: IconSettings, group: "admin" },
];

const INSTRUCTOR_NAV: NavItem[] = [
  { href: "/instructor/dashboard", label: "Today", icon: IconOverview, group: "main" },
  { href: "/instructor/schedule", label: "Schedule", icon: IconCalendar, group: "main" },
  { href: "/instructor/activities", label: "Activities", icon: IconActivity, group: "main" },
  { href: "/instructor/learning", label: "Learning", icon: IconLearning, group: "main" },
  { href: "/instructor/deliverables", label: "Deliverables", icon: IconDeliverable, group: "main" },
  { href: "/instructor/report", label: "My Report", icon: IconReport, group: "intelligence" },
  { href: "/instructor/analytics", label: "Analytics", icon: IconAnalytics, group: "intelligence" },
  { href: "/instructor/profile", label: "Profile", icon: IconUser, group: "admin" },
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
