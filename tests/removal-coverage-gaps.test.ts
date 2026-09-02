import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { ACCOUNTS, ApiClient } from "./helpers/client";
import { JUDGEMENT_TERMS, UNSUPPORTED_ASSERTIONS } from "@/server/ai/judgement-guards";

/**
 * What the taxonomy removal took with it by accident.
 *
 * ── Why this file exists ──────────────────────────────────────────────────
 * Twelve test files were deleted across this stage, each because most of what
 * it asserted was about a feature being removed. That is the right call and it
 * is also exactly how real coverage disappears unnoticed: a file goes because
 * nine of its twelve tests were taxonomy-bound, and the other three go with it
 * without anybody deciding they should.
 *
 * A reconciliation over all twelve found three. They are rewritten here, in a
 * file named for why it exists, rather than folded into whichever suite happens
 * to be nearby — so the next removal can find them the same way.
 */

describe("A — the admin overview's arithmetic, from phase78-insights-admin", () => {
  /* That file was about the insight pipeline, which is gone. Four of its tests
     were not: they held the OVERVIEW's shape and its sums. Its scoping is still
     covered by phase5 and phase9; the maths was covered nowhere else.

     This is the gap that matters most, because the summation it guards is the
     one this stage rewrote — teaching and learning hours were replaced with
     per-university figures summed across, and the test that would have caught a
     mistake in that sum had already been deleted. */

  test("platform counts are at least the seeded platform", async () => {
    const admin = new ApiClient("gap-admin");
    await admin.login(ACCOUNTS.admin);

    const res = await admin.get("/api/admin/overview");
    expect(res.status).toBe(200);
    const o = res.body.overview;

    // Floors, not fixed totals: provisioning tests may have added more.
    expect(o.totalUniversities).toBeGreaterThanOrEqual(2);
    expect(o.totalManagers).toBeGreaterThanOrEqual(2);
    expect(o.totalInstructors).toBeGreaterThanOrEqual(4);

    const slugs = res.body.universities.map((u: { slug: string }) => u.slug);
    expect(slugs).toContain("northfield");
    expect(slugs).toContain("westbrook");
  });

  test("per-university totals sum to the platform totals", async () => {
    const admin = new ApiClient("gap-admin-sum");
    await admin.login(ACCOUNTS.admin);
    const res = await admin.get("/api/admin/overview");

    const sum = res.body.universities.reduce(
      (a: number, u: { capacityHours: number }) => a + u.capacityHours,
      0,
    );
    expect(Number(sum.toFixed(2))).toBe(res.body.overview.capacityHours);
  });

  test("and the figures that replaced teaching and learning sum the same way", async () => {
    /* The new ones, held to the rule the old ones were: what the platform
       reports is what its universities report, added up. `daysLogged` is a
       count of instructor-days, so it adds exactly; `totalHours` is rounded per
       university before summing, which is why this compares to two places. */
    const admin = new ApiClient("gap-admin-new");
    await admin.login(ACCOUNTS.admin);
    const res = await admin.get("/api/admin/overview");
    const o = res.body.overview;

    for (const field of ["totalHours", "daysLogged", "instructorsLogging"]) {
      expect(typeof o[field], field).toBe("number");
      expect(o[field], field).toBeGreaterThanOrEqual(0);
    }
    // Days logged can never exceed instructor-days that exist to be logged.
    expect(o.daysLogged).toBeGreaterThanOrEqual(o.instructorsLogging === 0 ? 0 : 1);
  });

  test("each university's period is resolved in its own timezone", async () => {
    /* Directly relevant to this stage: the replacement figures are computed per
       university precisely BECAUSE each resolves its own period from its own
       zone. One window across all of them would report one tenant's Monday
       inside another's Sunday. */
    const admin = new ApiClient("gap-admin-tz");
    await admin.login(ACCOUNTS.admin);
    const res = await admin.get("/api/admin/overview");

    const zones = res.body.universities.map((u: { timezone: string }) => u.timezone);
    expect(new Set(zones).size).toBeGreaterThanOrEqual(2);
  });

  test("only an admin can read it", async () => {
    const manager = new ApiClient("gap-manager");
    await manager.login(ACCOUNTS.managerWest);
    expect((await manager.get("/api/admin/overview")).status).toBe(403);

    const anon = new ApiClient("gap-anon");
    expect((await anon.get("/api/admin/overview")).status).toBe(401);
  });
});

describe("B — the API key never travels in a URL, from phase10-gemini", () => {
  /* That file was mostly about narrating an anomaly condition. This one test
     was not: it is a security property of the TRANSPORT, which survives and is
     what the insight generator, the assistant and the PDF import all call.

     A key in a query string ends up in proxy logs, access logs and error
     reports. Asserted against the source rather than a live call because the
     provider is deliberately unconfigured under test — there is no request to
     inspect, and the property is about how the request is BUILT. */

  const source = readFileSync(new URL("../src/server/ai/gemini.ts", import.meta.url), "utf8");

  test("the key is sent as a header", () => {
    expect(source).toContain('"x-goog-api-key"');
  });

  test("and never interpolated into a URL", () => {
    /* The shapes this could come back as: `?key=`, `&key=`, or a template
       putting the key into the endpoint string. */
    expect(source).not.toMatch(/[?&]key=/);
    expect(source).not.toMatch(/\$\{[^}]*apiKey[^}]*\}/);
    expect(source).not.toMatch(/url\s*\+=?\s*[^;]*apiKey/);
  });

  test("the scan can fail", () => {
    /* Every assertion above is an absence, so the patterns are checked against
       text that should match them. Without this, a typo in a regex reports a
       clean file forever. */
    const planted = 'const url = `${base}/models/x:generate?key=${apiKey}`;';
    expect(planted).toMatch(/[?&]key=/);
    expect(planted).toMatch(/\$\{[^}]*apiKey[^}]*\}/);
  });
});

describe("C — the judgement guards, from ai-narration-validation", () => {
  /* Those constants were kept when the validator around them was deleted: they
     point the opposite way to everything removed this stage — they stop a model
     writing a verdict about a person, rather than producing one.
     
     Keeping them left them untested. This is also test 8: the check that makes
     `THRESHOLDS` safe to have kept. Displaying "Compliance: 87%" is a
     measurement; generated prose saying a named instructor is below the 90%
     threshold is the same class of thing as the severity scorer that was
     deleted, and the guard is what stands between the two. */

  test("the guards name the words a verdict is written in", () => {
    for (const term of ["underperform", "lazy", "unproductive", "negligent"]) {
      expect(JUDGEMENT_TERMS, term).toContain(term);
    }
    expect(JUDGEMENT_TERMS.length).toBeGreaterThan(8);
  });

  test("and the comparisons nobody computed", () => {
    for (const phrase of ["industry average", "compared to last year"]) {
      expect(UNSUPPORTED_ASSERTIONS, phrase).toContain(phrase);
    }
  });

  test("8. a sentence placing a named instructor against a threshold is refused", async () => {
    /* The line worth drawing, made executable. The assistant verifies its own
       reply against these lists before storing it, so the check is: would this
       sentence survive that pass? */
    const { verifyReply } = await import("@/server/ai/assistant");

    const context = {
      audience: "MANAGER",
      period: { from: "2026-08-01", to: "2026-08-31" },
      thresholds: { bands: { healthy: 75, borderline: 60 }, deliverableCompletionPct: 60 },
      managerName: "A Manager",
      roster: [{ id: "i1", name: "Instructor A", utilization: 87 }],
      totals: {
        instructorCount: 1,
        workingHours: 40,
        recordedHours: 35,
        utilization: 87,
        deliverables: {},
      },
    } as unknown as Parameters<typeof verifyReply>[0];

    /* A complete, well-formed recommendation — every field the shape requires,
       so verification reaches the TEXT rather than stopping on a missing one.
       The first attempt at this test left two fields empty, the verifier
       objected to those instead, and it would have passed for the wrong
       reason. */
    const judgement = {
      recommendations: [
        {
          severity: "MEDIUM",
          category: "UTILIZATION",
          entityType: "INSTRUCTOR",
          entityId: "i1",
          title: "Below threshold",
          explanation: "Instructor A is underperforming against the compliance threshold.",
          metric: "utilisation 87%",
          action: "Review with them",
        },
      ],
    } as unknown as Parameters<typeof verifyReply>[1];

    const violations = verifyReply(context, judgement);
    expect(
      violations.length,
      "a verdict about a named person must not pass verification",
    ).toBeGreaterThan(0);
    expect(violations.join(" ")).toMatch(/underperform/i);
  });

  test("while a measurement, stated plainly, is not the same thing", () => {
    /* The guards must not be so broad that the product cannot report a number.
       "Compliance: 87%" carries no judgement word and no invented comparison. */
    const measurement = "compliance: 87%".toLowerCase();
    for (const term of JUDGEMENT_TERMS) expect(measurement.includes(term)).toBe(false);
    for (const phrase of UNSUPPORTED_ASSERTIONS) expect(measurement.includes(phrase)).toBe(false);
  });
});

describe("5. the renamed figure leaves nothing reading the old name", () => {
  /* `utilizationPercent` answered "how much of the time they logged was
     productive?" — productive meaning "not filed under a type flagged
     countsAsProductive: false". With no types every recorded hour counts, so it
     now answers "how many hours did they log against their capacity?".

     Different question, and on the dev set the same person moves 18.75% → 21.25%
     without having worked a minute differently. A number whose meaning changes
     while its name does not is how a metric lies quietly, so the name moved with
     it — schema column, API property and CSV header together. */

  const roots = ["src", "prisma/schema.prisma", "tests"];

  test("the old name appears nowhere", () => {
    let hits = "";
    try {
      hits = execFileSync(
        "grep",
        ["-rn", "-e", "utilizationPct", "-e", "utilizationPercent", ...roots],
        { encoding: "utf8" },
      );
    } catch {
      // grep exits non-zero when it finds nothing, which is the passing case.
    }
    const real = hits
      .split("\n")
      .filter((l) => l && !l.includes("src/generated/"))
      .filter((l) => !l.includes("removal-coverage-gaps"));
    expect(real, `still reading the old name:\n${real.join("\n")}`).toHaveLength(0);
  });

  test("and the scan can fail", () => {
    /* Every assertion above is an absence. Planted here so a broken grep
       invocation cannot report a clean tree forever. */
    const planted = "  utilizationPct: number | null;";
    expect(planted.includes("utilizationPct")).toBe(true);
  });
});
