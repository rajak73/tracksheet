import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  ACTIVITY_TYPES,
  ACTIVITY_TYPE_CODES,
  ACTIVITY_TYPE_COUNT,
  provisionActivityTypes,
  DELIVERABLE_TYPES,
  DELIVERABLE_TYPE_CODES,
  DELIVERABLE_TYPE_COUNT,
  ENTRY_CATEGORY_CODES,
} from "../prisma/reference-data";

/**
 * Reference-data provisioning.
 *
 * The bug this guards against was not a schema fault: `prisma migrate deploy`
 * produced a structurally perfect database with zero `ActivityType` rows,
 * because the only code that created them lived inside the destructive seed
 * that production is forbidden to run. A fresh deployment therefore could not
 * record a single activity.
 *
 * These tests run against their own throwaway database — genuinely empty, which
 * is the exact production situation — so "provisions a fresh database" is
 * proven rather than assumed, and the shared seeded database is never touched.
 */

const SCRATCH_DB = "tracksheet_refdata_scratch";

let empty: PrismaClient;
let scratchUrl: string;

function urlFor(database: string): string {
  const u = new URL(process.env.DATABASE_URL!);
  u.pathname = `/${database}`;
  return u.toString();
}

async function maintenance(sql: string): Promise<void> {
  const client = new Client({ connectionString: urlFor("postgres") });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  await maintenance(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`);
  await maintenance(`CREATE DATABASE ${SCRATCH_DB}`);

  scratchUrl = urlFor(SCRATCH_DB);
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: scratchUrl },
    stdio: "pipe",
  });

  empty = new PrismaClient({ adapter: new PrismaPg({ connectionString: scratchUrl }) });
});

afterAll(async () => {
  await empty?.$disconnect();
  await maintenance(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`);
});

describe("the state migrate deploy actually leaves behind", () => {
  test("a migrated database has NO activity types — this is the bug", async () => {
    expect(await empty.activityType.count()).toBe(0);
  });
});

describe("provisioning a fresh database", () => {
  test("creates exactly the canonical set", async () => {
    const result = await provisionActivityTypes(empty);

    expect(result.created).toHaveLength(ACTIVITY_TYPE_COUNT);
    expect(result.updated).toHaveLength(0);
    expect(await empty.activityType.count()).toBe(ACTIVITY_TYPE_COUNT);
  });

  test("every canonical code is present", async () => {
    const rows = await empty.activityType.findMany({ select: { code: true } });
    expect(rows.map((r) => r.code).sort()).toEqual([...ACTIVITY_TYPE_CODES].sort());
  });

  test("the codes the engine names by hand exist", async () => {
    // engine.ts and exceptions.ts reference DAILY_OPENING directly; the
    // activity POST resolves a code such as TEACHING.
    for (const code of ["DAILY_OPENING", "DAILY_CLOSING", "TEACHING"]) {
      expect(await empty.activityType.findUnique({ where: { code } })).not.toBeNull();
    }
  });

  test("behavioural flags survive provisioning", async () => {
    const opening = await empty.activityType.findUniqueOrThrow({
      where: { code: "DAILY_OPENING" },
    });
    expect(opening.isOncePerDay).toBe(true);
    expect(opening.isDerivedFromWorkingHours).toBe(true);

    const unutilized = await empty.activityType.findUniqueOrThrow({ where: { code: "UNUTILIZED" } });
    expect(unutilized.countsAsProductive).toBe(false);
    expect(unutilized.isUnutilized).toBe(true);

    const teaching = await empty.activityType.findUniqueOrThrow({ where: { code: "TEACHING" } });
    expect(teaching.countsAsProductive).toBe(true);
    expect(teaching.isOncePerDay).toBe(false);
  });
});

describe("running it again is safe", () => {
  test("a second run creates nothing and duplicates nothing", async () => {
    const before = await empty.activityType.count();
    const result = await provisionActivityTypes(empty);

    expect(result.created).toHaveLength(0);
    expect(result.updated).toHaveLength(ACTIVITY_TYPE_COUNT);
    expect(await empty.activityType.count()).toBe(before);
  });

  test("a third and fourth run still leave exactly the canonical count", async () => {
    await provisionActivityTypes(empty);
    await provisionActivityTypes(empty);
    expect(await empty.activityType.count()).toBe(ACTIVITY_TYPE_COUNT);

    // No duplicate codes, which the unique index would prevent anyway — this
    // asserts the count rather than trusting the constraint.
    const rows = await empty.activityType.findMany({ select: { code: true } });
    expect(new Set(rows.map((r) => r.code)).size).toBe(rows.length);
  });

  test("existing ids are preserved across runs", async () => {
    const before = await empty.activityType.findMany({
      select: { id: true, code: true },
      orderBy: { code: "asc" },
    });

    await provisionActivityTypes(empty);

    const after = await empty.activityType.findMany({
      select: { id: true, code: true },
      orderBy: { code: "asc" },
    });
    // Ids are what historical ActivityLog rows point at; changing one would
    // orphan history.
    expect(after).toEqual(before);
  });

  test("a drifted row is reconciled without changing its id", async () => {
    const original = await empty.activityType.findUniqueOrThrow({ where: { code: "TEACHING" } });
    await empty.activityType.update({
      where: { code: "TEACHING" },
      data: { label: "Wrong Label", sortOrder: 9999 },
    });

    await provisionActivityTypes(empty);

    const fixed = await empty.activityType.findUniqueOrThrow({ where: { code: "TEACHING" } });
    expect(fixed.id).toBe(original.id);
    expect(fixed.label).toBe("Teaching");
    expect(fixed.sortOrder).toBe(20);
  });
});

describe("it never destroys anything", () => {
  test("a type outside the canonical set is left completely alone", async () => {
    const custom = await empty.activityType.create({
      data: { code: "CUSTOM_LOCAL_TYPE", label: "Custom", sortOrder: 500 },
    });

    await provisionActivityTypes(empty);

    const still = await empty.activityType.findUnique({ where: { code: "CUSTOM_LOCAL_TYPE" } });
    expect(still).not.toBeNull();
    expect(still!.id).toBe(custom.id);
    expect(still!.label).toBe("Custom");
    expect(await empty.activityType.count()).toBe(ACTIVITY_TYPE_COUNT + 1);

    await empty.activityType.delete({ where: { code: "CUSTOM_LOCAL_TYPE" } });
  });

  test("unrelated rows are untouched", async () => {
    const university = await empty.university.create({
      data: { name: "Refdata University", slug: "refdata-u", code: "REF001", timezone: "UTC" },
    });

    await provisionActivityTypes(empty);

    const still = await empty.university.findUnique({ where: { id: university.id } });
    expect(still).not.toBeNull();
    expect(still!.name).toBe("Refdata University");
  });

  test("the implementation contains no destructive call", () => {
    // Source-level proof: no amount of runtime testing rules out a delete on a
    // branch the tests did not reach.
    const source = readFileSync(new URL("../prisma/reference-data.ts", import.meta.url), "utf8");
    const body = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    for (const forbidden of ["deleteMany", "delete(", "TRUNCATE", "$executeRaw", "DROP "]) {
      expect(body).not.toContain(forbidden);
    }
  });

  test("the operator script contains no destructive call either", () => {
    const source = readFileSync(new URL("../scripts/reference-data.ts", import.meta.url), "utf8");
    const body = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    for (const forbidden of ["deleteMany", "delete(", "TRUNCATE", "$executeRaw", "migrate reset"]) {
      expect(body).not.toContain(forbidden);
    }
  });
});

describe("one source of truth", () => {
  test("the development seed consumes the shared definitions", () => {
    const seed = readFileSync(new URL("../prisma/seed.ts", import.meta.url), "utf8");
    expect(seed).toContain("provisionActivityTypes");
    expect(seed).toContain("./reference-data");
    // The taxonomy must not be re-declared in the seed.
    expect(seed).not.toContain('code: "TEACHING"');
    expect(seed).not.toContain('code: "DAILY_OPENING"');
  });

  test("the canonical set is the eleven entry categories plus five system types", () => {
    // A bare count is a weak guard — two changes that cancel out slip past it.
    // Naming the set is what actually stops the taxonomy drifting, and it makes
    // the two halves visible, which is the thing that matters here.
    expect(ACTIVITY_TYPE_COUNT).toBe(16);
    expect(ACTIVITY_TYPES).toHaveLength(16);

    // The eleven an instructor's free text may be classified into (BRD §12).
    expect([...ENTRY_CATEGORY_CODES].sort()).toEqual(
      [
        "ADMINISTRATIVE",
        "ASSESSMENT",
        "CONTENT_DEVELOPMENT",
        "MEETING",
        "MENTORING",
        "OTHER",
        "PRACTICAL_LAB",
        "RESEARCH",
        "STUDENT_SUPPORT",
        "TEACHING",
        "TRAINING_WORKSHOP",
      ].sort(),
    );

    // The five that are NOT entry categories and must survive the BRD's list:
    // opening and closing are derived from the university's working hours and
    // carry opening/closing compliance, UNUTILIZED is computed idle time, and
    // LEARNING and DELIVERABLE carry the deliverable-hours split every
    // analytics surface reads. Dropping any of them would break a figure the
    // free-text change never claimed to touch.
    const system = ACTIVITY_TYPE_CODES.filter(
      (c) => !(ENTRY_CATEGORY_CODES as readonly string[]).includes(c),
    ).sort();
    expect(system).toEqual(
      ["DAILY_CLOSING", "DAILY_OPENING", "DELIVERABLE", "LEARNING", "UNUTILIZED"].sort(),
    );
  });

  test("every deliverable belongs to an entry category, and none is orphaned", () => {
    // The parser is only ever offered deliverables under the eleven, so one
    // filed under a system type would be unreachable — and one pointing at a
    // category that does not exist would fail at the foreign key, at import
    // time, on a customer's database.
    for (const deliverable of DELIVERABLE_TYPES) {
      expect(
        (ENTRY_CATEGORY_CODES as readonly string[]).includes(deliverable.activityTypeCode),
        `${deliverable.code} -> ${deliverable.activityTypeCode}`,
      ).toBe(true);
    }
    expect(DELIVERABLE_TYPE_COUNT).toBe(DELIVERABLE_TYPES.length);
    // Codes are what the parser emits and the unique index enforces.
    expect(new Set(DELIVERABLE_TYPE_CODES).size).toBe(DELIVERABLE_TYPE_COUNT);
    // Every one of the eleven can be reached with at least one deliverable,
    // or a category would be classifiable but unrecordable.
    for (const category of ENTRY_CATEGORY_CODES) {
      expect(
        DELIVERABLE_TYPES.some((d) => d.activityTypeCode === category),
        `${category} has no deliverable`,
      ).toBe(true);
    }
  });
});

describe("the seeded database the rest of the suite runs against", () => {
  test("has the same canonical taxonomy, provisioned by the seed", async () => {
    const seeded = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
    });
    try {
      const rows = await seeded.activityType.findMany({ select: { code: true } });
      expect(rows).toHaveLength(ACTIVITY_TYPE_COUNT);
      expect(rows.map((r) => r.code).sort()).toEqual([...ACTIVITY_TYPE_CODES].sort());
    } finally {
      await seeded.$disconnect();
    }
  });
});
