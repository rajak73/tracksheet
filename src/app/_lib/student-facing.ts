/**
 * Which broad categories are time spent WITH STUDENTS.
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
