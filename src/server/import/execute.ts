/**
 * Writing a resolved import into Postgres.
 *
 * ── Order is dictated by the foreign keys, not by preference ───────────────
 *     University  ->  Manager  ->  Instructor
 * `Manager` carries a composite FK to `(User.id, User.universityId)`, and
 * `Instructor.managerId` carries one to `(Manager.id, Manager.universityId)`.
 * So a manager cannot be written before their university, and an instructor
 * cannot be pointed at a manager that does not exist yet. The database would
 * refuse it, which is the point: the ordering here is a performance decision,
 * the composite FK is the guarantee.
 *
 * ── Fast path, then a slow path that names the culprit ─────────────────────
 * Creating N people row-by-row is 2N round trips. Creating them in chunks with
 * `createManyAndReturn` is 2 per chunk — but one bad row fails the whole chunk
 * and tells you nothing about which. So a chunk is attempted in bulk, and only
 * if that fails is it retried item by item to find the offender. The common
 * case is fast; the diagnostic case is precise; neither is traded for the other.
 * Resolution has already checked every uniqueness rule against a snapshot, so
 * the slow path is the exception rather than the norm.
 *
 * ── Idempotent by construction ─────────────────────────────────────────────
 * Every write is keyed on a durable identifier — university code, or a person's
 * employee code within their tenant, or their email. Importing the same file
 * twice therefore produces updates, not duplicates, and an import interrupted
 * half way can simply be run again. That, and not a checksum, is what makes
 * re-import safe.
 *
 * ── Nothing is ever removed ────────────────────────────────────────────────
 * Absence from a file means nothing. A row missing from a new CSV is not a
 * deletion, not a deactivation, and not a demotion; it is a file that did not
 * mention somebody. There is no code path here that deletes or deactivates a
 * record the file omitted.
 */

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { hashPassword } from "@/server/auth/password";
import {
  slugify,
  type ImportIssue,
  type ImportOutcome,
  MAX_REPORTED_ISSUES,
} from "@/server/import/schema";
import { resolveImport, type ImportDefaults, type PersonPlan } from "@/server/import/resolve";
import type { CanonicalRow } from "@/server/import/schema";

/** How many people are written per round trip on the fast path. */
const CHUNK = 100;

export type ExecuteOptions = {
  defaults: ImportDefaults;
  /**
   * The initial password every account created by this import receives.
   *
   * ── Why one password for the batch ──────────────────────────────────────
   * Three facts force this. `User.passwordHash` is NOT NULL, so an account
   * cannot be created without one. There is no password-reset endpoint in the
   * product, so an account created with an unusable hash would be permanently
   * unusable. And hashing is scrypt at N=2^15 — measured at ~136ms — so a
   * per-person password means 10,000 hashes and roughly 23 minutes of solid CPU
   * in the process that also serves every dashboard.
   *
   * One admin-chosen password, hashed ONCE and reused, resolves all three. It is
   * never written to this table, never returned by an endpoint, and never read
   * back — the plaintext exists only for the duration of the request that
   * supplied it. Accepting a password column in the file instead would turn
   * every uploaded roster into a credential store, which is worse.
   */
  initialPassword: string;
  onProgress?: (processed: number) => Promise<void> | void;
};

/* ── Universities ──────────────────────────────────────────────────────────── */

/**
 * Creates or renames universities, returning code -> id for everything named.
 *
 * A new university is created with the four fields the schema requires and
 * nothing invented: name and code come from the file, timezone from the file or
 * the import's stated default, and `slug` is derived from the name because it is
 * a URL detail rather than organisational data anybody maintains in a staff
 * file. Working hours are deliberately NOT fabricated — capacity drives
 * utilisation, and a guessed 09:00-18:00 would produce confident, wrong
 * percentages. Resolution has already warned that they need configuring.
 */
async function writeUniversities(
  resolution: Awaited<ReturnType<typeof resolveImport>>,
  outcome: ImportOutcome,
  fail: (issue: ImportIssue) => void,
): Promise<Map<string, string>> {
  const idByCode = new Map<string, string>();

  for (const plan of resolution.universities) {
    const codeKey = plan.code.trim().toUpperCase();
    try {
      if (plan.existingId) {
        idByCode.set(codeKey, plan.existingId);
        if (plan.action === "update" && plan.name) {
          await prisma.university.update({
            where: { id: plan.existingId },
            data: { name: plan.name },
          });
          outcome.updated.universities++;
        } else {
          outcome.skipped++;
        }
        continue;
      }

      // `slug` is unique platform-wide, and two universities can share a name.
      // The code disambiguates, and it is unique by definition.
      const base = slugify(plan.name ?? plan.code);
      const taken = await prisma.university.findUnique({ where: { slug: base }, select: { id: true } });
      const slug = taken ? `${base}-${slugify(plan.code)}` : base;

      const created = await prisma.university.create({
        data: {
          name: plan.name ?? plan.code,
          code: plan.code,
          slug,
          timezone: plan.timezone!,
          // Mirrors what POST /api/universities does, so an imported tenant is
          // configured the same way as a hand-created one.
          universitySettings: { create: {} },
        },
        select: { id: true },
      });
      idByCode.set(codeKey, created.id);
      outcome.created.universities++;
    } catch (error) {
      outcome.failed++;
      fail({
        rowNumber: plan.rowNumbers[0] ?? 0,
        code: "WRITE_FAILED",
        message: `University ${plan.code} could not be written: ${reasonOf(error)}`,
      });
    }
  }

  return idByCode;
}

/* ── People ────────────────────────────────────────────────────────────────── */

type PersonContext = {
  universityId: string;
  passwordHash: string;
  /** Instructors only. */
  managerIdByCode?: Map<string, string>;
};

/**
 * Creates one batch of people: users first, then their profile rows.
 *
 * Two round trips rather than 2N. `createManyAndReturn` gives back the generated
 * user ids, which the profile insert needs — the composite FK means the profile
 * cannot be written until its user exists and carries the same universityId.
 */
async function createChunk(
  kind: "MANAGER" | "INSTRUCTOR",
  people: PersonPlan[],
  ctx: (plan: PersonPlan) => PersonContext,
): Promise<void> {
  /* ── One transaction, both inserts ──────────────────────────────────────
   * These were two statements. When the PROFILE insert failed — a duplicate
   * employee code, a dropped connection — the users were already committed, and
   * the retry path then re-ran `createChunk`, whose first statement is the user
   * insert, so every retry failed with P2002. The chunk's people were reported
   * WRITE_FAILED while their `User` rows existed: able to authenticate, given
   * `managerId: null` by the session resolver because they have no profile, and
   * permanently un-importable, since resolution finds the user by email, finds
   * no profile, and plans a create that always collides.
   *
   * Together or not at all. That is also what makes the retry correct.
   */
  await prisma.$transaction(async (tx) => {
    const users = await tx.user.createManyAndReturn({
      data: people.map((p) => {
        const c = ctx(p);
        return {
          email: p.email!,
          name: p.name!,
          role: kind,
          passwordHash: c.passwordHash,
          // The CHECK `user_role_tenant_binding` requires a tenant for every
          // non-admin role, so this is not optional.
          universityId: c.universityId,
          // Unstated means active for a NEW account; there is nothing to preserve.
          isActive: p.isActive ?? true,
        };
      }),
      select: { id: true, email: true, universityId: true },
    });

    const userIdByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));

    const profiles = people.map((p) => {
      const c = ctx(p);
      const userId = userIdByEmail.get(p.email!.toLowerCase())!;
      return {
        userId,
        universityId: c.universityId,
        employeeCode: p.employeeCode,
        ...(kind === "INSTRUCTOR"
          ? {
              managerId: p.managerCode
                ? (c.managerIdByCode?.get(p.managerCode.trim().toUpperCase()) ?? null)
                : null,
            }
          : {}),
      };
    });

    if (kind === "MANAGER") {
      await tx.manager.createMany({ data: profiles });
    } else {
      await tx.instructor.createMany({ data: profiles as Prisma.InstructorCreateManyInput[] });
    }
  });
}

/** Updates one existing person. Only fields an import is allowed to change. */
async function updatePerson(kind: "MANAGER" | "INSTRUCTOR", plan: PersonPlan, ctx: PersonContext) {
  await prisma.$transaction(async (tx) => {
    if (plan.existingUserId) {
      await tx.user.update({
        where: { id: plan.existingUserId },
        data: {
          ...(plan.name ? { name: plan.name } : {}),
          // Only when the file actually stated one. A missing status column must
          // not reactivate somebody an admin deliberately deactivated.
          ...(plan.isActive === null ? {} : { isActive: plan.isActive }),
        },
      });
    }
    if (kind === "MANAGER") {
      await tx.manager.update({
        where: { id: plan.existingProfileId! },
        data: { ...(plan.employeeCode ? { employeeCode: plan.employeeCode } : {}) },
      });
    } else {
      await tx.instructor.update({
        where: { id: plan.existingProfileId! },
        data: {
          ...(plan.employeeCode ? { employeeCode: plan.employeeCode } : {}),
          // Only ever SET a roster from a file, never clear one. A column left
          // blank means "not stated here", not "remove this person's manager" —
          // unassignment is a deliberate admin action with its own audit trail.
          ...(plan.managerCode
            ? { managerId: ctx.managerIdByCode?.get(plan.managerCode.trim().toUpperCase()) ?? undefined }
            : {}),
        },
      });
    }
  });
}

/* ── The run ───────────────────────────────────────────────────────────────── */

export type ExecuteResult = {
  outcome: ImportOutcome;
  /** Truncated to {@link MAX_REPORTED_ISSUES}; `errorCount` is the true total. */
  errors: ImportIssue[];
  errorCount: number;
};

export async function executeImport(
  rows: CanonicalRow[],
  options: ExecuteOptions,
): Promise<ExecuteResult> {
  // Re-resolved rather than trusting a plan stored minutes ago: another admin
  // may have created one of these universities in the meantime, and creating it
  // twice is exactly what idempotency is supposed to prevent.
  const resolution = await resolveImport(rows, options.defaults);

  const outcome: ImportOutcome = {
    created: { universities: 0, managers: 0, instructors: 0 },
    updated: { universities: 0, managers: 0, instructors: 0 },
    skipped: 0,
    failed: 0,
  };
  const errors: ImportIssue[] = [];
  let errorCount = 0;
  const fail = (issue: ImportIssue) => {
    errorCount++;
    if (errors.length < MAX_REPORTED_ISSUES) errors.push(issue);
  };

  // ONE hash for the whole import. See ExecuteOptions.initialPassword.
  const passwordHash = await hashPassword(options.initialPassword);

  /**
   * Per-university context, built once rather than per person.
   *
   * The scoped manager map used to be rebuilt for every single person, and
   * `contextFor` is called more than once each — for 10,000 instructors under 500
   * managers that was millions of wasted iterations. The cache is cleared
   * whenever the manager map changes.
   */
  const contextCache = new Map<string, PersonContext>();
  function contextFor(plan: PersonPlan): PersonContext | null {
    const codeKey = plan.universityCode.trim().toUpperCase();
    const cached = contextCache.get(codeKey);
    if (cached) return cached;

    const universityId = idByCode.get(codeKey);
    if (!universityId) return null;

    const scoped = new Map<string, string>();
    const prefix = `${codeKey}::`;
    for (const [k, v] of managerIdByCode) {
      if (k.startsWith(prefix)) scoped.set(k.slice(prefix.length), v);
    }
    const context = { universityId, passwordHash, managerIdByCode: scoped };
    contextCache.set(codeKey, context);
    return context;
  }

  const idByCode = await writeUniversities(resolution, outcome, fail);

  let processed = 0;
  const tick = async (n: number) => {
    processed += n;
    await options.onProgress?.(processed);
  };

  /** Managers must be written before instructors can point at them. */
  const managerIdByCode = new Map<string, string>();
  for (const [codeKey, universityId] of idByCode) {
    const existing = await prisma.manager.findMany({
      where: { universityId, employeeCode: { not: null } },
      select: { id: true, employeeCode: true },
    });
    for (const m of existing) {
      managerIdByCode.set(`${codeKey}::${m.employeeCode!.trim().toUpperCase()}`, m.id);
    }
  }

  await writePeople("MANAGER", resolution.managers);
  // Re-read after writing: instructors resolve their manager by code, and the
  // managers this very import created have ids that did not exist a moment ago.
  contextCache.clear();
  for (const [codeKey, universityId] of idByCode) {
    const all = await prisma.manager.findMany({
      where: { universityId, employeeCode: { not: null } },
      select: { id: true, employeeCode: true },
    });
    for (const m of all) {
      managerIdByCode.set(`${codeKey}::${m.employeeCode!.trim().toUpperCase()}`, m.id);
    }
  }
  await writePeople("INSTRUCTOR", resolution.instructors);

  await promotePrimaryManagers(idByCode);

  return { outcome, errors, errorCount };

  /* ── inner helpers, closed over the run's state ──────────────────────────── */

  async function writePeople(kind: "MANAGER" | "INSTRUCTOR", people: PersonPlan[]) {
    const bucket = kind === "MANAGER" ? "managers" : "instructors";

    const creates: PersonPlan[] = [];
    const updates: PersonPlan[] = [];
    for (const p of people) {
      if (p.action === "create") creates.push(p);
      else if (p.action === "update") updates.push(p);
      else outcome.skipped++;
    }

    for (let i = 0; i < creates.length; i += CHUNK) {
      const chunk = creates.slice(i, i + CHUNK);
      const usable = chunk.filter((p) => contextFor(p) !== null);
      for (const missing of chunk.filter((p) => contextFor(p) === null)) {
        outcome.failed++;
        fail({
          rowNumber: missing.rowNumbers[0] ?? 0,
          code: "WRITE_FAILED",
          message: `${missing.email ?? missing.employeeCode} was skipped because university ${missing.universityCode} could not be written.`,
        });
      }
      if (usable.length === 0) continue;

      try {
        await createChunk(kind, usable, (p) => contextFor(p)!);
        outcome.created[bucket] += usable.length;
      } catch {
        // The bulk insert says nothing about which row it choked on, so the
        // chunk is retried one at a time purely to name the offender.
        for (const person of usable) {
          try {
            await createChunk(kind, [person], (p) => contextFor(p)!);
            outcome.created[bucket]++;
          } catch (error) {
            outcome.failed++;
            fail({
              rowNumber: person.rowNumbers[0] ?? 0,
              code: "WRITE_FAILED",
              message: `${person.email ?? person.employeeCode ?? person.name} could not be created: ${reasonOf(error)}`,
            });
          }
        }
      }
      await tick(usable.length);
    }

    for (const person of updates) {
      const ctx = contextFor(person);
      if (!ctx) {
        outcome.failed++;
        continue;
      }
      try {
        await updatePerson(kind, person, ctx);
        outcome.updated[bucket]++;
      } catch (error) {
        outcome.failed++;
        fail({
          rowNumber: person.rowNumbers[0] ?? 0,
          code: "WRITE_FAILED",
          message: `${person.email ?? person.employeeCode ?? person.name} could not be updated: ${reasonOf(error)}`,
        });
      }
      await tick(1);
    }
  }

  /**
   * Gives a university its primary manager if it has none.
   *
   * Mirrors `provisionManager`, which promotes the first manager of a university
   * with `primaryManagerId === null`. An imported tenant must end up in the same
   * state as a hand-created one, or the university page shows no owner.
   */
  async function promotePrimaryManagers(ids: Map<string, string>) {
    for (const universityId of ids.values()) {
      const university = await prisma.university.findUnique({
        where: { id: universityId },
        select: { primaryManagerId: true },
      });
      if (university?.primaryManagerId) continue;
      const first = await prisma.manager.findFirst({
        where: { universityId },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (first) {
        await prisma.university.update({
          where: { id: universityId },
          data: { primaryManagerId: first.id },
        });
      }
    }
  }
}

/** A cause an admin can act on, never a stack trace or a raw SQL fragment. */
function reasonOf(error: unknown): string {
  if (typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002") {
    return "a matching record already exists";
  }
  return error instanceof Error ? error.message.split("\n")[0]! : "unknown error";
}
