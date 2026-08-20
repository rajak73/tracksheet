/**
 * Which broad categories are time spent WITH STUDENTS.
 *
 * Lives in `src/domain` because both halves of the app have to give the same
 * answer: the admin network endpoint adds these hours up on the server, the
 * instructor's sheet adds them up in the browser, and a minute of difference
 * between them is a bug the client would find before we did.
 *
 * ── Why this exists at all ────────────────────────────────────────────────
 * Working Hours counts student-facing time, and that answer normally comes
 * from the DELIVERABLE, which is where the distinction was written down: an
 * Exam counts its evaluations and not its question-paper preparation.
 *
 * But an entry does not always carry a deliverable. The parser picks one from
 * a closed list and sometimes there is nothing in the sentence to pick — and
 * when that happened the hours simply vanished from Working Hours, because
 * "no deliverable" was being read as "does not count". Three lectures, twelve
 * and three quarter hours of real teaching, disappeared that way. A lecture is
 * time in front of students whether or not anyone managed to name a
 * deliverable for it.
 *
 * So this is the fallback, and only the fallback: when a deliverable IS
 * present it still decides, because it is the more specific statement.
 *
 * ── The list ──────────────────────────────────────────────────────────────
 * Straight from the rule as given: time where there is interaction with
 * students — classes, practicals, doubt solving, mentoring, help, and
 * conducting exams. Everything else is real work that is not this measure:
 * preparation, meetings, reporting, admin, the instructor's own learning and
 * research. Codes, not labels, because labels were renamed once already
 * (TEACHING now reads "Lecture") and will be renamed again.
 */
const STUDENT_FACING = new Set([
  "TEACHING", // Lecture
  "PRACTICAL_LAB", // Practice
  "ASSESSMENT", // Exam — conducting and evaluating
  "MENTORING",
  "STUDENT_SUPPORT", // doubt solving, academic help
  "TRAINING_WORKSHOP", // workshops run FOR students
]);

/**
 * Does an hour in this category count toward Working Hours when nothing more
 * specific is known?
 */
export function isStudentFacingCategory(activityTypeCode: string): boolean {
  return STUDENT_FACING.has(activityTypeCode);
}

/**
 * The one rule, in one place: a deliverable answers if there is one, otherwise
 * the category does. Both sheets, the dashboard and the client's tracker read
 * Working Hours through this, so they cannot disagree.
 */
export function countsAsWorkingHours(
  activityTypeCode: string,
  deliverableIsCountable: boolean | null | undefined,
): boolean {
  return deliverableIsCountable ?? isStudentFacingCategory(activityTypeCode);
}

/**
 * Statuses that mean the activity did NOT happen.
 *
 * Working Hours is time spent with students, so a session marked MISSED or
 * EXCUSED is not any of it. This was left out when the rule was written down:
 * the queries behind Working Hours filtered no status at all, while the
 * analytics engine has always excluded these two from `recordedHours`. The
 * result was the impossible pair — a lecture set to MISSED showed 2h of
 * "Working hours" beside 0h of "Recorded hours" on the same row, with Working
 * Hours, a subset by definition, larger than the total it is a subset of.
 *
 * Exported as a plain array so it can be handed straight to a Prisma
 * `notIn` and there is still one list rather than one per query.
 */
export const DID_NOT_HAPPEN = ["MISSED", "EXCUSED"] as const;


/**
 * The shape any reader needs to answer "does this entry's time count?".
 *
 * Structural rather than a named model, so a route handler's Prisma row and a
 * component's props both satisfy it without either importing the other's types.
 */
export type CountableEntry = {
  /** COMPLETED / LATE / MISSED / EXCUSED. Absent on rows written before it existed. */
  status?: string | null;
  activityType: { code: string };
  deliverableType?: { isCountable: boolean } | null;
};

/**
 * Did this entry happen at all?
 *
 * MISSED and EXCUSED did not, and they are excluded from every hours total.
 * This lived only inside `rollUp`, so the readers that did not go through
 * `rollUp` — the week sheet and the calendar heading — counted a lecture nobody
 * gave. `status` was on the type and read by nothing.
 */
export function didHappen(entry: CountableEntry): boolean {
  return !entry.status || !(DID_NOT_HAPPEN as readonly string[]).includes(entry.status);
}

/**
 * Both questions, in the order the report asks them: did it happen, and was it
 * spent with students. This is what "Working Hours" means anywhere it is
 * printed, so anything printing that phrase should be adding up the entries
 * this returns true for.
 */
export function countsAsWorking(entry: CountableEntry): boolean {
  return (
    didHappen(entry) &&
    countsAsWorkingHours(
      entry.activityType.code,
      entry.deliverableType ? entry.deliverableType.isCountable : null,
    )
  );
}
