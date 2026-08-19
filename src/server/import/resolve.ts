/**
 * Turning rows into a plan, and deciding what is wrong with them.
 *
 * ── One resolution, used twice ─────────────────────────────────────────────
 * Validation and execution both need the same answer to the same question:
 * "for each entity in this file, does it already exist, and what will happen to
 * it?" So they call the SAME function. The preview an admin approves is
 * therefore produced by the code that does the writing, not by a parallel
 * estimate that can drift from it.
 *
 * Execution re-resolves rather than trusting the stored plan, because minutes
 * may pass between preview and confirmation and somebody else may have created
 * a university in between. The preview is a forecast; resolution at write time
 * is the truth.
 *
 * ── Query cost is fixed, not per row ──────────────────────────────────────
 * Three queries total, regardless of whether the file has 10 rows or 10,000:
 * one for the universities named, one for the users named, one for the profiles
 * in those universities. Everything after that is Map lookups. A per-row
 * `findUnique` would be 30,000 round trips for a 10,000-row file.
 *
 * ── Tenancy is checked here, and enforced again by Postgres ────────────────
 * A manager code is unique only WITHIN a university (`@@unique([universityId,
 * employeeCode])`), so `MGR001` in two universities is two people and every
 * lookup is scoped. When a row names a manager that exists only in a different
 * university, that is a `CROSS_TENANT_MAPPING_ERROR` and the row is dropped —
 * never silently reassigned. The composite foreign key
 * `(managerId, universityId) -> Manager(id, universityId)` is still the final
 * guard: if a bug ever got past this file, the database refuses the write.
 */

import { prisma } from "@/server/db";
import {
  isValidEmail,
  isValidTimezone,
  MAX_REPORTED_ISSUES,
  type CanonicalRow,
  type ImportIssue,
  type ImportPreview,
} from "@/server/import/schema";

export type ImportDefaults = {
  /** Applied to universities the file creates without naming a timezone. */
  timezone?: string;
};

type Action = "create" | "update" | "unchanged";

export type UniversityPlan = {
  /** As written in the file; the match is case-insensitive, the value is not. */
  code: string;
  name: string | null;
  timezone: string | null;
  existingId: string | null;
  action: Action;
  rowNumbers: number[];
};

export type PersonPlan = {
  kind: "MANAGER" | "INSTRUCTOR";
  universityCode: string;
  employeeCode: string | null;
  name: string | null;
  email: string | null;
  /** `null` when the file stated no status: on update, leave it alone. */
  isActive: boolean | null;
  /** Instructors only: the manager code named in the file, if any. */
  managerCode: string | null;
  existingProfileId: string | null;
  existingUserId: string | null;
  action: Action;
  rowNumbers: number[];
};

export type Resolution = {
  universities: UniversityPlan[];
  managers: PersonPlan[];
  instructors: PersonPlan[];
  errors: ImportIssue[];
  warnings: ImportIssue[];
  preview: ImportPreview;
};

/* ── Value parsing ─────────────────────────────────────────────────────────── */

const TRUTHY = new Set(["active", "true", "1", "yes", "y", "enabled"]);
const FALSY = new Set(["inactive", "false", "0", "no", "n", "disabled", "deactivated", "terminated"]);

/**
 * Reads a status cell.
 *
 * Three outcomes, and the distinction matters: `undefined` means the file did not
 * state a status, `null` means it stated something unrecognisable, and a boolean
 * is a real answer. Collapsing the first into `true` would make any file without
 * a status column silently REACTIVATE every deactivated person it mentions —
 * a change the file never asked for, which is the one thing an import must not do.
 */
function parseStatus(raw: string | undefined): boolean | null | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const v = raw.trim().toLowerCase();
  if (TRUTHY.has(v)) return true;
  if (FALSY.has(v)) return false;
  return null;
}

/** Codes are matched case-insensitively; the stored value keeps its own case. */
const key = (s: string) => s.trim().toUpperCase();
const emailKey = (s: string) => s.trim().toLowerCase();

/* ── The snapshot ──────────────────────────────────────────────────────────── */

type Snapshot = {
  universityByCode: Map<string, { id: string; code: string; name: string; timezone: string }>;
  /** Every user named by the file, whether or not they are in scope. */
  userByEmail: Map<string, { id: string; role: string; universityId: string | null; name: string; isActive: boolean }>;
  managerByCode: Map<string, { id: string; universityId: string; userId: string; employeeCode: string | null }>;
  managerByUserId: Map<string, { id: string; universityId: string; userId: string; employeeCode: string | null }>;
  instructorByCode: Map<string, { id: string; universityId: string; userId: string; employeeCode: string | null; managerId: string | null }>;
  instructorByUserId: Map<string, { id: string; universityId: string; userId: string; employeeCode: string | null; managerId: string | null }>;
  /** Codes that exist SOMEWHERE, used to tell "wrong tenant" from "new". */
  managerCodeTenants: Map<string, string[]>;
};

async function loadSnapshot(rows: CanonicalRow[]): Promise<Snapshot> {
  const codes = new Set<string>();
  const emails = new Set<string>();
  for (const { values } of rows) {
    if (values.universityCode) codes.add(values.universityCode.trim());
    if (values.managerEmail) emails.add(emailKey(values.managerEmail));
    if (values.instructorEmail) emails.add(emailKey(values.instructorEmail));
  }

  // Case-insensitive code matching needs the comparison in SQL, so the query
  // asks for every candidate spelling rather than filtering in memory.
  const universities = await prisma.university.findMany({
    where: { OR: [...codes].map((c) => ({ code: { equals: c, mode: "insensitive" as const } })) },
    select: { id: true, code: true, name: true, timezone: true },
  });
  const universityByCode = new Map(universities.map((u) => [key(u.code), u]));
  const universityIds = universities.map((u) => u.id);

  const users = emails.size
    ? await prisma.user.findMany({
        where: { email: { in: [...emails] } },
        select: { id: true, email: true, role: true, universityId: true, name: true, isActive: true },
      })
    : [];
  const userByEmail = new Map(users.map((u) => [emailKey(u.email), u]));

  // Profiles are loaded for the universities the file touches only. Employee
  // codes are per-tenant, so the map key has to carry the tenant too.
  const [managers, instructors] = universityIds.length
    ? await Promise.all([
        prisma.manager.findMany({
          where: { universityId: { in: universityIds } },
          select: { id: true, universityId: true, userId: true, employeeCode: true },
        }),
        prisma.instructor.findMany({
          where: { universityId: { in: universityIds } },
          select: { id: true, universityId: true, userId: true, employeeCode: true, managerId: true },
        }),
      ])
    : [[], []];

  const codeOfUniversity = new Map(universities.map((u) => [u.id, key(u.code)]));
  const managerByCode = new Map<string, { id: string; universityId: string; userId: string; employeeCode: string | null }>();
  const managerByUserId = new Map<string, { id: string; universityId: string; userId: string; employeeCode: string | null }>();
  for (const m of managers) {
    if (m.employeeCode) {
      managerByCode.set(`${codeOfUniversity.get(m.universityId)}::${key(m.employeeCode)}`, m);
    }
    managerByUserId.set(m.userId, m);
  }

  const instructorByCode = new Map<string, { id: string; universityId: string; userId: string; employeeCode: string | null; managerId: string | null }>();
  const instructorByUserId = new Map<string, { id: string; universityId: string; userId: string; employeeCode: string | null; managerId: string | null }>();
  for (const i of instructors) {
    if (i.employeeCode) {
      instructorByCode.set(`${codeOfUniversity.get(i.universityId)}::${key(i.employeeCode)}`, i);
    }
    instructorByUserId.set(i.userId, i);
  }

  // "This manager code belongs to another university" has to be answerable for
  // universities the file never mentions — that is the whole point of the check.
  // So this lookup is deliberately NOT scoped to the file's tenants: it asks,
  // platform-wide, which universities hold each manager code the file names.
  // Bounded by the number of DISTINCT manager codes, which is the number of
  // managers, not the number of rows.
  const namedManagerCodes = new Set<string>();
  for (const { values } of rows) {
    if (values.managerCode) namedManagerCodes.add(values.managerCode.trim());
  }
  const managerCodeTenants = new Map<string, string[]>();
  if (namedManagerCodes.size > 0) {
    const holders = await prisma.manager.findMany({
      where: {
        OR: [...namedManagerCodes].map((c) => ({
          employeeCode: { equals: c, mode: "insensitive" as const },
        })),
      },
      select: { employeeCode: true, university: { select: { code: true } } },
    });
    for (const h of holders) {
      if (!h.employeeCode) continue;
      const k = key(h.employeeCode);
      const list = managerCodeTenants.get(k);
      if (list) list.push(h.university.code);
      else managerCodeTenants.set(k, [h.university.code]);
    }
  }

  return {
    universityByCode,
    userByEmail,
    managerByCode,
    managerByUserId,
    instructorByCode,
    instructorByUserId,
    managerCodeTenants,
  };
}

/* ── Resolution ────────────────────────────────────────────────────────────── */

/**
 * Builds the plan and the diagnostics for one dataset.
 *
 * Repeated university and manager values across rows are expected — a combined
 * file names a university on every one of its instructors' rows — so entities
 * are keyed and merged rather than created per row. A genuine conflict (the same
 * code with two different names) is reported instead of one silently winning.
 */
export async function resolveImport(
  rows: CanonicalRow[],
  defaults: ImportDefaults = {},
): Promise<Resolution> {
  const snapshot = await loadSnapshot(rows);

  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  let errorCount = 0;
  let warningCount = 0;
  const fail = (issue: ImportIssue) => {
    errorCount++;
    if (errors.length < MAX_REPORTED_ISSUES) errors.push(issue);
  };
  const warn = (issue: ImportIssue) => {
    warningCount++;
    if (warnings.length < MAX_REPORTED_ISSUES) warnings.push(issue);
  };

  const universities = new Map<string, UniversityPlan>();
  const managers = new Map<string, PersonPlan>();
  const instructors = new Map<string, PersonPlan>();
  /** Rows dropped for an error, so they are not counted as valid. */
  const badRows = new Set<number>();

  for (const { rowNumber, values } of rows) {
    const uniRaw = values.universityCode;
    if (!uniRaw) {
      fail({
        rowNumber,
        code: "MISSING_REQUIRED_FIELD",
        field: "universityCode",
        message: "Every row must name a university code.",
      });
      badRows.add(rowNumber);
      continue;
    }
    const uniKey = key(uniRaw);
    const existingUniversity = snapshot.universityByCode.get(uniKey) ?? null;

    /* ── University ─────────────────────────────────────────────────────── */
    let university = universities.get(uniKey);
    if (!university) {
      const timezone = values.universityTimezone ?? defaults.timezone ?? null;
      if (!existingUniversity) {
        if (!values.universityName) {
          fail({
            rowNumber,
            code: "UNKNOWN_UNIVERSITY",
            field: "universityCode",
            message: `University ${uniRaw} does not exist and the file gives no name to create it with.`,
          });
          badRows.add(rowNumber);
          continue;
        }
        if (!timezone) {
          fail({
            rowNumber,
            code: "MISSING_REQUIRED_FIELD",
            field: "universityTimezone",
            message: `New university ${uniRaw} needs a timezone. Add a timezone column or set a default for this import.`,
          });
          badRows.add(rowNumber);
          continue;
        }
      }
      if (timezone && !isValidTimezone(timezone)) {
        fail({
          rowNumber,
          code: "INVALID_TIMEZONE",
          field: "universityTimezone",
          message: `"${timezone}" is not a recognised IANA timezone (for example Asia/Kolkata).`,
        });
        badRows.add(rowNumber);
        continue;
      }

      university = {
        code: existingUniversity?.code ?? uniRaw.trim(),
        name: values.universityName ?? null,
        timezone: timezone,
        existingId: existingUniversity?.id ?? null,
        action: !existingUniversity
          ? "create"
          : values.universityName && values.universityName !== existingUniversity.name
            ? "update"
            : "unchanged",
        rowNumbers: [],
      };
      universities.set(uniKey, university);

      if (!existingUniversity) {
        warn({
          rowNumber,
          code: "WORKING_HOURS_NOT_CONFIGURED",
          message: `${uniRaw} will be created without working hours. Utilisation stays unmeasured until you set them in that university's settings.`,
        });
      }
    } else if (values.universityName && !university.name) {
      /* The first row that mentioned this university left the name blank, so
       * the plan was created with `name: null` and `action: "unchanged"` — and
       * nothing filled it in afterwards. A rename stated on any later row was
       * dropped silently: the write step took its skipped branch, the preview
       * said nothing, and the admin was told the import succeeded.
       *
       * The name is a property of the university, not of the row that happened
       * to come first. */
      university.name = values.universityName;
      if (existingUniversity && values.universityName !== existingUniversity.name) {
        university.action = "update";
      }
    } else if (
      values.universityName &&
      university.name &&
      values.universityName !== university.name
    ) {
      warn({
        rowNumber,
        code: "INCONSISTENT_UNIVERSITY_NAME",
        field: "universityName",
        message: `${uniRaw} is named "${university.name}" earlier in the file and "${values.universityName}" here. The first name is used.`,
      });
    }
    university.rowNumbers.push(rowNumber);

    /* ── Manager ────────────────────────────────────────────────────────── */
    const managerCode = values.managerCode ?? null;
    const managerEmail = values.managerEmail ? emailKey(values.managerEmail) : null;

    if (managerCode || managerEmail || values.managerName) {
      const person = resolvePerson({
        kind: "MANAGER",
        rowNumber,
        universityKey: uniKey,
        universityCode: uniRaw.trim(),
        universityId: existingUniversity?.id ?? null,
        employeeCode: managerCode,
        email: managerEmail,
        name: values.managerName ?? null,
        /* NOT `values.status`. The row has one status cell and it describes the
         * INSTRUCTOR the row is about; feeding it to the manager as well meant a
         * row marking one instructor Inactive also deactivated the manager named
         * on it — and `merge` uses `??=`, which will not overwrite `false`, so
         * later rows saying Active could not undo it. An existing manager was
         * locked out of the product by an import that meant to retire one
         * instructor; a new one was created disabled.
         *
         * A manager's own status has to come from a row that is ABOUT them,
         * which this format has no column for. Undefined is the honest answer:
         * leave what is already there. */
        isActiveRaw: undefined,
        snapshot,
        fail,
      });
      if (person === null) {
        badRows.add(rowNumber);
      } else {
        merge(managers, person, warn);
      }
    }

    /* ── Instructor ─────────────────────────────────────────────────────── */
    const instructorCode = values.instructorCode ?? null;
    const instructorEmail = values.instructorEmail ? emailKey(values.instructorEmail) : null;

    if (instructorCode || instructorEmail || values.instructorName) {
      const person = resolvePerson({
        kind: "INSTRUCTOR",
        rowNumber,
        universityKey: uniKey,
        universityCode: uniRaw.trim(),
        universityId: existingUniversity?.id ?? null,
        employeeCode: instructorCode,
        email: instructorEmail,
        name: values.instructorName ?? null,
        isActiveRaw: values.status,
        snapshot,
        fail,
      });
      if (person === null) {
        badRows.add(rowNumber);
      } else {
        person.managerCode = managerCode;

        // A manager named on this row must belong to THIS university. Checked
        // against the file's own managers first — a file legitimately creates a
        // manager and their roster in one go — then against the database.
        if (managerCode) {
          const inFile = managers.get(`${uniKey}::CODE::${key(managerCode)}`);
          const inDb = snapshot.managerByCode.get(`${uniKey}::${key(managerCode)}`);
          if (!inFile && !inDb) {
            const elsewhere = snapshot.managerCodeTenants.get(key(managerCode)) ?? [];
            if (elsewhere.length > 0) {
              fail({
                rowNumber,
                code: "CROSS_TENANT_MAPPING_ERROR",
                field: "managerCode",
                message: `University ${uniRaw} cannot use manager ${managerCode} because that manager belongs to ${elsewhere.join(", ")}.`,
              });
              badRows.add(rowNumber);
              continue;
            }
            if (!values.managerName && !managerEmail) {
              fail({
                rowNumber,
                code: "UNKNOWN_UNIVERSITY",
                field: "managerCode",
                message: `Manager ${managerCode} does not exist in ${uniRaw} and the row gives no name or email to create them with.`,
              });
              badRows.add(rowNumber);
              continue;
            }
          }
        } else {
          warn({
            rowNumber,
            code: "INSTRUCTOR_UNASSIGNED",
            message: `${values.instructorName ?? instructorCode ?? instructorEmail} will be imported with no manager. An admin can assign them later.`,
          });
        }

        merge(instructors, person, warn);
      }
    }
  }

  const list = [...universities.values()];
  // A person is deliberately registered under EVERY identifier that can find
  // them — id, email and employee code — so `values()` yields the same plan once
  // per key. A Set collapses them by object identity; without it, anyone with
  // both a code and an email was counted, planned and written twice.
  const managerList = [...new Set(managers.values())];
  const instructorList = [...new Set(instructors.values())];

  const plan = (people: PersonPlan[]) => ({
    create: people.filter((p) => p.action === "create").length,
    update: people.filter((p) => p.action === "update").length,
    unchanged: people.filter((p) => p.action === "unchanged").length,
  });

  return {
    universities: list,
    managers: managerList,
    instructors: instructorList,
    errors,
    warnings,
    preview: {
      rowCount: rows.length,
      validRows: rows.length - badRows.size,
      universities: {
        create: list.filter((u) => u.action === "create").length,
        update: list.filter((u) => u.action === "update").length,
        unchanged: list.filter((u) => u.action === "unchanged").length,
      },
      managers: plan(managerList),
      instructors: plan(instructorList),
      unassignedInstructors: instructorList.filter((i) => !i.managerCode).length,
      errorCount,
      warningCount,
    },
  };
}

/* ── One person ────────────────────────────────────────────────────────────── */

/**
 * Resolves a manager or instructor, or returns null when the row cannot stand.
 *
 * The rule that drives most of this: creating a person means creating a User,
 * and `User.email` is NOT NULL and globally unique. So an email is required to
 * CREATE somebody, but not to UPDATE somebody already identified by their
 * employee code. That asymmetry is what lets a file update 500 existing staff
 * without restating every address.
 */
function resolvePerson(input: {
  kind: "MANAGER" | "INSTRUCTOR";
  rowNumber: number;
  universityKey: string;
  universityCode: string;
  universityId: string | null;
  employeeCode: string | null;
  email: string | null;
  name: string | null;
  isActiveRaw: string | undefined;
  snapshot: Snapshot;
  fail: (issue: ImportIssue) => void;
}): PersonPlan | null {
  const { kind, rowNumber, universityKey, universityCode, employeeCode, email, name, snapshot, fail } = input;
  const isManager = kind === "MANAGER";
  const label = isManager ? "manager" : "instructor";

  const isActive = parseStatus(input.isActiveRaw);
  if (isActive === null) {
    fail({
      rowNumber,
      code: "INVALID_STATUS",
      field: "status",
      message: `"${input.isActiveRaw}" is not a recognised status. Use Active or Inactive.`,
    });
    return null;
  }

  if (email && !isValidEmail(email)) {
    fail({
      rowNumber,
      code: "INVALID_EMAIL",
      field: isManager ? "managerEmail" : "instructorEmail",
      message: `"${email}" is not a valid email address.`,
    });
    return null;
  }

  // Existing? By employee code within this tenant first, then by email.
  const byCode = employeeCode
    ? isManager
      ? snapshot.managerByCode.get(`${universityKey}::${key(employeeCode)}`)
      : snapshot.instructorByCode.get(`${universityKey}::${key(employeeCode)}`)
    : undefined;

  const user = email ? snapshot.userByEmail.get(email) : undefined;

  if (user) {
    // An address already in use pins both the tenant and the role. Neither can
    // be changed by an import: moving a user between universities would orphan
    // every historical record pointing at the old tenant.
    if (input.universityId && user.universityId && user.universityId !== input.universityId) {
      fail({
        rowNumber,
        code: "CROSS_TENANT_MAPPING_ERROR",
        field: isManager ? "managerEmail" : "instructorEmail",
        message: `${email} already belongs to a different university. An import cannot move a person between universities.`,
      });
      return null;
    }
    const wanted = isManager ? "MANAGER" : "INSTRUCTOR";
    if (user.role !== wanted) {
      fail({
        rowNumber,
        code: "ROLE_CONFLICT",
        field: isManager ? "managerEmail" : "instructorEmail",
        message: `${email} is already a ${user.role.toLowerCase()} and cannot be imported as a ${label}.`,
      });
      return null;
    }
  }

  const byUser = user
    ? isManager
      ? snapshot.managerByUserId.get(user.id)
      : snapshot.instructorByUserId.get(user.id)
    : undefined;

  // Two identifiers on one row must agree. If they point at different people,
  // guessing which was meant is exactly how an import corrupts a roster.
  if (byCode && byUser && byCode.id !== byUser.id) {
    fail({
      rowNumber,
      code: "IDENTITY_CONFLICT",
      field: isManager ? "managerCode" : "instructorCode",
      message: `Code ${employeeCode} and email ${email} identify two different ${label}s.`,
    });
    return null;
  }

  const existing = byCode ?? byUser ?? null;

  if (!existing) {
    if (!email) {
      fail({
        rowNumber,
        code: "MISSING_REQUIRED_FIELD",
        field: isManager ? "managerEmail" : "instructorEmail",
        message: `New ${label} ${employeeCode ?? name ?? ""} needs an email address to create an account.`.replace(/\s+/g, " "),
      });
      return null;
    }
    if (!name) {
      fail({
        rowNumber,
        code: "MISSING_REQUIRED_FIELD",
        field: isManager ? "managerName" : "instructorName",
        message: `New ${label} ${email} needs a name.`,
      });
      return null;
    }
  }

  const wouldChange =
    (name !== null && name !== (user?.name ?? null)) ||
    (employeeCode !== null && key(employeeCode) !== key(existing?.employeeCode ?? "")) ||
    // Only a STATED status can be a change. An unstated one is not a request to
    // set anything.
    (isActive !== undefined && user !== undefined && user.isActive !== isActive);

  return {
    kind,
    universityCode,
    employeeCode,
    name,
    email,
    isActive: isActive ?? null,
    managerCode: null,
    existingProfileId: existing?.id ?? null,
    /* From the profile too, not only from the email lookup.
     *
     * A person matched by EMPLOYEE CODE alone — the path the module header
     * advertises, "update 500 existing staff without restating every address" —
     * left this null, and `updatePerson` guards the user write on it. So the
     * name and the status stated in the file were never written, while the
     * preview said "1 update", the outcome said "updated: 1", and the job went
     * green. The snapshot has carried `userId` on every profile all along.
     *
     * `wouldChange` still compares against the email-matched user, so a
     * code-only row reports a change whenever it states a name. Writing the same
     * value twice is harmless; not writing it at all was not. */
    existingUserId: user?.id ?? existing?.userId ?? null,
    action: !existing ? "create" : wouldChange ? "update" : "unchanged",
    rowNumbers: [rowNumber],
  } satisfies PersonPlan;
}

/**
 * Folds a repeated person into the existing unit of work.
 *
 * A combined file repeats a manager on every one of their instructors' rows, so
 * this is the normal case, not an error. Later rows fill in fields the first one
 * left blank; they never overwrite a value already present, so the first
 * statement of a name wins and the disagreement is reported rather than applied.
 */
function merge(
  into: Map<string, PersonPlan>,
  person: PersonPlan,
  warn: (issue: ImportIssue) => void,
): void {
  const uniKey = key(person.universityCode);
  const keys = [
    person.existingProfileId ? `${uniKey}::ID::${person.existingProfileId}` : null,
    person.email ? `${uniKey}::EMAIL::${person.email}` : null,
    person.employeeCode ? `${uniKey}::CODE::${key(person.employeeCode)}` : null,
  ].filter((k): k is string => k !== null);

  const found = keys.map((k) => into.get(k)).find(Boolean);
  if (!found) {
    for (const k of keys) into.set(k, person);
    return;
  }

  if (found.rowNumbers.length === 1) {
    warn({
      rowNumber: person.rowNumbers[0]!,
      code: "DUPLICATE_ROW_IGNORED",
      message: `${person.email ?? person.employeeCode ?? person.name} appears more than once; the rows are combined into one record.`,
    });
  }
  found.rowNumbers.push(...person.rowNumbers);
  found.name ??= person.name;
  found.email ??= person.email;

  /* An employee code may only be adopted if nobody else already holds it.
   *
   * `found` is whichever plan matched FIRST, in id-email-code order, so a row
   * carrying both an email and a code can match on the email and then take a
   * code that a different plan is already registered under. Both stay `create`,
   * neither is flagged, `errorCount` is zero — and the preview the admin
   * approves is clean right up until `createMany` violates
   * `@@unique([universityId, employeeCode])` and the whole chunk fails.
   *
   * `DUPLICATE_IDENTIFIER` was declared for exactly this and emitted nowhere. */
  if (person.employeeCode) {
    const codeKey = `${uniKey}::CODE::${key(person.employeeCode)}`;
    const holder = into.get(codeKey);
    if (holder && holder !== found) {
      warn({
        rowNumber: person.rowNumbers[0]!,
        code: "DUPLICATE_IDENTIFIER",
        field: person.kind === "MANAGER" ? "managerCode" : "instructorCode",
        message:
          `Employee code ${person.employeeCode} is already used by ` +
          `${holder.email ?? holder.name ?? "another person"} in this file. ` +
          `It was not applied to ${person.email ?? person.name ?? "this row"}.`,
      });
    } else {
      found.employeeCode ??= person.employeeCode;
    }
  }
  found.managerCode ??= person.managerCode;
  found.isActive ??= person.isActive;
  // The merged plan now carries fields the first row did not have, so the first
  // row's verdict can be stale. A later row that resolved to "update" knew about
  // a change this unit of work will now perform.
  if (found.action === "unchanged" && person.action === "update") found.action = "update";
  // Newly-learned identifiers must also resolve to this same unit of work.
  for (const k of keys) if (!into.has(k)) into.set(k, found);
}
