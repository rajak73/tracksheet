"use client";

/**
 * The admin's worklog: every instructor, at every university.
 *
 * The same screen the manager reads, and deliberately so — `/api/manager/worklog`
 * already accepts an admin and returns the whole network for a global scope, so
 * the difference between the two is one line of copy rather than a second
 * implementation. Day, Week and Month all work here exactly as they do there.
 */

import { WorklogScreen } from "@/app/_components/WorklogScreen";

export default function AdminWorklogPage() {
  return <WorklogScreen description="Review and filter instructor activity across every university." />;
}
