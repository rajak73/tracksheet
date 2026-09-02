import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import { sweepFixtures } from "./setup/fixture-sweep";
import { RUN, FIXTURE_DOMAIN, fixtureEmail, newRunId } from "./helpers/fixtures";

/**
 * The harness has to survive being killed, because it is killed constantly.
 *
 * ── The record, corrected twice ───────────────────────────────────────────
 * Failures in six files — worklog-day-summary, phase65-scheduler,
 * phase3-activity-logging, regression-audit-findings, admin-console and
 * manager-portal — were attributed to test ORDERING. That attribution is
 * withdrawn. It was never demonstrated: no shuffle probe was run, and every
 * one of those failures had a killed run in front of it.
 *
 * The replacement claim — orphan fixture ACCOUNTS surviving a killed run — is
 * also withdrawn, and this one is disproved rather than merely unsupported.
 * `prisma db seed` calls `prisma.user.deleteMany()` with no filter before every
 * run, and deleting instructors cascades their worklog rows away. Measured, not
 * read: a database holding a known orphan was seeded and the orphan was gone.
 * An orphan account cannot reach the next run.
 *
 * What IS established, by counting rows rather than by reasoning about them:
 * the seed clears the tables the SEED owns, and the product has since grown
 * tables it does not. `metricsJobRun` held 338 rows on a freshly seeded
 * database — every run this project has ever done, still there — and a run
 * began with 112 leftover rows across five tables.
 *
 * So the cleanup gap was real and the two explanations for it were not. These
 * tests pin the mechanism, so the next person meets the fix rather than
 * re-deriving it from a misleading failure. The shuffle probe still owes an
 * answer at close-out, but it is now testing a much weaker prior.
 */

const DATABASE_URL = loadEnv({ path: ".env.test", quiet: true }).parsed?.DATABASE_URL;

/** Tables nothing else in the suite reads, so sweeping them cannot disturb a
 *  neighbouring file. The full list is global setup's business. */
const SAFE = ["metricsJobRun"] as const;

describe("fixture isolation", () => {
  test("the pre-run sweep removes leftover rows and reports how many", async () => {
    const { prisma } = await import("@/server/db");

    await prisma.metricsJobRun.createMany({
      data: [1, 2, 3].map(() => ({
        trigger: "MANUAL" as const,
        status: "COMPLETED" as const,
        fromDate: "2026-01-01",
        toDate: "2026-01-02",
      })),
    });
    const before = await prisma.metricsJobRun.count();
    expect(before).toBeGreaterThanOrEqual(3);

    const result = await sweepFixtures(DATABASE_URL!, SAFE);

    const reported = result.find((r) => r.table === "metricsJobRun");
    expect(reported, "the sweep must report what it removed, not remove silently").toBeDefined();
    expect(reported!.deleted).toBe(before);
    expect(await prisma.metricsJobRun.count()).toBe(0);
  });

  test("a sweep of an already-clean table reports nothing rather than zero rows", async () => {
    const result = await sweepFixtures(DATABASE_URL!, SAFE);
    expect(result.find((r) => r.table === "metricsJobRun")).toBeUndefined();
  });

  test("run ids from two runs never collide", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 5000; i++) ids.add(newRunId());
    expect(ids.size).toBe(5000);
  });

  test("a fixture address carries the run id and the reserved fixture domain", () => {
    const email = fixtureEmail("someone");
    expect(email).toBe(`someone.${RUN}@${FIXTURE_DOMAIN}`);
    expect(email.endsWith("@fixture.test")).toBe(true);
    /* .test is reserved by RFC 2606, so a fixture can never be a real address
     * and can never be confused with the seed's @example.edu accounts. */
    expect(email).not.toContain("@example.edu");
  });

  test("no test builds a fixture identity on the seed's domain", () => {
    /* The seed owns @example.edu and the suite logs in as those seven accounts.
     * Anything else at that domain is a fixture that a sweep cannot distinguish
     * from the accounts the whole suite depends on — which is the ambiguity
     * that made cleanup unwritable in the first place. */
    const ALLOWED = new Set([
      "admin@example.edu",
      "manager.north@example.edu",
      "manager.west@example.edu",
      "inst.north1@example.edu",
      "inst.north2@example.edu",
      "inst.west1@example.edu",
      "inst.west2@example.edu",
    ]);
    /* These two files DESCRIBE the rule, so they quote the domain in prose and
     * in an allowlist. Scanning them would flag the rule for stating itself. */
    const SELF_DESCRIBING = new Set(["fixtures.ts", "fixture-isolation.test.ts"]);
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith(".ts") && !SELF_DESCRIBING.has(e.name)) {
          const src = readFileSync(full, "utf8");
          /* A local part is required: a bare "@example.edu" is prose, not an address. */
          for (const m of src.matchAll(/[\w.${}]+@example\.edu/g)) {
            if (!ALLOWED.has(m[0])) offenders.push(`${full}: ${m[0]}`);
          }
        }
      }
    };
    walk("tests");
    expect(offenders, "fixtures belong at @fixture.test").toEqual([]);
  });
});
