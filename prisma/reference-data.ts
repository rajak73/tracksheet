/**
 * Reference data: rows the application needs in order to function at all, on
 * any database, in any environment.
 *
 * ── Why this is separate from the seed ─────────────────────────────────────
 * `ActivityType` is global reference data, not tenant data — the activity
 * taxonomy every ActivityLog points at, and the taxonomy the analytics engine
 * keys off. Until this module existed, the only code that created it lived
 * inside `prisma/seed.ts`, *after* fourteen `deleteMany()` calls. Production is
 * forbidden from running that seed, so a correctly-deployed production database
 * had zero activity types: `GET /api/activity-types` returned `[]` and logging
 * any activity failed with `ACTIVITY_TYPE_NOT_FOUND`. The schema was perfect and
 * the product could not record a single hour of work.
 *
 * So the definitions live here, and both callers consume them: the development
 * seed, and the operator command `npm run db:reference-data`. One source of
 * truth, and the production path never touches the destructive seed.
 *
 * ── Why upsert, never delete ───────────────────────────────────────────────
 * Activity types are referenced by historical `ActivityLog` rows. Recreating
 * them would change their ids and orphan that history, so provisioning matches
 * on the natural key (`code`) and updates in place. Rows this module does not
 * define are left completely alone: it never deletes anything.
 */

export type ActivityTypeDefinition = {
  code: string;
  label: string;
  description?: string;
  sortOrder: number;
  isOncePerDay?: boolean;
  isDerivedFromWorkingHours?: boolean;
  countsAsProductive?: boolean;
  isUnutilized?: boolean;
};

/**
 * ── Three of these are named after the client's own session vocabulary ─────
 * Their scheduling system knows five session types — LECTURE, PRACTICE, EXAM,
 * BREAK and OTHER — and three of ours are the same thing under a different
 * word, so they now carry the client's word: Teaching reads "Lecture",
 * Practical / Lab reads "Practice", Assessment reads "Exam". A report that
 * calls the same activity two names is a report somebody has to reconcile.
 *
 * The CODES are unchanged on purpose. They are internal — never shown, and
 * referenced by the parser's closed list, by `ENTRY_CATEGORY_CODES` and as the
 * parent of all 44 deliverables — so renaming them would be a migration and a
 * reseed to change nothing anybody can see.
 *
 * BREAK is deliberately absent. It is a scheduled gap between sessions, not
 * work; offering it as something to log would let time that is not work be
 * written down as hours, and utilisation is computed from those hours.
 *
 * The other eight have no equivalent on their side at all — mentoring, content
 * preparation, meetings, admin, research, student support. That is not an
 * oversight in this list; it is the gap this product exists to fill, because
 * their session data only covers what happens in front of a student.
 *
 * The activity taxonomy. Held as DATA so adding a type is an insert, not a
 * migration. Downstream logic keys off the behavioural flags rather than the
 * code — except `DAILY_OPENING`, which the engine names directly when it
 * measures opening compliance.
 *
 * MISSING_DATA is deliberately absent: it is the absence of any record over a
 * window the university expected to be covered, so it is computed, never stored
 * (Phase 0 §3.5). Adding it here would let "we don't know" be written down as
 * if it were an observation.
 */
export const ACTIVITY_TYPES: ActivityTypeDefinition[] = [
  {
    code: "DAILY_OPENING",
    label: "Daily Opening",
    description: "Once-per-working-day opening routine, derived from the university's hours.",
    sortOrder: 10,
    isOncePerDay: true,
    isDerivedFromWorkingHours: true,
  },
  { code: "TEACHING", label: "Lecture", sortOrder: 20 },
  { code: "LEARNING", label: "Learning", sortOrder: 30 },
  { code: "STUDENT_SUPPORT", label: "Student Support", sortOrder: 40 },
  { code: "ADMINISTRATIVE", label: "Administrative", sortOrder: 50 },
  { code: "MEETING", label: "Meeting", sortOrder: 60 },
  { code: "DELIVERABLE", label: "Deliverable Work", sortOrder: 70 },
  { code: "RESEARCH", label: "Research", sortOrder: 80 },
  // ── The five the BRD's taxonomy adds ──────────────────────────────────────
  // Instructors already described this work; it was landing under OTHER or
  // TEACHING because there was nowhere better for it to go. Naming these makes
  // the free-text parser able to classify honestly instead of approximately.
  // Added rather than substituted: DAILY_OPENING, DAILY_CLOSING and UNUTILIZED
  // are derived by the working-hours engine and carry opening/closing
  // compliance, and LEARNING and DELIVERABLE carry the deliverable-hours split
  // the tracker and every analytics surface read. Those five are not entry
  // categories and were never the BRD's to replace.
  { code: "PRACTICAL_LAB", label: "Practice", sortOrder: 22 },
  { code: "MENTORING", label: "Mentoring", sortOrder: 24 },
  { code: "ASSESSMENT", label: "Exam", sortOrder: 44 },
  { code: "CONTENT_DEVELOPMENT", label: "Content Development", sortOrder: 46 },
  { code: "TRAINING_WORKSHOP", label: "Training / Workshop", sortOrder: 64 },
  { code: "OTHER", label: "Other", sortOrder: 90 },
  {
    code: "DAILY_CLOSING",
    label: "Daily Closing",
    description: "Once-per-working-day closing routine, derived from the university's hours.",
    sortOrder: 100,
    isOncePerDay: true,
    isDerivedFromWorkingHours: true,
  },
  {
    code: "UNUTILIZED",
    label: "Unutilized Time",
    description: "Known idle time. Distinct from missing data, which is never recorded.",
    sortOrder: 110,
    countsAsProductive: false,
    isUnutilized: true,
  },
];

/**
 * The deliverables inside each broad category — the BRD's own taxonomy.
 *
 * ── Why this is a closed list ─────────────────────────────────────────────
 * The free-text parser is allowed to emit ONE of these codes and nothing else.
 * Left as free text, "Lecture", "lecture" and "Lec" become three deliverables
 * and the sheet's quantity column stops adding up — which is the one number the
 * client's spreadsheet has always been read for. A foreign key to this table is
 * what makes an invented deliverable unwritable rather than merely discouraged.
 *
 * ── Where the words come from ─────────────────────────────────────────────
 * Section 12 of the BRD, verbatim. Nothing here was chosen by the engineering
 * side: this is client vocabulary, and inventing an extra one would put a word
 * in their report that nobody in their organisation uses.
 *
 * OTHER carries a single deliverable so that "unclassified" is still a real,
 * countable row rather than a null that quietly disappears from the sheet.
 */
export type DeliverableTypeDefinition = {
  code: string;
  label: string;
  /** The broad category it belongs under. */
  activityTypeCode: string;
  /** Whether a count of this means anything. Absent means yes. */
  countable?: boolean;
};

/* ── Which of these can be COUNTED ────────────────────────────────────────
 * The client's sheet reports every kind of work's hours but counts only some:
 * "12 Classes, 6 Assignments, 3 Doubt Sessions" sat beside a list that also
 * contained Lesson Prep and Meetings/Reports. Their rule, applied across all
 * five sample rows without exception, is that PREPARATION, MEETINGS, REPORTING
 * and ADMIN are effort — hours yes, units no.
 *
 * Followed literally here, including where a stricter reading is arguable:
 * Question Paper Preparation is a discrete artefact one could count, but it is
 * preparation, and matching the client's own rule matters more than my sense
 * of what is discrete. Everything delivered to a student — classes, labs,
 * evaluations, mentoring, doubt sessions, workshops — is countable.
 */
export const DELIVERABLE_TYPES: DeliverableTypeDefinition[] = [
  // Teaching
  { code: "LECTURE", label: "Lecture", activityTypeCode: "TEACHING" },
  { code: "TUTORIAL", label: "Tutorial", activityTypeCode: "TEACHING" },
  { code: "CLASS_SESSION", label: "Class Session", activityTypeCode: "TEACHING" },
  { code: "GUEST_LECTURE", label: "Guest Lecture", activityTypeCode: "TEACHING" },
  { code: "REVISION_SESSION", label: "Revision Session", activityTypeCode: "TEACHING" },

  // Practical / Lab
  { code: "PRACTICAL_SESSION", label: "Practical Session", activityTypeCode: "PRACTICAL_LAB" },
  { code: "LAB_SESSION", label: "Lab Session", activityTypeCode: "PRACTICAL_LAB" },
  { code: "LAB_DEMONSTRATION", label: "Lab Demonstration", activityTypeCode: "PRACTICAL_LAB" },
  { code: "LAB_EVALUATION", label: "Lab Evaluation", activityTypeCode: "PRACTICAL_LAB" },

  // Mentoring
  { code: "STUDENT_MENTORING", label: "Student Mentoring", activityTypeCode: "MENTORING" },
  { code: "ACADEMIC_GUIDANCE", label: "Academic Guidance", activityTypeCode: "MENTORING" },
  { code: "CAREER_GUIDANCE", label: "Career Guidance", activityTypeCode: "MENTORING" },
  { code: "PROJECT_GUIDANCE", label: "Project Guidance", activityTypeCode: "MENTORING" },

  // Research
  { code: "LITERATURE_REVIEW", label: "Literature Review", activityTypeCode: "RESEARCH", countable: false },
  { code: "RESEARCH_ANALYSIS", label: "Research Analysis", activityTypeCode: "RESEARCH", countable: false },
  { code: "EXPERIMENT", label: "Experiment", activityTypeCode: "RESEARCH" },
  { code: "RESEARCH_PAPER", label: "Research Paper", activityTypeCode: "RESEARCH" },
  { code: "DATA_ANALYSIS", label: "Data Analysis", activityTypeCode: "RESEARCH", countable: false },

  // Assessment
  { code: "ASSIGNMENT_EVALUATION", label: "Assignment Evaluation", activityTypeCode: "ASSESSMENT" },
  { code: "EXAM_EVALUATION", label: "Exam Evaluation", activityTypeCode: "ASSESSMENT" },
  { code: "QUESTION_PAPER_PREPARATION", label: "Question Paper Preparation", activityTypeCode: "ASSESSMENT", countable: false },
  { code: "QUIZ_EVALUATION", label: "Quiz Evaluation", activityTypeCode: "ASSESSMENT" },

  // Content Development
  { code: "LECTURE_NOTES", label: "Lecture Notes", activityTypeCode: "CONTENT_DEVELOPMENT", countable: false },
  { code: "COURSE_MATERIAL", label: "Course Material", activityTypeCode: "CONTENT_DEVELOPMENT", countable: false },
  { code: "QUESTION_BANK", label: "Question Bank", activityTypeCode: "CONTENT_DEVELOPMENT", countable: false },
  { code: "ASSIGNMENT_CREATION", label: "Assignment Creation", activityTypeCode: "CONTENT_DEVELOPMENT", countable: false },
  { code: "SLIDES", label: "Slides", activityTypeCode: "CONTENT_DEVELOPMENT", countable: false },

  // Administrative
  { code: "DOCUMENTATION", label: "Documentation", activityTypeCode: "ADMINISTRATIVE", countable: false },
  { code: "REPORTING", label: "Reporting", activityTypeCode: "ADMINISTRATIVE", countable: false },
  { code: "DEPARTMENT_WORK", label: "Department Work", activityTypeCode: "ADMINISTRATIVE", countable: false },
  { code: "RECORD_MAINTENANCE", label: "Record Maintenance", activityTypeCode: "ADMINISTRATIVE", countable: false },

  // Meetings
  { code: "FACULTY_MEETING", label: "Faculty Meeting", activityTypeCode: "MEETING", countable: false },
  { code: "DEPARTMENT_MEETING", label: "Department Meeting", activityTypeCode: "MEETING", countable: false },
  { code: "STUDENT_MEETING", label: "Student Meeting", activityTypeCode: "MEETING", countable: false },
  { code: "PROJECT_MEETING", label: "Project Meeting", activityTypeCode: "MEETING", countable: false },

  // Training / Workshop
  { code: "TRAINING_SESSION", label: "Training Session", activityTypeCode: "TRAINING_WORKSHOP" },
  { code: "WORKSHOP", label: "Workshop", activityTypeCode: "TRAINING_WORKSHOP" },
  { code: "SEMINAR", label: "Seminar", activityTypeCode: "TRAINING_WORKSHOP" },
  { code: "ORIENTATION", label: "Orientation", activityTypeCode: "TRAINING_WORKSHOP" },

  // Student Support
  { code: "STUDENT_QUERY_RESOLUTION", label: "Student Query Resolution", activityTypeCode: "STUDENT_SUPPORT" },
  { code: "COUNSELLING", label: "Counselling", activityTypeCode: "STUDENT_SUPPORT" },
  { code: "STUDENT_FOLLOW_UP", label: "Student Follow-up", activityTypeCode: "STUDENT_SUPPORT" },
  { code: "ACADEMIC_SUPPORT", label: "Academic Support", activityTypeCode: "STUDENT_SUPPORT" },

  // Other
  { code: "UNCLASSIFIED_WORK", label: "Custom or unclassified work", activityTypeCode: "OTHER", countable: false },
];

export const DELIVERABLE_TYPE_COUNT = DELIVERABLE_TYPES.length;
export const DELIVERABLE_TYPE_CODES = DELIVERABLE_TYPES.map((d) => d.code);

/**
 * The categories an instructor's free text may be classified into.
 *
 * The BRD's eleven. Deliberately NOT every ActivityType: DAILY_OPENING and
 * DAILY_CLOSING are derived from the university's hours rather than written by
 * anybody, and UNUTILIZED is computed idle time. Offering them to the parser
 * would let a sentence overwrite something the engine is supposed to derive.
 */
export const ENTRY_CATEGORY_CODES = [
  "TEACHING",
  "PRACTICAL_LAB",
  "MENTORING",
  "RESEARCH",
  "ASSESSMENT",
  "CONTENT_DEVELOPMENT",
  "ADMINISTRATIVE",
  "MEETING",
  "TRAINING_WORKSHOP",
  "STUDENT_SUPPORT",
  "OTHER",
] as const;

/* ── What an instructor teaches ───────────────────────────────────────────── */

/* The instructor-category list is gone. Its values were Technical,
 * Mathematics, English, Aptitude, Physics, Chemistry and Others — subjects,
 * which is to say kinds of work. Nothing in the product offers anybody a list
 * of those to choose from now, and the fifteen assignments that existed are in
 * `archive/instructor-assigned-category-20260902.json`.
 */


/** How many rows a fully provisioned database must have. */
export const ACTIVITY_TYPE_COUNT = ACTIVITY_TYPES.length;

/** Every canonical code, for callers that need to assert coverage. */
export const ACTIVITY_TYPE_CODES = ACTIVITY_TYPES.map((t) => t.code);

/** The columns this module owns. Anything not listed here is left as found. */
function canonicalFields(type: ActivityTypeDefinition) {
  return {
    label: type.label,
    description: type.description ?? null,
    sortOrder: type.sortOrder,
    isSystem: true,
    isOncePerDay: type.isOncePerDay ?? false,
    isDerivedFromWorkingHours: type.isDerivedFromWorkingHours ?? false,
    countsAsProductive: type.countsAsProductive ?? true,
    isUnutilized: type.isUnutilized ?? false,
  };
}

/** Anything Prisma-shaped: the real client, or a transaction client in tests. */
type Db = {
  activityType: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findMany(args: any): Promise<Array<{ code: string }>>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    upsert(args: any): Promise<{ id: string; code: string }>;
  };
  deliverableType: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findMany(args: any): Promise<Array<{ code: string }>>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    upsert(args: any): Promise<{ id: string; code: string }>;
  };
};

export type ProvisionResult = {
  /** Codes this run inserted. */
  created: string[];
  /** Codes that already existed and were reconciled in place. */
  updated: string[];
};

/**
 * Brings the activity taxonomy up to date, idempotently.
 *
 * Safe on a fresh database, on one that is already fully provisioned, and on
 * anything in between. It inserts what is missing and reconciles what is
 * present; an existing row keeps its id, so historical activity goes on
 * pointing at the same type. It deletes nothing under any code path.
 */
export async function provisionActivityTypes(db: Db): Promise<ProvisionResult> {
  // One read up front purely so the caller can be told what changed. The upsert
  // below is the thing that matters and would be correct without it.
  const present = new Set(
    (
      await db.activityType.findMany({
        where: { code: { in: ACTIVITY_TYPE_CODES } },
        select: { code: true },
      })
    ).map((row) => row.code),
  );

  const created: string[] = [];
  const updated: string[] = [];

  for (const type of ACTIVITY_TYPES) {
    const fields = canonicalFields(type);
    try {
      await db.activityType.upsert({
        where: { code: type.code },
        create: { code: type.code, ...fields },
        update: fields,
      });
    } catch (e) {
      throw new Error(
        `Could not provision activity type "${type.code}": ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
    (present.has(type.code) ? updated : created).push(type.code);
  }

  return { created, updated };
}

/**
 * Brings the deliverable taxonomy up to date, idempotently.
 *
 * Runs AFTER the categories, because every deliverable points at one and a
 * deliverable whose category does not exist yet cannot be written — the foreign
 * key says so, which is the point of having it.
 *
 * Like the categories, this deletes nothing. A deliverable that disappears from
 * the BRD stops being offered by being marked inactive upstream, never by being
 * removed underneath the activity rows that reference it.
 */
export async function provisionDeliverableTypes(db: Db): Promise<ProvisionResult> {
  const categories = await db.activityType.findMany({
    where: { code: { in: [...new Set(DELIVERABLE_TYPES.map((d) => d.activityTypeCode))] } },
    select: { code: true, id: true },
  });
  const idByCode = new Map(
    (categories as Array<{ code: string; id?: string }>).map((c) => [c.code, c.id]),
  );

  const present = new Set(
    (
      await db.deliverableType.findMany({
        where: { code: { in: DELIVERABLE_TYPE_CODES } },
        select: { code: true },
      })
    ).map((row) => row.code),
  );

  const created: string[] = [];
  const updated: string[] = [];

  for (const [index, type] of DELIVERABLE_TYPES.entries()) {
    const activityTypeId = idByCode.get(type.activityTypeCode);
    if (!activityTypeId) {
      throw new Error(
        `Could not provision deliverable "${type.code}": its category ` +
          `"${type.activityTypeCode}" is missing. Provision activity types first.`,
      );
    }
    const fields = {
      label: type.label,
      activityTypeId,
      sortOrder: (index + 1) * 10,
      isActive: true,
      isCountable: type.countable ?? true,
    };
    try {
      await db.deliverableType.upsert({
        where: { code: type.code },
        create: { code: type.code, ...fields },
        update: fields,
      });
    } catch (e) {
      throw new Error(
        `Could not provision deliverable type "${type.code}": ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
    (present.has(type.code) ? updated : created).push(type.code);
  }

  return { created, updated };
}
