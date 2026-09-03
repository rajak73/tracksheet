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
 * `DailyRoutineBox` is still in the tree and has no caller. It is left rather
 * than removed while the instructor side settles: the week clock has no
 * equivalent on the new screen, and folding it in is easier from working code
 * than from a diff.
 *
 * `InstructorSheet` was kept on the same reasoning and has now been deleted,
 * because the reasoning stopped applying. It read `activityType.code` for its
 * category colours and merged its rows through `rollUp` — a payload shape and a
 * grouping that no longer exist. It was not working code any more; it was a
 * 463-line description of a data model the product has left, and reading a
 * month view out of it would have been slower than writing one. `WorklogNotices`
 * was removed earlier and is named here only because this note used to.
 */
export default function InstructorDashboardRedirect() {
  redirect("/instructor/worklog");
}
