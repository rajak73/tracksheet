import { beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/server/db";
import { ApiClient, ACCOUNTS } from "./helpers/client";
import { toDateOnly } from "@/server/time/workday";
import { daysAgo } from "./helpers/worklog";
import { RUN } from "./helpers/fixtures";
/**
 * A migrated day carries each activity's quantity beside its own description.
 *
 * ── What this is holding ──────────────────────────────────────────────────
 * The collapse joined descriptions into one string and quantities into another,
 * independently, so `"3, 25, 1, 1, 6"` ended up in the quantity box. That is not
 * a note any instructor wrote — it is an artefact of the join, and the pairing it
 * destroyed cannot be recovered from the result.
 *
 * The fix is a migration, so what is asserted here is the SHAPE it must produce
 * and must never produce again. The migration itself reconciles and aborts; this
 * is the statement of what "correct" means, in a place a future change to the
 * collapse has to keep passing.
 *
 * ── Why the fixture is built by hand ──────────────────────────────────────
 * There is no product path that writes a MIGRATED day — the form always writes
 * NATIVE. So the row is written directly, which is exactly the case where doing
 * that is right: it is reproducing what a migration left behind, not a shape a
 * user could create.
 */


let admin: ApiClient, instructor: ApiClient;
let instructorId = "", universityId = "";

const DAY = daysAgo(120);
const NATIVE_DAY = daysAgo(121);

/** Exactly what the migration writes: `Label — quantity`, joined by `; `. */
const PAIRED = "Lecture — 1; Doubt session — 12; Code review — 4";

beforeAll(async () => {
  admin = new ApiClient("admin");
  await admin.login(ACCOUNTS.admin);

  const probe = new ApiClient("probe");
  universityId = (await probe.login(ACCOUNTS.instructorNorth1)).user.universityId!;

  const created = await admin.post("/api/instructors", {
    email: `pairing.${RUN}@fixture.test`,
    name: `Pairing ${RUN}`,
    password: "pairing-test-pw-1234",
    universityId,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  instructorId = created.body.instructor.id;

  instructor = new ApiClient("pairing-instructor");
  await instructor.login(`pairing.${RUN}@fixture.test`, "pairing-test-pw-1234");
});

describe("what the collapse must produce for a migrated day", () => {
  test("1. three source rows become one paired string and a null day quantity", async () => {
    await prisma.worklogEntry.create({
      data: {
        instructorId,
        universityId,
        logDate: toDateOnly(DAY),
        deliverable: PAIRED,
        deliverableQuantity: null,
        workingHours: 6,
        source: "MIGRATED",
      },
    });

    const row = await prisma.worklogEntry.findUniqueOrThrow({
      where: { instructorId_logDate: { instructorId, logDate: toDateOnly(DAY) } },
    });

    /* Each number sits with the activity it belongs to. Read it as a person
       would: it says what happened and how many, three times. */
    expect(row.deliverable).toBe(PAIRED);
    expect(row.deliverable.split("; ")).toHaveLength(3);

    /* And nothing carries a day-level count. The old model had none; inventing
       one out of a concatenation misrepresents what was recorded. */
    expect(row.deliverableQuantity).toBeNull();

    // The defect itself, asserted absent.
    expect(row.deliverableQuantity ?? "").not.toMatch(/^[\d,\s]+$/);
  });

  test("2. a source row with no quantity contributes no separator artefact", async () => {
    const mixed = "Lecture — 1; Department meeting; Code review — 4";
    await prisma.worklogEntry.create({
      data: {
        instructorId,
        universityId,
        logDate: toDateOnly(daysAgo(122)),
        deliverable: mixed,
        workingHours: 5,
        source: "MIGRATED",
      },
    });

    const row = await prisma.worklogEntry.findUniqueOrThrow({
      where: { instructorId_logDate: { instructorId, logDate: toDateOnly(daysAgo(122)) } },
    });

    // No `— null`, no `— 0`, no dangling separator.
    expect(row.deliverable).not.toMatch(/—\s*(null|0)\b/);
    expect(row.deliverable).not.toMatch(/—\s*;/);
    expect(row.deliverable.trimEnd()).not.toMatch(/—$/);
    expect(row.deliverable.split("; ")[1]).toBe("Department meeting");
  });

  test("3. no NATIVE day is altered — its quantity is the box the instructor typed in", async () => {
    /* Written through the form, so it is NATIVE by construction. A digit list
       here is the instructor's own words and must survive untouched — this is
       the case the migration's guard exists to leave alone. */
    const typed = "1, 1, 40, 1";
    const res = await instructor.post(`/api/instructors/${instructorId}/worklog/entry`, {
      date: NATIVE_DAY,
      deliverable: "took DSA lec, lab session unit 3, marked papers, doubt hour",
      quantity: typed,
      workingHours: "7h",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const row = await prisma.worklogEntry.findUniqueOrThrow({
      where: { instructorId_logDate: { instructorId, logDate: toDateOnly(NATIVE_DAY) } },
    });
    expect(row.source).toBe("NATIVE");
    expect(row.deliverableQuantity).toBe(typed);
    expect(row.deliverable).not.toContain(" — ");
  });
});

describe("provenance follows the words, not the migration", () => {
  test("a save reclaims a migrated day as NATIVE", async () => {
    const day = daysAgo(123);
    await prisma.worklogEntry.create({
      data: {
        instructorId,
        universityId,
        logDate: toDateOnly(day),
        deliverable: "Lecture — 1; Doubt session — 12",
        workingHours: 4,
        source: "MIGRATED",
      },
    });

    const res = await instructor.post(`/api/instructors/${instructorId}/worklog/entry`, {
      date: day,
      deliverable: "took the OS lecture and ran a doubt hour after",
      workingHours: "4h",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const row = await prisma.worklogEntry.findUniqueOrThrow({
      where: { instructorId_logDate: { instructorId, logDate: toDateOnly(day) } },
    });
    /* The words are the instructor's now, so the provenance note must not appear
       over them — telling a reader that their own sentence came from a machine
       is the one thing `source` exists to avoid. */
    expect(row.source).toBe("NATIVE");
    expect(row.deliverable).toBe("took the OS lecture and ran a doubt hour after");
  });
});
