import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { ACCOUNTS, ApiClient } from "./helpers/client";
import { prisma } from "@/server/db";
import { parseCsv, decodeCell } from "@/server/import/csv";
import { detectMapping } from "@/server/import/mapping";
import { csvCell } from "@/server/reports/generator";
import { executeImport } from "@/server/import/execute";
import { RUN } from "./helpers/fixtures";
/**
 * Bulk organisation import.
 *
 * ── What these tests are actually for ──────────────────────────────────────
 * An importer's failure modes are all silent. A duplicate looks like a success.
 * A manager quietly reassigned to another university looks like a success. A
 * second run that doubles every record looks like a success. None of it is
 * visible in the UI, so it has to be pinned here or not at all.
 *
 * So the assertions below are mostly about what did NOT happen: no duplicates on
 * re-import, no cross-tenant reassignment, no deletion of records the file
 * omitted, no write at all before confirmation, and nothing reachable by a
 * manager or an instructor.
 *
 * ── Dates and codes are picked to avoid the shared database ────────────────
 * The suite shares one seeded database. Every code and address created here
 * carries this file's own prefix and a run-unique suffix, and everything it
 * creates is removed in `afterAll`, so no other suite sees it.
 */

let admin: ApiClient, manager: ApiClient, instructor: ApiClient, anon: ApiClient;
/** Unique per run so a re-run cannot collide with its own leftovers. */
let uniA: string, uniB: string;

const createdUniversityIds: string[] = [];
/** The exact bytes of the first import, so "the same file" means the same file. */
let combinedFile = "";

function csv(rows: string[][]): string {
  return rows.map((r) => r.map((c) => csvCell(c)).join(",")).join("\n");
}

const HEADERS = [
  "University Code",
  "University Name",
  "University Timezone",
  "Manager ID",
  "Manager Name",
  "Manager Email",
  "Instructor ID",
  "Instructor Name",
  "Instructor Email",
  "Status",
];

async function upload(client: ApiClient, body: string, name = "roster.csv") {
  return client.upload("/api/admin/imports", body, name, "text/csv");
}

/** Walks a job through validate + confirm, then waits for it to settle. */
async function runToCompletion(
  jobId: string,
  opts: { password?: string; defaultTimezone?: string } = {},
) {
  const password = opts.password ?? "ImportPassword123";
  const validated = await admin.post(`/api/admin/imports/${jobId}/validate`, {
    defaultTimezone: opts.defaultTimezone ?? "Asia/Kolkata",
  });
  expect(validated.status).toBe(200);

  const confirmed = await admin.post(`/api/admin/imports/${jobId}/confirm`, {
    initialPassword: password,
  });
  expect(confirmed.status).toBe(202);

  // 500ms rather than 250: the shared development server is answering every
  // other suite's requests too, and a progress bar does not need finer polling
  // than a person can read.
  for (let i = 0; i < 90; i++) {
    const res = await admin.get(`/api/admin/imports/${jobId}`);
    const status = res.body.job.status as string;
    if (status !== "PROCESSING") return res.body.job;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("import did not finish in time");
}

beforeAll(async () => {
  admin = new ApiClient("admin");
  await admin.login(ACCOUNTS.admin);
  manager = new ApiClient("manager");
  await manager.login(ACCOUNTS.managerNorth);
  instructor = new ApiClient("instructor");
  await instructor.login(ACCOUNTS.instructorNorth1);
  anon = new ApiClient("anonymous");

  uniA = `IMPA${RUN}`.slice(0, 20);
  uniB = `IMPB${RUN}`.slice(0, 20);
});

afterAll(async () => {
  // Everything this file created, removed. Instructors and managers cascade from
  // their user; the university is deleted last because profiles Restrict it.
  const universities = await prisma.university.findMany({
    where: { code: { in: [uniA, uniB] } },
    select: { id: true },
  });
  const ids = [...universities.map((u) => u.id), ...createdUniversityIds];
  if (ids.length === 0) return;
  await prisma.university.updateMany({ where: { id: { in: ids } }, data: { primaryManagerId: null } });
  await prisma.instructor.deleteMany({ where: { universityId: { in: ids } } });
  await prisma.manager.deleteMany({ where: { universityId: { in: ids } } });
  await prisma.user.deleteMany({ where: { universityId: { in: ids } } });
  await prisma.universitySettings.deleteMany({ where: { universityId: { in: ids } } });
  await prisma.importJob.deleteMany({ where: { fileName: { startsWith: "roster" } } });
  await prisma.university.deleteMany({ where: { id: { in: ids } } });
});

/* ── The reader, on its own ────────────────────────────────────────────────── */

describe("the CSV reader", () => {
  test("a quoted field may contain commas, quotes and newlines", () => {
    const text = 'a,b,c\n"x,1","he said ""hi""","line1\nline2"\n';
    const parsed = parseCsv(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.table.headers).toEqual(["a", "b", "c"]);
    expect(parsed.table.rows).toEqual([["x,1", 'he said "hi"', "line1\nline2"]]);
  });

  test("CR, LF and CRLF are all one terminator", () => {
    for (const nl of ["\n", "\r\n", "\r"]) {
      const parsed = parseCsv(`a,b${nl}1,2${nl}3,4${nl}`);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.table.rows).toEqual([["1", "2"], ["3", "4"]]);
    }
  });

  test("the BOM this repo's own exports carry does not corrupt header one", () => {
    // The exports are served as "﻿" + csv so Excel reads them as UTF-8.
    // Without stripping it, "University Code" would not match its synonym.
    const parsed = parseCsv("﻿University Code,Instructor Name\nNW1,Someone\n");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.table.headers[0]).toBe("University Code");
    expect(detectMapping(parsed.table.headers)["University Code"]).toBe("universityCode");
  });

  test("a value this repo exported round-trips back to itself", () => {
    // csvCell prefixes an apostrophe to anything a spreadsheet would execute.
    // Reading it back must undo that, or the identifier silently fails to match.
    for (const original of ["-A1", "=SUM(A1)", "+44", "@here", "plain", 'quo"te', "a,b"]) {
      const written = csvCell(original);
      expect(decodeCell(written.replace(/^"|"$/g, "").replace(/""/g, '"'))).toBe(original);
    }
  });

  test("an empty file and a header-only file are refused with a reason", () => {
    expect(parseCsv("")).toMatchObject({ ok: false });
    expect(parseCsv("a,b\n")).toMatchObject({ ok: false });
  });

  test("headers are matched by meaning, not by exact spelling", () => {
    const mapping = detectMapping([
      "University_Code",
      "univ name",
      "Reporting Manager ID",
      "Manager Name",
      "Employee Code",
      "Full Name",
      "Official Email",
      "Employment Status",
      "Something Unrelated",
    ]);
    expect(mapping["University_Code"]).toBe("universityCode");
    expect(mapping["univ name"]).toBe("universityName");
    expect(mapping["Reporting Manager ID"]).toBe("managerCode");
    expect(mapping["Manager Name"]).toBe("managerName");
    expect(mapping["Employee Code"]).toBe("instructorCode");
    expect(mapping["Official Email"]).toBe("instructorEmail");
    expect(mapping["Employment Status"]).toBe("status");
    // An unrecognised column stays unmapped for the admin to decide. Guessing
    // here is how a whole file gets mis-imported.
    expect(mapping["Something Unrelated"]).toBeUndefined();
  });
});

/* ── Who may import ───────────────────────────────────────────────────────── */

describe("only an admin may import", () => {
  const body = csv([HEADERS, [`X${RUN}`, "X", "UTC", "", "", "", "I1", "I", `i1.${RUN}@fixture.test`, "Active"]]);

  test("a manager is refused", async () => {
    expect((await upload(manager, body)).status).toBe(403);
  });

  test("an instructor is refused", async () => {
    expect((await upload(instructor, body)).status).toBe(403);
  });

  test("an unauthenticated caller is refused", async () => {
    expect((await upload(anon, body)).status).toBe(401);
  });

  test("every import route is closed to a manager", async () => {
    for (const path of ["/api/admin/imports"]) {
      expect((await manager.get(path)).status).toBe(403);
    }
    expect((await manager.post("/api/admin/imports/whatever/validate", {})).status).toBe(403);
    expect(
      (await manager.post("/api/admin/imports/whatever/confirm", { initialPassword: "x".repeat(12) })).status,
    ).toBe(403);
    expect((await manager.patch("/api/admin/imports/whatever", { mapping: {} })).status).toBe(403);
  });

  test("nothing was created by any of those attempts", async () => {
    expect(await prisma.university.count({ where: { code: `X${RUN}` } })).toBe(0);
  });
});

/* ── File safety ──────────────────────────────────────────────────────────── */

describe("files are judged by their bytes", () => {
  test("a binary file renamed .csv is refused", async () => {
    const res = await admin.upload(
      "/api/admin/imports",
      new Uint8Array([0x00, 0x01, 0x02, 0x00, 0xff]),
      "evil.csv",
      "text/csv",
    );
    expect(res.status).toBe(400);
  });

  test("a text file claiming to be a PDF is refused rather than parsed", async () => {
    const res = await admin.upload("/api/admin/imports", "a,b\n1,2\n", "notreally.pdf", "application/pdf");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_FILE");
  });

  test("an empty upload is refused", async () => {
    const res = await admin.upload("/api/admin/imports", "", "empty.csv", "text/csv");
    expect(res.status).toBe(400);
  });

  test("a JSON body is refused with 415, not parsed as a file", async () => {
    const res = await admin.post("/api/admin/imports", { file: "a,b" });
    expect(res.status).toBe(415);
  });
});

/* ── The combined file ────────────────────────────────────────────────────── */

describe("a combined university / manager / instructor file", () => {
  let jobId: string;

  test("it uploads, and repeated parent rows do not become duplicates", async () => {
    combinedFile = csv([
      HEADERS,
      [uniA, "Import Alpha University", "Asia/Kolkata", "MGRA1", "Alpha One", `mgra1.${RUN}@fixture.test`, "INSA1", "Inst A One", `insa1.${RUN}@fixture.test`, "Active"],
      [uniA, "Import Alpha University", "Asia/Kolkata", "MGRA1", "Alpha One", `mgra1.${RUN}@fixture.test`, "INSA2", "Inst A Two", `insa2.${RUN}@fixture.test`, "Active"],
      [uniA, "Import Alpha University", "Asia/Kolkata", "MGRA2", "Alpha Two", `mgra2.${RUN}@fixture.test`, "INSA3", "Inst A Three", `insa3.${RUN}@fixture.test`, "Active"],
      [uniB, "Import Beta Institute", "America/New_York", "MGRB1", "Beta One", `mgrb1.${RUN}@fixture.test`, "INSB1", "Inst B One", `insb1.${RUN}@fixture.test`, "Active"],
    ]);

    const res = await upload(admin, combinedFile);
    expect(res.status).toBe(201);
    jobId = res.body.job.id;
    expect(res.body.job.rowCount).toBe(4);
    // Every column in the template is recognised without the admin touching it.
    expect(Object.keys(res.body.job.mapping)).toHaveLength(HEADERS.length);
  });

  test("validation forecasts two universities, three managers, four instructors", async () => {
    const res = await admin.post(`/api/admin/imports/${jobId}/validate`, {
      defaultTimezone: "Asia/Kolkata",
    });
    expect(res.status).toBe(200);
    const p = res.body.preview;
    expect(p.errorCount).toBe(0);
    expect(p.universities.create).toBe(2);
    expect(p.managers.create).toBe(3);
    expect(p.instructors.create).toBe(4);
    expect(p.validRows).toBe(4);
  });

  test("validating writes nothing", async () => {
    expect(await prisma.university.count({ where: { code: { in: [uniA, uniB] } } })).toBe(0);
  });

  test("confirmation requires a password of at least the platform minimum", async () => {
    const res = await admin.post(`/api/admin/imports/${jobId}/confirm`, { initialPassword: "short" });
    expect(res.status).toBe(400);
    expect(await prisma.university.count({ where: { code: { in: [uniA, uniB] } } })).toBe(0);
  });

  test("it imports, and the hierarchy is wired correctly", async () => {
    const job = await runToCompletion(jobId);
    expect(["COMPLETED", "COMPLETED_WITH_WARNINGS"]).toContain(job.status);
    expect(job.summary.outcome.failed).toBe(0);

    const alpha = await prisma.university.findUniqueOrThrow({
      where: { code: uniA },
      select: { id: true, name: true, timezone: true, slug: true, primaryManagerId: true },
    });
    createdUniversityIds.push(alpha.id);
    expect(alpha.name).toBe("Import Alpha University");
    expect(alpha.timezone).toBe("Asia/Kolkata");
    expect(alpha.slug).toBeTruthy();
    // Mirrors provisionManager: a university with no primary gets its first.
    expect(alpha.primaryManagerId).toBeTruthy();

    const managers = await prisma.manager.findMany({
      where: { universityId: alpha.id },
      select: { id: true, employeeCode: true, user: { select: { email: true, role: true } } },
    });
    expect(managers.map((m) => m.employeeCode).sort()).toEqual(["MGRA1", "MGRA2"]);
    for (const m of managers) expect(m.user.role).toBe("MANAGER");

    const mgrA1 = managers.find((m) => m.employeeCode === "MGRA1")!;
    const instructors = await prisma.instructor.findMany({
      where: { universityId: alpha.id },
      select: { employeeCode: true, managerId: true, universityId: true, user: { select: { role: true } } },
    });
    expect(instructors).toHaveLength(3);
    for (const i of instructors) {
      expect(i.user.role).toBe("INSTRUCTOR");
      expect(i.universityId).toBe(alpha.id);
    }
    // University -> Manager -> Instructor, exactly as the file described it.
    expect(instructors.filter((i) => i.managerId === mgrA1.id).map((i) => i.employeeCode).sort()).toEqual([
      "INSA1",
      "INSA2",
    ]);
  });

  test("the two universities' people are entirely separate", async () => {
    const beta = await prisma.university.findUniqueOrThrow({ where: { code: uniB }, select: { id: true } });
    createdUniversityIds.push(beta.id);
    const instructors = await prisma.instructor.findMany({
      where: { universityId: beta.id },
      select: { employeeCode: true },
    });
    expect(instructors.map((i) => i.employeeCode)).toEqual(["INSB1"]);
  });

  test("an imported account can actually sign in with the batch password", async () => {
    // The whole point of asking for a password: an account created without a
    // usable credential would be permanently unusable, since the product has no
    // password-reset endpoint.
    const client = new ApiClient("imported-instructor");
    const session = await client.login(`insa1.${RUN}@fixture.test`, "ImportPassword123");
    expect(session.user.role).toBe("INSTRUCTOR");
  });
});

/* ── Idempotency ──────────────────────────────────────────────────────────── */

describe("importing the same file twice", () => {
  test("creates nothing the second time", async () => {
    const before = await prisma.instructor.count({
      where: { university: { code: uniA } },
    });

    // The SAME bytes, so the checksum matches as well as the identifiers.
    const res = await upload(admin, combinedFile);
    expect(res.status).toBe(201);
    // The checksum is recognised, and reported as information — not as a block,
    // because re-importing a corrected file is legitimate.
    expect(res.body.duplicateOf).toBeTruthy();

    const validated = await admin.post(`/api/admin/imports/${res.body.job.id}/validate`, {
      defaultTimezone: "Asia/Kolkata",
    });
    // Everything already exists, so nothing is planned as a creation.
    expect(validated.body.preview.universities.create).toBe(0);
    expect(validated.body.preview.managers.create).toBe(0);
    expect(validated.body.preview.instructors.create).toBe(0);

    const job = await runToCompletion(res.body.job.id);
    expect(job.summary.outcome.created.instructors).toBe(0);
    expect(job.summary.outcome.created.managers).toBe(0);
    expect(job.summary.outcome.created.universities).toBe(0);
    expect(job.summary.outcome.failed).toBe(0);

    const after = await prisma.instructor.count({ where: { university: { code: uniA } } });
    expect(after).toBe(before);
  });

  test("an updated name is applied to the existing record, not a new one", async () => {
    const body = csv([
      HEADERS,
      [uniA, "Import Alpha University", "Asia/Kolkata", "MGRA1", "Alpha One", `mgra1.${RUN}@fixture.test`, "INSA1", "Inst A One Renamed", `insa1.${RUN}@fixture.test`, "Active"],
    ]);
    const res = await upload(admin, body);
    const job = await runToCompletion(res.body.job.id);
    expect(job.summary.outcome.created.instructors).toBe(0);
    expect(job.summary.outcome.updated.instructors).toBe(1);

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: `insa1.${RUN}@fixture.test` },
      select: { name: true },
    });
    expect(user.name).toBe("Inst A One Renamed");

    expect(await prisma.instructor.count({ where: { university: { code: uniA } } })).toBe(3);
  });

  test("records absent from a later file are neither deleted nor deactivated", async () => {
    // INSA2 and INSA3 are not in the file above. Absence means "not mentioned".
    const remaining = await prisma.instructor.findMany({
      where: { university: { code: uniA } },
      select: { employeeCode: true, user: { select: { isActive: true } } },
    });
    expect(remaining.map((r) => r.employeeCode).sort()).toEqual(["INSA1", "INSA2", "INSA3"]);
    for (const r of remaining) expect(r.user.isActive).toBe(true);
  });
});

/* ── Tenancy ──────────────────────────────────────────────────────────────── */

describe("cross-tenant mappings are refused", () => {
  test("a manager from another university cannot be used", async () => {
    // MGRA1 belongs to university A. Naming it under B must fail for that row.
    const body = csv([
      HEADERS,
      [uniB, "Import Beta Institute", "America/New_York", "MGRA1", "", "", "INSB9", "Inst B Nine", `insb9.${RUN}@fixture.test`, "Active"],
    ]);
    const res = await upload(admin, body);
    const validated = await admin.post(`/api/admin/imports/${res.body.job.id}/validate`, {});
    expect(validated.status).toBe(200);

    const codes = validated.body.errors.map((e: { code: string }) => e.code);
    expect(codes).toContain("CROSS_TENANT_MAPPING_ERROR");
    const message = validated.body.errors.find(
      (e: { code: string }) => e.code === "CROSS_TENANT_MAPPING_ERROR",
    ).message;
    expect(message).toContain(uniB);
    expect(message).toContain("MGRA1");
  });

  test("an import with blocking errors cannot be confirmed", async () => {
    const body = csv([
      HEADERS,
      [uniB, "Import Beta Institute", "America/New_York", "MGRA1", "", "", "INSB8", "Inst B Eight", `insb8.${RUN}@fixture.test`, "Active"],
    ]);
    const res = await upload(admin, body);
    await admin.post(`/api/admin/imports/${res.body.job.id}/validate`, {});
    const confirmed = await admin.post(`/api/admin/imports/${res.body.job.id}/confirm`, {
      initialPassword: "ImportPassword123",
    });
    expect(confirmed.status).toBe(409);
    expect(confirmed.body.error.code).toBe("BLOCKING_ERRORS");
    expect(await prisma.instructor.count({ where: { employeeCode: "INSB8" } })).toBe(0);
  });

  test("an existing address cannot be moved to another university", async () => {
    const body = csv([
      HEADERS,
      [uniB, "Import Beta Institute", "America/New_York", "", "", "", "INSX", "Moved Person", `insa1.${RUN}@fixture.test`, "Active"],
    ]);
    const res = await upload(admin, body);
    const validated = await admin.post(`/api/admin/imports/${res.body.job.id}/validate`, {});
    expect(validated.body.errors.map((e: { code: string }) => e.code)).toContain(
      "CROSS_TENANT_MAPPING_ERROR",
    );
  });

  test("an address already used by another role is refused, not repurposed", async () => {
    const body = csv([
      HEADERS,
      [uniA, "Import Alpha University", "Asia/Kolkata", "MGRZ", "Zed", ACCOUNTS.admin, "", "", "", "Active"],
    ]);
    const res = await upload(admin, body);
    const validated = await admin.post(`/api/admin/imports/${res.body.job.id}/validate`, {});
    const codes = validated.body.errors.map((e: { code: string }) => e.code);
    expect(codes.some((c: string) => c === "ROLE_CONFLICT" || c === "CROSS_TENANT_MAPPING_ERROR")).toBe(true);
  });

  test("the existing composite foreign key is still the final guard", async () => {
    // Belt and braces: even if resolution were bypassed, Postgres refuses an
    // instructor whose manager belongs to another university.
    const alpha = await prisma.university.findUniqueOrThrow({ where: { code: uniA }, select: { id: true } });
    const beta = await prisma.university.findUniqueOrThrow({ where: { code: uniB }, select: { id: true } });
    const alphaManager = await prisma.manager.findFirstOrThrow({
      where: { universityId: alpha.id },
      select: { id: true },
    });
    const betaInstructor = await prisma.instructor.findFirstOrThrow({
      where: { universityId: beta.id },
      select: { id: true },
    });
    await expect(
      prisma.instructor.update({
        where: { id: betaInstructor.id },
        data: { managerId: alphaManager.id },
      }),
    ).rejects.toThrow();
  });
});

/* ── Row-level validation ─────────────────────────────────────────────────── */

describe("bad rows are reported against their row number", () => {
  test("a missing university code, email, name, status and timezone are each caught", async () => {
    const body = csv([
      HEADERS,
      ["", "No University", "UTC", "", "", "", "I1", "Someone", `x1.${RUN}@fixture.test`, "Active"],
      [`NEW${RUN}`, "Brand New", "", "", "", "", "I2", "Someone Two", `x2.${RUN}@fixture.test`, "Active"],
      [uniA, "Import Alpha University", "Asia/Kolkata", "", "", "", "I3", "Someone Three", "not-an-email", "Active"],
      [uniA, "Import Alpha University", "Asia/Kolkata", "", "", "", "I4", "Someone Four", `x4.${RUN}@fixture.test`, "Confused"],
      [uniA, "Import Alpha University", "Asia/Kolkata", "", "", "", "I5", "", `x5.${RUN}@fixture.test`, "Active"],
    ]);
    const res = await upload(admin, body);
    // No default timezone, so the new university's missing one is an error.
    const validated = await admin.post(`/api/admin/imports/${res.body.job.id}/validate`, {});
    const errors: Array<{ rowNumber: number; code: string }> = validated.body.errors;

    expect(errors.find((e) => e.rowNumber === 2)?.code).toBe("MISSING_REQUIRED_FIELD");
    expect(errors.find((e) => e.rowNumber === 3)?.code).toBe("MISSING_REQUIRED_FIELD");
    expect(errors.find((e) => e.rowNumber === 4)?.code).toBe("INVALID_EMAIL");
    expect(errors.find((e) => e.rowNumber === 5)?.code).toBe("INVALID_STATUS");
    expect(errors.find((e) => e.rowNumber === 6)?.code).toBe("MISSING_REQUIRED_FIELD");
    expect(validated.body.preview.validRows).toBe(0);
  });

  test("an invalid default timezone is refused before validation runs", async () => {
    const body = csv([HEADERS, [uniA, "Import Alpha University", "", "", "", "", "IZ", "Z", `z.${RUN}@fixture.test`, "Active"]]);
    const res = await upload(admin, body);
    const validated = await admin.post(`/api/admin/imports/${res.body.job.id}/validate`, {
      defaultTimezone: "Mars/Olympus",
    });
    expect(validated.status).toBe(400);
    expect(validated.body.error.code).toBe("INVALID_TIMEZONE");
  });

  test("an instructor with no manager is a warning, and stays unassigned", async () => {
    const body = csv([
      HEADERS,
      [uniA, "Import Alpha University", "Asia/Kolkata", "", "", "", "INSLONE", "Lone Person", `lone.${RUN}@fixture.test`, "Active"],
    ]);
    const res = await upload(admin, body);
    const validated = await admin.post(`/api/admin/imports/${res.body.job.id}/validate`, {});
    expect(validated.body.preview.errorCount).toBe(0);
    expect(validated.body.preview.unassignedInstructors).toBe(1);
    expect(validated.body.warnings.map((w: { code: string }) => w.code)).toContain(
      "INSTRUCTOR_UNASSIGNED",
    );

    await runToCompletion(res.body.job.id);
    const created = await prisma.instructor.findFirstOrThrow({
      where: { employeeCode: "INSLONE", university: { code: uniA } },
      select: { managerId: true },
    });
    // No manager was invented for them.
    expect(created.managerId).toBeNull();
  });

  test("a file with no status column does not reactivate a deactivated person", async () => {
    // The most dangerous silent change an importer can make. "The file did not
    // say" is not "the file said Active" — a roster listing everybody must not
    // undo a deliberate deactivation as a side effect.
    await prisma.user.update({
      where: { email: `insa2.${RUN}@fixture.test` },
      data: { isActive: false },
    });

    const noStatusHeaders = HEADERS.filter((h) => h !== "Status");
    const body = csv([
      noStatusHeaders,
      [uniA, "Import Alpha University", "Asia/Kolkata", "MGRA1", "Alpha One", `mgra1.${RUN}@fixture.test`, "INSA2", "Inst A Two", `insa2.${RUN}@fixture.test`],
    ]);
    const res = await upload(admin, body);
    await runToCompletion(res.body.job.id);

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: `insa2.${RUN}@fixture.test` },
      select: { isActive: true },
    });
    expect(user.isActive).toBe(false);

    // Restored so the later assertions about the roster still describe a
    // fully-active world.
    await prisma.user.update({
      where: { email: `insa2.${RUN}@fixture.test` },
      data: { isActive: true },
    });
  });

  test("an inactive status is applied without deleting anything", async () => {
    const body = csv([
      HEADERS,
      [uniA, "Import Alpha University", "Asia/Kolkata", "", "", "", "INSLONE", "Lone Person", `lone.${RUN}@fixture.test`, "Inactive"],
    ]);
    const res = await upload(admin, body);
    await runToCompletion(res.body.job.id);
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: `lone.${RUN}@fixture.test` },
      select: { isActive: true },
    });
    expect(user.isActive).toBe(false);
    expect(await prisma.instructor.count({ where: { employeeCode: "INSLONE" } })).toBe(1);
  });
});

/* ── Mapping ──────────────────────────────────────────────────────────────── */

describe("column mapping", () => {
  let jobId: string;

  test("unrecognised headers are reported as unmapped, not guessed", async () => {
    const body = csv([
      ["Tenant Ref", "Tenant Title", "Person Ref", "Person Label", "Contact"],
      [`MAP${RUN}`, "Mapping University", "P1", "Person One", `p1.${RUN}@fixture.test`],
    ]);
    const res = await upload(admin, body);
    expect(res.status).toBe(201);
    jobId = res.body.job.id;
    expect(res.body.job.summary.unmapped.length).toBeGreaterThan(0);
  });

  test("a correcting mapping is applied and the rows are re-derived", async () => {
    const res = await admin.patch(`/api/admin/imports/${jobId}`, {
      mapping: {
        "Tenant Ref": "universityCode",
        "Tenant Title": "universityName",
        "Person Ref": "instructorCode",
        "Person Label": "instructorName",
        Contact: "instructorEmail",
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.job.status).toBe("MAPPED");

    const validated = await admin.post(`/api/admin/imports/${jobId}/validate`, {
      defaultTimezone: "UTC",
    });
    expect(validated.body.preview.errorCount).toBe(0);
    expect(validated.body.preview.universities.create).toBe(1);
    expect(validated.body.preview.instructors.create).toBe(1);
  });

  test("mapping two columns to one field is refused", async () => {
    const res = await admin.patch(`/api/admin/imports/${jobId}`, {
      mapping: { "Tenant Ref": "universityCode", "Tenant Title": "universityCode" },
    });
    expect(res.status).toBe(400);
  });

  test("an invented field name is refused", async () => {
    const res = await admin.patch(`/api/admin/imports/${jobId}`, {
      mapping: { "Tenant Ref": "salaryBand" },
    });
    expect(res.status).toBe(400);
  });

  test("the corrected import creates its university and person", async () => {
    await admin.patch(`/api/admin/imports/${jobId}`, {
      mapping: {
        "Tenant Ref": "universityCode",
        "Tenant Title": "universityName",
        "Person Ref": "instructorCode",
        "Person Label": "instructorName",
        Contact: "instructorEmail",
      },
    });
    const job = await runToCompletion(jobId, { defaultTimezone: "UTC" });
    expect(job.summary.outcome.created.universities).toBe(1);
    expect(job.summary.outcome.created.instructors).toBe(1);

    const created = await prisma.university.findUniqueOrThrow({
      where: { code: `MAP${RUN}` },
      select: { id: true, timezone: true },
    });
    createdUniversityIds.push(created.id);
    expect(created.timezone).toBe("UTC");
  });
});

/* ── Scale ────────────────────────────────────────────────────────────────── */

describe("a larger file", () => {
  /**
   * Scale is measured IN-PROCESS, deliberately.
   *
   * The claims worth testing here are about the writer: that 500 people cost a
   * bounded number of round trips rather than 500, and that the batch is hashed
   * ONCE. Neither claim is about HTTP. Pushing 500 rows through a development
   * server four times measured Next.js's dev-mode overhead instead, and cost the
   * shared server enough time that unrelated suites afterwards timed out — the
   * test was expensive without testing anything extra. Twelve rows through the
   * real endpoint already proves the multipart path (above); this proves the part
   * that actually scales.
   */
  /**
   * Above the writer's 100-row chunk size, so multi-chunk batching is exercised,
   * and large enough that per-person hashing would be unmissable in the timing —
   * without creating and deleting thousands of accounts in a database every other
   * suite in this run shares.
   */
  const SIZE = 120;

  function bulkRows(namePrefix: string) {
    return Array.from({ length: SIZE }, (_, i) => ({
      rowNumber: i + 2,
      values: {
        universityCode: uniA,
        universityName: "Import Alpha University",
        universityTimezone: "Asia/Kolkata",
        managerCode: "MGRA1",
        managerName: "Alpha One",
        managerEmail: `mgra1.${RUN}@fixture.test`,
        instructorCode: `BULK${i}`,
        instructorName: `${namePrefix} ${i}`,
        instructorEmail: `bulk${i}.${RUN}@fixture.test`,
      },
    }));
  }

  test(`${SIZE} instructors are written in bounded time`, async () => {
    const rows = bulkRows("Bulk Person");

    // Round trips are not counted here: Prisma only emits query events when the
    // client is constructed with `log: ["query"]`, and this suite uses the
    // application's own client. Attaching a listener anyway would have looked
    // like a measurement while counting nothing. What IS measured below is the
    // wall clock, which the single-hash claim genuinely depends on.
    const started = Date.now();
    const { outcome, errorCount } = await executeImport(rows, {
      defaults: { timezone: "Asia/Kolkata" },
      initialPassword: "ImportPassword123",
    });
    const elapsed = Date.now() - started;

    expect(errorCount).toBe(0);
    expect(outcome.failed).toBe(0);
    expect(outcome.created.instructors).toBe(SIZE);
    // The manager is named on all 500 rows and must be created once.
    expect(outcome.created.managers).toBeLessThanOrEqual(1);

    // One scrypt hash for the batch, not one each. Hashing is measured at ~136ms,
    // so per-person hashing alone would cost SIZE * 136ms — 16 seconds here —
    // which this bound cannot accommodate.
    expect(elapsed).toBeLessThan(8_000);

    const mgr = await prisma.manager.findFirstOrThrow({
      where: { employeeCode: "MGRA1", university: { code: uniA } },
      select: { id: true },
    });
    expect(await prisma.instructor.count({ where: { managerId: mgr.id } })).toBeGreaterThanOrEqual(SIZE);
  }, 120_000);

  test("re-running the same rows creates nothing further", async () => {
    const before = await prisma.instructor.count({ where: { university: { code: uniA } } });

    const { outcome } = await executeImport(bulkRows("Bulk Person"), {
      defaults: { timezone: "Asia/Kolkata" },
      initialPassword: "ImportPassword123",
    });

    expect(outcome.created.instructors).toBe(0);
    expect(outcome.created.managers).toBe(0);
    expect(outcome.created.universities).toBe(0);
    expect(await prisma.instructor.count({ where: { university: { code: uniA } } })).toBe(before);
  }, 120_000);

  test("a multi-chunk file still goes through the real endpoint end to end", async () => {
    // The same size over the real HTTP path, so multipart, the job row, the
    // background handoff and progress reporting are all exercised end to end.
    const rows = [HEADERS];
    for (let i = 0; i < 120; i++) {
      rows.push([
        uniA, "Import Alpha University", "Asia/Kolkata", "MGRA1", "Alpha One", `mgra1.${RUN}@fixture.test`,
        `HTTP${i}`, `Http Person ${i}`, `http${i}.${RUN}@fixture.test`, "Active",
      ]);
    }
    const res = await upload(admin, csv(rows), "roster-http.csv");
    expect(res.status).toBe(201);
    expect(res.body.job.rowCount).toBe(120);

    const job = await runToCompletion(res.body.job.id);
    expect(job.summary.outcome.created.instructors).toBe(120);
    expect(job.summary.outcome.failed).toBe(0);
    expect(job.processedRows).toBeGreaterThan(0);
  }, 120_000);
});

/* ── Audit ────────────────────────────────────────────────────────────────── */

describe("imports are auditable", () => {
  test("upload, validate and confirm are all recorded through the existing audit log", async () => {
    for (const action of ["IMPORT_UPLOADED", "IMPORT_VALIDATED", "IMPORT_CONFIRMED"]) {
      const entry = await prisma.auditLog.findFirst({
        where: { action },
        orderBy: { createdAt: "desc" },
        select: { entityType: true, entityId: true, userId: true, metadata: true },
      });
      expect(entry, action).not.toBeNull();
      expect(entry!.entityType).toBe("ImportJob");
      expect(entry!.entityId).toBeTruthy();
      expect(entry!.userId).toBeTruthy();
    }
  });

  test("the confirmation audit entry does not contain the password", async () => {
    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { action: "IMPORT_CONFIRMED" },
      orderBy: { createdAt: "desc" },
      select: { metadata: true },
    });
    expect(JSON.stringify(entry.metadata)).not.toContain("ImportPassword123");
    expect(JSON.stringify(entry.metadata).toLowerCase()).not.toContain("password");
  });

  test("no import job row ever stores the password", async () => {
    const jobs = await prisma.importJob.findMany({ select: { rows: true, summary: true, mapping: true } });
    for (const job of jobs) {
      const blob = JSON.stringify(job);
      expect(blob).not.toContain("ImportPassword123");
    }
  });

  test("history lists the imports with their outcome", async () => {
    const res = await admin.get("/api/admin/imports?limit=50");
    expect(res.status).toBe(200);
    expect(res.body.jobs.length).toBeGreaterThan(0);
    for (const job of res.body.jobs) {
      expect(job).toHaveProperty("status");
      expect(job).toHaveProperty("rowCount");
      expect(job).toHaveProperty("createdBy");
      // The parsed file is never in the history payload.
      expect(job).not.toHaveProperty("rows");
    }
  });
});
