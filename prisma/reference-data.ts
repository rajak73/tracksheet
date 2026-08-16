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
  { code: "TEACHING", label: "Teaching", sortOrder: 20 },
  { code: "LEARNING", label: "Learning", sortOrder: 30 },
  { code: "STUDENT_SUPPORT", label: "Student Support", sortOrder: 40 },
  { code: "ADMINISTRATIVE", label: "Administrative", sortOrder: 50 },
  { code: "MEETING", label: "Meeting", sortOrder: 60 },
  { code: "DELIVERABLE", label: "Deliverable Work", sortOrder: 70 },
  { code: "RESEARCH", label: "Research", sortOrder: 80 },
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
