/**
 * The contract every part of the importer agrees on.
 *
 * One canonical row shape sits between the readers (CSV, PDF) and the writer.
 * That is the whole reason CSV and PDF do not each get their own validator: the
 * hard part — deduplication, tenancy, upsert identity — is identical for both,
 * and a second copy of it would be a second set of rules to keep in step.
 *
 *     CSV  ─┐
 *           ├─> CanonicalRow[] ─> validate ─> preview ─> execute ─> Postgres
 *     PDF  ─┘        ▲
 *                    │
 *              (the ONLY place a model's output enters,
 *               and it enters as data to be checked)
 *
 * ── Identity, read off the schema and not invented here ────────────────────
 * These are the constraints Postgres actually enforces, which is what makes
 * them safe to match on:
 *
 *     University.code                        @unique          — platform-wide
 *     Manager.employeeCode      @@unique([universityId, …])   — PER TENANT
 *     Instructor.employeeCode   @@unique([universityId, …])   — PER TENANT
 *     User.email                             @unique          — platform-wide
 *
 * The per-tenant ones matter: `MGR001` in one university and `MGR001` in
 * another are two different people, so every employee-code lookup is scoped by
 * the row's university. Names are never an identity key — two people share a
 * name and one person changes theirs.
 */

/** Fields the importer understands. Everything else in a file is ignored. */
export const CANONICAL_FIELDS = [
  "universityCode",
  "universityName",
  "universityTimezone",
  "managerCode",
  "managerName",
  "managerEmail",
  "instructorCode",
  "instructorName",
  "instructorEmail",
  "status",
] as const;

export type CanonicalField = (typeof CANONICAL_FIELDS)[number];

/** Source header -> canonical field. Unmapped headers are simply absent. */
export type ColumnMapping = Partial<Record<string, CanonicalField>>;

/**
 * One source row, already mapped onto canonical fields.
 *
 * Every value is the trimmed string as it appeared. Parsing into booleans and
 * enums happens in validation, so a bad value is reported against its row
 * rather than lost at read time.
 */
export type CanonicalRow = {
  /** 1-based line number in the source, for error messages the admin can act on. */
  rowNumber: number;
  values: Partial<Record<CanonicalField, string>>;
};

/* ── Diagnostics ───────────────────────────────────────────────────────────── */

export const IMPORT_ERROR_CODES = [
  "MISSING_REQUIRED_FIELD",
  "DUPLICATE_IDENTIFIER",
  "CROSS_TENANT_MAPPING_ERROR",
  "IDENTITY_CONFLICT",
  "INVALID_EMAIL",
  "INVALID_STATUS",
  "INVALID_TIMEZONE",
  "UNKNOWN_UNIVERSITY",
  "INCONSISTENT_UNIVERSITY_NAME",
  "ROLE_CONFLICT",
  "WRITE_FAILED",
] as const;

export type ImportErrorCode = (typeof IMPORT_ERROR_CODES)[number];

export const IMPORT_WARNING_CODES = [
  "DUPLICATE_ROW_IGNORED",
  "UNMAPPED_COLUMN",
  "INSTRUCTOR_UNASSIGNED",
  "WORKING_HOURS_NOT_CONFIGURED",
  "EXISTING_RECORD_UNCHANGED",
  "LOW_EXTRACTION_CONFIDENCE",
  "FILE_ALREADY_IMPORTED",
] as const;

export type ImportWarningCode = (typeof IMPORT_WARNING_CODES)[number];

export type ImportIssue = {
  /** 0 for dataset-level issues that belong to no single row. */
  rowNumber: number;
  code: ImportErrorCode | ImportWarningCode;
  message: string;
  field?: CanonicalField;
};

/**
 * How many issues of each kind are kept.
 *
 * A 10,000-row file with a wrong header produces 10,000 identical errors; the
 * admin needs the first handful and the total, not a response the browser
 * cannot render. The COUNT is always exact — only the list is truncated.
 */
export const MAX_REPORTED_ISSUES = 200;

/* ── What an import will do ────────────────────────────────────────────────── */

export type EntityPlan = { create: number; update: number; unchanged: number };

export type ImportPreview = {
  rowCount: number;
  validRows: number;
  universities: EntityPlan;
  managers: EntityPlan;
  instructors: EntityPlan;
  /** Instructors that will end up on no roster, which is a legitimate state. */
  unassignedInstructors: number;
  errorCount: number;
  warningCount: number;
};

export type ImportOutcome = {
  created: { universities: number; managers: number; instructors: number };
  updated: { universities: number; managers: number; instructors: number };
  skipped: number;
  failed: number;
};

/** Timezone strings the platform accepts, checked against the running ICU. */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Email shape. Deliberately permissive about the local part and strict about
 * the overall structure — the database's unique index is the real authority,
 * and rejecting a valid-but-unusual address would block a legitimate import.
 */
export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value) && value.length <= 320;
}

/**
 * A URL slug for a newly created university.
 *
 * Derived from the name because `University.slug` is required and unique but is
 * not organisational data anyone maintains in a staff file — it is a URL
 * detail. Deriving it mechanically is not the same as inventing a fact; the
 * caller still has to resolve collisions, which it does by suffixing the code.
 */
export function slugify(name: string): string {
  return (
    name
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "university"
  );
}
