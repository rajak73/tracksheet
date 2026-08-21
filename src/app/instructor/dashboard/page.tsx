import { redirect } from "next/navigation";

/**
 * The instructor has one screen, and it is the work log.
 *
 * ── Why this is a redirect and not a deletion ─────────────────────────────
 * This route was the instructor's dashboard: the day written as sentences for a
 * model to read, a week clock, a month sheet. The client's design replaced all
 * of it with one table and a four-field form, so the screen is gone — but the
 * address is not, because it is in browser histories, in bookmarks, and in
 * whatever links were sent while it existed. Answering those with a redirect
 * costs nothing; answering them with a 404 makes somebody think the system
 * broke.
 *
 * The components it used — `InstructorSheet`, `DailyRoutineBox`,
 * `WorklogNotices` — are still in the tree and now have no caller. They are
 * left rather than removed while the instructor side settles: the month view
 * and the week clock have no equivalent on the new screen, and folding either
 * of them in is easier from working code than from a diff.
 */
export default function InstructorDashboardRedirect() {
  redirect("/instructor/worklog");
}
