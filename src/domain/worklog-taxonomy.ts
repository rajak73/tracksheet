/**
 * The closed list the client's report is written from.
 *
 * ── One list, three jobs ──────────────────────────────────────────────────
 * This is simultaneously the vocabulary offered to the model, the allow-list its
 * reply is checked against, and the names the report prints. They used to be
 * three lists — the database taxonomy for parsing, a separate display
 * vocabulary, and the prompt's own wording — and three lists that must agree is
 * three lists that will eventually disagree, in a column the client reconciles
 * by hand.
 *
 * ── What it is NOT ────────────────────────────────────────────────────────
 * It is not the database taxonomy. `ActivityType` and `DeliverableType` hold 11
 * categories and 44 deliverables, they carry foreign keys and rollups, and they
 * are not changing. This list is coarser and is what a manager reads; every
 * entry here names the stored codes it is printed for, so a row can always be
 * traced back to what was actually recorded.
 *
 * ── Counting is a property of the deliverable ─────────────────────────────
 * The client's rule turns on a distinction that has no expression in the
 * database: what the unit COUNTS.
 *
 *   occurrence  the entry IS one of them. "Attended the department meeting"
 *               is one meeting by definition, so a quantity of 1 is a fact
 *               rather than a guess, and no number needs to have been written.
 *
 *   items       the unit counts things handled, and "how many" is the whole
 *               point of the column. "Graded some assignments" with no number
 *               must never become "1 Assignment" — it must stay visibly
 *               unknown. See `UNSTATED`.
 *
 *   none        hours only. A quantity here would be invented whatever it was,
 *               so the column simply has no entry for it.
 *
 * ── Four mappings the client should settle ───────────────────────────────
 * Three people mapped the 44 stored deliverables onto these 21 independently,
 * and agreed everywhere except here. These are shipped as the least-wrong
 * reading available, NOT as settled answers:
 *
 *   LAB_EVALUATION     printed as Exam Evaluation, so its count lands on
 *                      "scripts". If instructors record students-at-the-bench
 *                      rather than scripts, the unit is wrong and the exam
 *                      total stops meaning exam season.
 *   STUDENT_MEETING    printed as Department Meeting, so meeting-with-a-student
 *                      inflates a governance count. A second client name —
 *                      "Meeting (Other)" — would close it.
 *   DEPARTMENT_WORK    printed as Documentation. Invigilation rosters,
 *                      admissions and accreditation are none of Meeting,
 *                      Reporting or Documentation, and in some months this is
 *                      the largest block outside teaching.
 *   RESEARCH_ANALYSIS  both printed as Literature Review, which says "read the
 *   DATA_ANALYSIS      literature" about somebody who spent the week analysing.
 *
 * That distinction is why `ActivityLog.quantity` is nullable. Null is not
 * missing data to be tidied away with a default; it is the client's `?`.
 */

/** How the quantity column treats one deliverable. */
export type Counting = "occurrence" | "items" | "none";

export type Deliverable = {
  /** Exactly as the client wrote it. Printed, and the only name the model may use. */
  readonly name: string;
  /** One of the client's eight. */
  readonly category: string;
  readonly counting: Counting;
  /** The counted thing: "Class", "Assignment", "Script". Empty when `none`. */
  readonly unit: string;
  readonly units: string;
  /**
   * The stored deliverable codes this is printed for.
   *
   * Several map to one on purpose — a Guest Lecture and a Class Session are both
   * a Live Class in a report a manager reads. The stored code keeps the finer
   * distinction for anyone who needs it.
   */
  readonly codes: readonly string[];
  /**
   * The stored ActivityType this is written under.
   *
   * Held here rather than looked up from the deliverable's parent, because
   * `Self-Learning` has no stored deliverable at all and still has to be
   * writable — and because it lets this module be read, and tested, without a
   * database in the way.
   */
  readonly dbCategory: string;
};

/** The client's eight, in their order. */
export const CATEGORIES = [
  "Teaching",
  "Assessment",
  "Mentoring / Student Support",
  "Research",
  "Content Development",
  "Administrative",
  "Training / Development",
  "Other",
] as const;

export const DELIVERABLES: readonly Deliverable[] = [
  /* ── Teaching ─────────────────────────────────────────────────────────── */
  {
    name: "Live Class",
    dbCategory: "TEACHING",
    category: "Teaching",
    counting: "occurrence",
    unit: "Class",
    units: "Classes",
    codes: ["LECTURE", "CLASS_SESSION", "GUEST_LECTURE"],
  },
  {
    name: "Tutorial",
    dbCategory: "TEACHING",
    category: "Teaching",
    counting: "occurrence",
    unit: "Tutorial",
    units: "Tutorials",
    // A revision session is a tutorial in everything but name: going back over
    // taught material with a group, rather than delivering it for the first time.
    codes: ["TUTORIAL", "REVISION_SESSION"],
  },
  {
    name: "Practical / Lab Session",
    dbCategory: "PRACTICAL_LAB",
    category: "Teaching",
    counting: "occurrence",
    unit: "Lab Session",
    units: "Lab Sessions",
    codes: ["PRACTICAL_SESSION", "LAB_SESSION", "LAB_DEMONSTRATION"],
  },

  /* ── Assessment ───────────────────────────────────────────────────────── */
  {
    name: "Assignment Evaluation",
    dbCategory: "ASSESSMENT",
    category: "Assessment",
    counting: "items",
    unit: "Assignment",
    units: "Assignments",
    codes: ["ASSIGNMENT_EVALUATION"],
  },
  {
    name: "Exam Evaluation",
    dbCategory: "ASSESSMENT",
    category: "Assessment",
    counting: "items",
    unit: "Script",
    units: "Scripts",
    codes: ["EXAM_EVALUATION", "QUIZ_EVALUATION"],
  },
  {
    /* Its own name, not Exam Evaluation's.
     *
     * It used to print as "Exam Evaluation → N Scripts", which put lab marking
     * into the exam-script total and made that total stop meaning exam season.
     * And because a lab evaluation with no count read as a Practical / Lab
     * Session instead, the SAME work landed in Assessment or in Teaching
     * depending on whether the instructor happened to write a number — a
     * category that moved with the phrasing. */
    name: "Lab Evaluation",
    dbCategory: "ASSESSMENT",
    category: "Assessment",
    counting: "items",
    /* Items evaluated — reports, records, submissions. Deliberately NOT
     * students: "graded the lab practicals for 20 students" is one number
     * counting a different thing, and reading it as twenty items evaluated is
     * the unit substitution this exists to prevent. */
    unit: "Lab Evaluation",
    units: "Lab Evaluations",
    codes: ["LAB_EVALUATION"],
  },
  {
    name: "Question Paper Preparation",
    dbCategory: "ASSESSMENT",
    category: "Assessment",
    counting: "items",
    unit: "Paper",
    units: "Papers",
    codes: ["QUESTION_PAPER_PREPARATION"],
  },

  /* ── Mentoring / Student Support ──────────────────────────────────────── */
  {
    name: "Doubt Clearing",
    dbCategory: "STUDENT_SUPPORT",
    category: "Mentoring / Student Support",
    counting: "occurrence",
    unit: "Doubt Session",
    units: "Doubt Sessions",
    codes: ["STUDENT_QUERY_RESOLUTION"],
  },
  {
    name: "Student Counselling",
    dbCategory: "STUDENT_SUPPORT",
    category: "Mentoring / Student Support",
    counting: "occurrence",
    unit: "Counselling Session",
    units: "Counselling Sessions",
    // Following a student up is the pastoral thread, not an academic question.
    // Career guidance is pastoral rather than academic — where somebody is
    // going, not what they got wrong. All three independent reviewers put it
    // here, against my first reading of it.
    codes: ["COUNSELLING", "STUDENT_FOLLOW_UP", "CAREER_GUIDANCE"],
  },
  {
    name: "Academic Guidance",
    dbCategory: "MENTORING",
    category: "Mentoring / Student Support",
    counting: "occurrence",
    unit: "Guidance Session",
    units: "Guidance Sessions",
    codes: ["ACADEMIC_GUIDANCE", "STUDENT_MENTORING", "ACADEMIC_SUPPORT", "PROJECT_GUIDANCE"],
  },

  /* ── Research ─────────────────────────────────────────────────────────── */
  {
    name: "Literature Review",
    dbCategory: "RESEARCH",
    category: "Research",
    counting: "none",
    unit: "",
    units: "",
    // Reading and reviewing existing sources. Nothing else.
    codes: ["LITERATURE_REVIEW"],
  },
  {
    /* The step between reading and writing, which had no name.
     *
     * Analysing data was landing on Experiment — which is item-counted, so it
     * demanded a count of experiments nobody ran and printed "? Experiments"
     * against somebody who ran none. Hours only, for the same reason Literature
     * Review is: "how many analyses" is not a number anybody records. */
    name: "Data Analysis",
    dbCategory: "RESEARCH",
    category: "Research",
    counting: "none",
    unit: "",
    units: "",
    codes: ["RESEARCH_ANALYSIS", "DATA_ANALYSIS"],
  },
  {
    name: "Experiment",
    dbCategory: "RESEARCH",
    category: "Research",
    counting: "items",
    unit: "Experiment",
    units: "Experiments",
    codes: ["EXPERIMENT"],
  },
  {
    name: "Research Paper",
    dbCategory: "RESEARCH",
    category: "Research",
    counting: "items",
    unit: "Paper",
    units: "Papers",
    codes: ["RESEARCH_PAPER"],
  },

  /* ── Content Development ──────────────────────────────────────────────── */
  {
    name: "Slide Preparation",
    dbCategory: "CONTENT_DEVELOPMENT",
    category: "Content Development",
    counting: "occurrence",
    unit: "Slide Preparation Task",
    units: "Slide Preparation Tasks",
    codes: ["SLIDES"],
  },
  {
    name: "Question Bank Creation",
    dbCategory: "CONTENT_DEVELOPMENT",
    category: "Content Development",
    counting: "occurrence",
    unit: "Question Bank Task",
    units: "Question Bank Tasks",
    codes: ["QUESTION_BANK"],
  },
  {
    name: "Course Material Development",
    dbCategory: "CONTENT_DEVELOPMENT",
    category: "Content Development",
    counting: "occurrence",
    unit: "Course Material Task",
    units: "Course Material Tasks",
    // Writing an assignment is producing material students work from; a
    // question bank is specifically a bank of questions, which is narrower.
    codes: ["COURSE_MATERIAL", "LECTURE_NOTES", "ASSIGNMENT_CREATION"],
  },

  /* ── Administrative ───────────────────────────────────────────────────── */
  {
    name: "Department Meeting",
    dbCategory: "MEETING",
    category: "Administrative",
    counting: "occurrence",
    unit: "Department Meeting",
    units: "Department Meetings",
    /* Governance only: faculty, department, and project meetings between
     * STAFF. Anything with a student in it goes to Meeting (Other) below, so
     * that "N Department Meetings" means what a manager reads it to mean. */
    codes: ["DEPARTMENT_MEETING", "FACULTY_MEETING"],
  },
  {
    /* Every meeting that is not governance.
     *
     * A progress check-in, a one-on-one, a project review with the students
     * present. These used to fall into Department Meeting because the word
     * "meeting" was in the sentence, inflating a governance count with
     * student-facing time. Same treatment as Department Meeting — one entry is
     * one meeting — because it is the same kind of thing, only not the same
     * audience. */
    name: "Meeting (Other)",
    dbCategory: "MEETING",
    category: "Administrative",
    counting: "occurrence",
    unit: "Meeting",
    units: "Meetings",
    codes: ["STUDENT_MEETING", "PROJECT_MEETING"],
  },
  {
    name: "Reporting",
    dbCategory: "ADMINISTRATIVE",
    category: "Administrative",
    counting: "none",
    unit: "",
    units: "",
    codes: ["REPORTING"],
  },
  {
    name: "Documentation",
    dbCategory: "ADMINISTRATIVE",
    category: "Administrative",
    counting: "none",
    unit: "",
    units: "",
    // Documentation is writing a document. Nothing else.
    codes: ["DOCUMENTATION", "RECORD_MAINTENANCE"],
  },
  {
    /* Departmental administration that produces no document.
     *
     * Invigilation rosters, admissions paperwork, accreditation files,
     * timetabling, committee work. All of it printed as "Documentation", which
     * is stable and wrong: none of them is a document being written, and in
     * some months this is the largest block outside teaching.
     *
     * Hours only. "How many admissions paperworks" is not a question. */
    name: "Department Duties",
    dbCategory: "ADMINISTRATIVE",
    category: "Administrative",
    counting: "none",
    unit: "",
    units: "",
    codes: ["DEPARTMENT_WORK"],
  },

  /* ── Training / Development ───────────────────────────────────────────── */
  {
    name: "Workshop Attended",
    dbCategory: "TRAINING_WORKSHOP",
    category: "Training / Development",
    counting: "occurrence",
    unit: "Workshop",
    units: "Workshops",
    codes: ["WORKSHOP", "TRAINING_SESSION", "SEMINAR", "ORIENTATION"],
  },
  {
    name: "Self-Learning",
    dbCategory: "TRAINING_WORKSHOP",
    category: "Training / Development",
    counting: "none",
    unit: "",
    units: "",
    /* No stored deliverable at all. The database's LEARNING category carries
     * none, which is exactly what self-directed study is: hours against no named
     * artefact. Reached through the category fallback below. */
    codes: [],
  },

  /* ── Other ────────────────────────────────────────────────────────────── */
  {
    name: "Other / Unclassified Work",
    dbCategory: "OTHER",
    category: "Other",
    counting: "none",
    unit: "",
    units: "",
    codes: ["UNCLASSIFIED_WORK"],
  },
] as const;

/** What a row is printed as when nothing else fits. Never invented, never blank. */
export const FALLBACK = DELIVERABLES.find((d) => d.name === "Other / Unclassified Work")!;

/**
 * For rows carrying no deliverable at all — the category alone has to answer.
 *
 * Every stored category appears, including the three the parser is never offered
 * (`DAILY_OPENING`, `DAILY_CLOSING`, `LEARNING`), because a row can reach the
 * report by other paths and a report has to be able to print it.
 */
const BY_CATEGORY: Readonly<Record<string, string>> = {
  TEACHING: "Live Class",
  PRACTICAL_LAB: "Practical / Lab Session",
  MENTORING: "Academic Guidance",
  // Vaguer but truer: a support row carrying no deliverable might be a doubt,
  // a follow-up or counselling, and the broader name is the one that cannot be
  // wrong about which.
  STUDENT_SUPPORT: "Academic Guidance",
  ASSESSMENT: "Assignment Evaluation",
  RESEARCH: "Literature Review",
  CONTENT_DEVELOPMENT: "Course Material Development",
  ADMINISTRATIVE: "Documentation",
  MEETING: "Department Meeting",
  TRAINING_WORKSHOP: "Workshop Attended",
  LEARNING: "Self-Learning",
  DAILY_OPENING: "Other / Unclassified Work",
  DAILY_CLOSING: "Other / Unclassified Work",
  DELIVERABLE: "Other / Unclassified Work",
  OTHER: "Other / Unclassified Work",
};

const BY_NAME = new Map(DELIVERABLES.map((d) => [d.name.toLowerCase(), d]));
const BY_CODE = new Map<string, Deliverable>();
for (const deliverable of DELIVERABLES) {
  for (const code of deliverable.codes) BY_CODE.set(code, deliverable);
}

/** The deliverable of that exact name, or null. Case-insensitive only. */
export function deliverableNamed(name: string): Deliverable | null {
  return BY_NAME.get(name.trim().toLowerCase()) ?? null;
}

/**
 * What one recorded row is called in the report.
 *
 * The stored deliverable decides when there is one, because it is the more
 * specific answer; the stored category decides otherwise. Never returns null — a
 * row that reached the database has to be printable.
 */
export function deliverableFor(
  deliverableCode: string | null | undefined,
  categoryCode: string | null | undefined,
): Deliverable {
  const byCode = deliverableCode ? BY_CODE.get(deliverableCode) : undefined;
  if (byCode) return byCode;
  const byCategory = categoryCode ? BY_CATEGORY[categoryCode] : undefined;
  return (byCategory ? deliverableNamed(byCategory) : null) ?? FALLBACK;
}

/**
 * Which stored code to write for a name the model chose.
 *
 * The first of its codes, because a name that stands for several stores as the
 * commonest of them — a model that answered "Live Class" saw a lecture far more
 * often than it saw a guest lecture, and picking the specific one would be
 * inventing a distinction the model was never asked about.
 *
 * Null for `Self-Learning`, which has no stored deliverable; its row is written
 * against the category alone.
 */
export function storedCodeFor(name: string): string | null {
  return deliverableNamed(name)?.codes[0] ?? null;
}

/* ── Quantity ──────────────────────────────────────────────────────────────
 *
 * `null` is the client's `?`: the instructor did not say how many, and nobody
 * is going to decide on their behalf. It is deliberately NOT zero — zero is a
 * count, and "none" and "unknown" are answers a manager acts on differently.
 */

/** The client's own rendering of an unknown count. */
export const UNSTATED = "?";

/**
 * What one entry's quantity should be when the instructor stated no number.
 *
 * The whole singular-occurrence exception, in one function: an entry that IS the
 * thing counts as one of it, and an entry that HANDLED some unstated number of
 * things stays unknown.
 */
export function quantityWhenUnstated(deliverable: Deliverable): number | null {
  return deliverable.counting === "occurrence" ? 1 : null;
}

/**
 * `1 Class`, `12 Assignments`, `? Assignments`.
 *
 * Returns null for a deliverable that is never counted, so the caller leaves it
 * out of the column entirely rather than printing a unit with no number.
 */
export function quantityPhrase(deliverable: Deliverable, quantity: number | null): string | null {
  if (deliverable.counting === "none") return null;
  if (quantity === null) return `${UNSTATED} ${deliverable.units}`;
  const n = Math.max(0, Math.round(quantity));
  return `${n} ${n === 1 ? deliverable.unit : deliverable.units}`;
}

/**
 * Adding up counts where some of them are unknown.
 *
 * ── Why one unknown makes the total unknown ───────────────────────────────
 * Two entries of Assignment Evaluation, one saying twelve and one saying
 * nothing, do not make twelve. Reporting twelve would state a total the day does
 * not support, and it is the more dangerous error precisely because it looks
 * like a real figure. `?` is the honest sum, and it is what the client asked to
 * see.
 *
 * A day whose entries are all unknown is also unknown, not zero.
 */
export function sumQuantities(values: ReadonlyArray<number | null>): number | null {
  if (values.length === 0) return null;
  if (values.some((v) => v === null)) return null;
  return values.reduce((n: number, v) => n + (v ?? 0), 0);
}
