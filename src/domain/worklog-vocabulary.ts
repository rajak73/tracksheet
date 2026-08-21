/**
 * The words the client's report is written in.
 *
 * ── Why a closed list and not the taxonomy's own labels ───────────────────
 * The database taxonomy is what an activity IS for the purposes of counting it:
 * `LECTURE`, `STUDENT_QUERY_RESOLUTION`, `SLIDES`. Those codes are load-bearing
 * — foreign keys, rollups, countability — and they are not going to change.
 *
 * What the client's sheet prints is a different thing: the name a manager reads.
 * They supplied that list themselves, down to the wording, and it does not line
 * up with the taxonomy one-for-one. "Student Query Resolution" is a schema
 * label; "Doubt Clearing" is what the client's report says. Trying to make one
 * list serve both purposes would mean either renaming schema rows to suit a
 * report or printing schema names at a manager, and both are worse than a map.
 *
 * ── Why the quantity unit lives here too ──────────────────────────────────
 * Because the unit is a property of the activity, not of the number. The client
 * asked for "1 Class, 1 Doubt Session, 12 Assignments, 1 Department Meeting,
 * 1 Slide Preparation Task" — five different units in one cell, each determined
 * by what the work was. Pluralising the activity name produced "1 Doubt
 * Clearings". Keeping the pair together is what makes the cell read like their
 * example instead of like a machine's.
 *
 * ── The list is closed on purpose ─────────────────────────────────────────
 * A model asked for "a short professional name" answers "Live Class" today and
 * "Live Classes"/"Class Delivery"/"Teaching Session" on the next three days, and
 * the client's monthly sheet groups by this column. Offering the list and
 * refusing anything outside it is what makes the column groupable at all.
 */

export type Activity = {
  /** Exactly as the client wrote it. Printed in the Deliverable column. */
  readonly name: string;
  /** The unit one of these counts as: "1 Class", "1 Doubt Session". */
  readonly unit: string;
  /** The plural, for counts above one: "12 Assignments". */
  readonly units: string;
};

/**
 * The client's own list, in their order.
 *
 * `unit`/`units` are chosen to match the examples they gave — "1 Class",
 * "1 Doubt Session", "12 Assignments", "1 Department Meeting", "1 Slide
 * Preparation Task", "3 Students Mentored", "6 Capstone Reports".
 */
export const ACTIVITIES: readonly Activity[] = [
  { name: "Live Class", unit: "Class", units: "Classes" },
  { name: "Lecture", unit: "Lecture", units: "Lectures" },
  { name: "Lab Session", unit: "Lab Session", units: "Lab Sessions" },
  { name: "Doubt Clearing", unit: "Doubt Session", units: "Doubt Sessions" },
  { name: "Student Mentoring", unit: "Student Mentored", units: "Students Mentored" },
  { name: "Assignment Evaluation", unit: "Assignment", units: "Assignments" },
  { name: "Assessment Evaluation", unit: "Assessment", units: "Assessments" },
  { name: "Capstone Review", unit: "Capstone Report", units: "Capstone Reports" },
  { name: "Project Review", unit: "Project Reviewed", units: "Projects Reviewed" },
  { name: "Lesson Preparation", unit: "Lesson Plan", units: "Lesson Plans" },
  { name: "Content Preparation", unit: "Content Preparation Task", units: "Content Preparation Tasks" },
  { name: "Slide Preparation", unit: "Slide Preparation Task", units: "Slide Preparation Tasks" },
  { name: "Department Meeting", unit: "Department Meeting", units: "Department Meetings" },
  { name: "Academic Meeting", unit: "Academic Meeting", units: "Academic Meetings" },
  { name: "Faculty Meeting", unit: "Faculty Meeting", units: "Faculty Meetings" },
  { name: "Curriculum Planning", unit: "Curriculum Planning Task", units: "Curriculum Planning Tasks" },
  { name: "Student Support", unit: "Student Support Session", units: "Student Support Sessions" },
  { name: "Interview Preparation", unit: "Interview Preparation Session", units: "Interview Preparation Sessions" },
  { name: "Mock Interview", unit: "Mock Interview", units: "Mock Interviews" },
  { name: "Placement Support", unit: "Placement Support Session", units: "Placement Support Sessions" },
  { name: "Documentation", unit: "Documentation Task", units: "Documentation Tasks" },
  { name: "Reporting", unit: "Report", units: "Reports" },
  { name: "Administrative Work", unit: "Administrative Task", units: "Administrative Tasks" },
  { name: "Training Session", unit: "Training Session", units: "Training Sessions" },
  { name: "Practice Session", unit: "Practice Session", units: "Practice Sessions" },
  { name: "Revision Session", unit: "Revision Session", units: "Revision Sessions" },
] as const;

/** The name used when nothing in the list fits. Never invented, never blank. */
export const FALLBACK_ACTIVITY: Activity = {
  name: "Administrative Work",
  unit: "Administrative Task",
  units: "Administrative Tasks",
};

const BY_NAME = new Map(ACTIVITIES.map((a) => [a.name.toLowerCase(), a]));

/** The client's activity of that exact name, or null. Case-insensitive only. */
export function activityNamed(name: string): Activity | null {
  return BY_NAME.get(name.trim().toLowerCase()) ?? null;
}

/**
 * Which of the client's names a taxonomy deliverable is called in the report.
 *
 * ── This is the deterministic path, and it has to be as good as the model's ──
 * When the model is unreachable the report is built from this map alone, and the
 * client sees the same column either way. So every deliverable in the seed has
 * an entry: a missing one would print the schema's own wording at a manager,
 * which is exactly what this module exists to prevent.
 *
 * Keyed by DeliverableType code, then by ActivityType code for the rows that
 * carry no deliverable.
 */
const BY_DELIVERABLE: Readonly<Record<string, string>> = {
  /* Teaching. "Live Class" rather than "Lecture" for the ordinary case: it is
   * the name the client used for "took DSA lecture" in their own example. */
  LECTURE: "Live Class",
  CLASS_SESSION: "Live Class",
  GUEST_LECTURE: "Lecture",
  TUTORIAL: "Practice Session",
  REVISION_SESSION: "Revision Session",

  PRACTICAL_SESSION: "Lab Session",
  LAB_SESSION: "Lab Session",
  LAB_DEMONSTRATION: "Lab Session",
  LAB_EVALUATION: "Assessment Evaluation",

  STUDENT_MENTORING: "Student Mentoring",
  ACADEMIC_GUIDANCE: "Student Mentoring",
  CAREER_GUIDANCE: "Placement Support",
  PROJECT_GUIDANCE: "Project Review",

  STUDENT_QUERY_RESOLUTION: "Doubt Clearing",
  COUNSELLING: "Student Support",
  STUDENT_FOLLOW_UP: "Student Support",
  ACADEMIC_SUPPORT: "Student Support",

  ASSIGNMENT_EVALUATION: "Assignment Evaluation",
  EXAM_EVALUATION: "Assessment Evaluation",
  QUIZ_EVALUATION: "Assessment Evaluation",
  QUESTION_PAPER_PREPARATION: "Content Preparation",

  LECTURE_NOTES: "Lesson Preparation",
  COURSE_MATERIAL: "Content Preparation",
  QUESTION_BANK: "Content Preparation",
  ASSIGNMENT_CREATION: "Content Preparation",
  SLIDES: "Slide Preparation",

  DOCUMENTATION: "Documentation",
  REPORTING: "Reporting",
  DEPARTMENT_WORK: "Administrative Work",
  RECORD_MAINTENANCE: "Documentation",

  FACULTY_MEETING: "Faculty Meeting",
  DEPARTMENT_MEETING: "Department Meeting",
  STUDENT_MEETING: "Academic Meeting",
  PROJECT_MEETING: "Academic Meeting",

  TRAINING_SESSION: "Training Session",
  WORKSHOP: "Training Session",
  SEMINAR: "Training Session",
  ORIENTATION: "Training Session",

  LITERATURE_REVIEW: "Documentation",
  RESEARCH_ANALYSIS: "Documentation",
  EXPERIMENT: "Lab Session",
  RESEARCH_PAPER: "Documentation",
  DATA_ANALYSIS: "Reporting",

  UNCLASSIFIED_WORK: "Administrative Work",
};

/** For rows carrying no deliverable — the category alone has to answer. */
const BY_CATEGORY: Readonly<Record<string, string>> = {
  TEACHING: "Live Class",
  PRACTICAL_LAB: "Lab Session",
  MENTORING: "Student Mentoring",
  STUDENT_SUPPORT: "Student Support",
  ASSESSMENT: "Assessment Evaluation",
  CONTENT_DEVELOPMENT: "Content Preparation",
  ADMINISTRATIVE: "Administrative Work",
  MEETING: "Academic Meeting",
  TRAINING_WORKSHOP: "Training Session",
  RESEARCH: "Documentation",
  LEARNING: "Training Session",
  DELIVERABLE: "Reporting",
  DAILY_OPENING: "Administrative Work",
  DAILY_CLOSING: "Administrative Work",
  OTHER: "Administrative Work",
};

/**
 * The report name for one recorded activity.
 *
 * The deliverable decides when there is one, because it is the more specific
 * answer; the category decides otherwise. Never returns null — a row that
 * reached the database has to be printable.
 */
export function activityFor(
  deliverableCode: string | null | undefined,
  categoryCode: string | null | undefined,
): Activity {
  const name =
    (deliverableCode ? BY_DELIVERABLE[deliverableCode] : undefined) ??
    (categoryCode ? BY_CATEGORY[categoryCode] : undefined);
  return (name ? activityNamed(name) : null) ?? FALLBACK_ACTIVITY;
}

/**
 * `1 Class`, `12 Assignments`.
 *
 * The client's rule is that a quantity is either a number they wrote or the
 * unit-of-one for that activity — never an estimate, and never a count of
 * something the activity merely involved (students, slides, topics).
 */
export function quantityPhrase(activity: Activity, quantity: number): string {
  const n = Math.max(1, Math.round(quantity));
  return `${n} ${n === 1 ? activity.unit : activity.units}`;
}
