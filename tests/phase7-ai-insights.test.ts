import { writeFileSync } from "node:fs";
import { beforeAll, describe, expect, test } from "vitest";
import { ACCOUNTS, ApiClient } from "./helpers/client";

/**
 * Phase 7 gate — the AI insight layer.
 *
 * The required test is five distinct metric snapshots, each insight checked for
 * traceability to both the snapshot and a specific anomaly condition. The five
 * scenarios below are engineered to trigger five different conditions, and the
 * generated text is written to a file so it can be read rather than just
 * asserted on.
 */

const OUT = "/private/tmp/claude-501/-Users-rajakumar-tracksheet/c90e5578-5de3-4733-99f7-94dd47c462d7/scratchpad/insights-sample.txt";

let admin: ApiClient, mgrN: ApiClient, n1: ApiClient, n2: ApiClient;
let northId: string, n1Id: string, n2Id: string;

function ist(date: string, hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + (h * 60 + m - 330) * 60_000).toISOString();
}

async function log(client: ApiClient, instructorId: string, date: string, code: string, s: string, e: string) {
  const res = await client.post(`/api/instructors/${instructorId}/activities`, {
    activityTypeCode: code, startTime: ist(date, s), endTime: ist(date, e),
  });
  expect([201, 409]).toContain(res.status);
}

/** Northfield: Mon-Fri 09:00-18:00 IST, 60 min break -> 8h capacity/day. */
const S = {
  // 1. Nothing recorded at all.
  noData: { from: "2027-03-01", to: "2027-03-05" },
  // 2. Overload — 10h recorded against a single 8h day. Measured over one day
  //    deliberately: the same 10h across a five-day week is 25% utilisation,
  //    which is under-, not over-, capacity.
  overload: { from: "2027-03-09", to: "2027-03-09", day: "2027-03-09" },
  // 3. Underutilisation — a little recorded against a full week.
  under: { from: "2027-03-15", to: "2027-03-19", day: "2027-03-16" },
  // 4. Compliance risk — work recorded, openings mostly absent.
  compliance: { from: "2027-03-22", to: "2027-03-26", day: "2027-03-23" },
  // 5. Learning drop — learning present one week, gone the next.
  learningPrev: { from: "2027-04-05", to: "2027-04-09", day: "2027-04-06" },
  learningNow: { from: "2027-04-12", to: "2027-04-16", day: "2027-04-13" },
};

beforeAll(async () => {
  admin = new ApiClient("admin");
  mgrN = new ApiClient("mgrN");
  n1 = new ApiClient("n1");
  n2 = new ApiClient("n2");
  await admin.login(ACCOUNTS.admin);
  await mgrN.login(ACCOUNTS.managerNorth);
  const a = await n1.login(ACCOUNTS.instructorNorth1);
  const b = await n2.login(ACCOUNTS.instructorNorth2);
  n1Id = a.user.instructorId!;
  n2Id = b.user.instructorId!;
  northId = a.user.universityId!;

  // 2. Overload: 10h recorded on an 8h day, for both instructors.
  for (const id of [n1Id, n2Id]) {
    await log(mgrN, id, S.overload.day, "TEACHING", "08:00", "18:00");
  }
  // 3. Underutilisation: 1h on one day of the week.
  for (const id of [n1Id, n2Id]) {
    await log(mgrN, id, S.under.day, "TEACHING", "10:00", "11:00");
  }
  // 4. Compliance: work recorded, no opening or closing on any day.
  for (const id of [n1Id, n2Id]) {
    await log(mgrN, id, S.compliance.day, "TEACHING", "10:00", "16:00");
  }
  // 5. Learning present in the earlier week, absent in the later one.
  for (const id of [n1Id, n2Id]) {
    await log(mgrN, id, S.learningPrev.day, "LEARNING", "10:00", "14:00");
    await log(mgrN, id, S.learningNow.day, "TEACHING", "10:00", "14:00");
  }
});

async function generate(from: string, to: string) {
  const res = await admin.post(`/api/universities/${northId}/insights?from=${from}&to=${to}`, {});
  expect(res.status).toBe(201);
  return res.body.insights as Array<{
    type: string;
    severity: string;
    title: string;
    summary: string;
    recommendation: string;
    supportingData: {
      conditionType: string;
      scope: string;
      instructorId: string | null;
      metrics: Record<string, number | string | null>;
      threshold: Record<string, number>;
    };
  }>;
}

describe("five snapshots produce five different detected conditions", () => {
  test("each scenario triggers the condition it was built to trigger", async () => {
    const scenarios: Array<[string, { from: string; to: string }, string]> = [
      ["no data recorded", S.noData, "NO_DATA_RECORDED"],
      ["overload", S.overload, "OVERLOAD"],
      ["underutilisation", S.under, "UNDERUTILIZATION"],
      ["compliance risk", S.compliance, "COMPLIANCE_RISK"],
      ["learning drop", S.learningNow, "LEARNING_DROP"],
    ];

    const lines: string[] = ["FIVE GENERATED INSIGHT SAMPLES", "=".repeat(70), ""];

    for (const [label, period, expectedType] of scenarios) {
      const insights = await generate(period.from, period.to);
      const types = insights.map((i) => i.type);
      expect(types, `${label} (${period.from}..${period.to})`).toContain(expectedType);

      const match = insights.find((i) => i.type === expectedType)!;
      lines.push(`## ${label.toUpperCase()}  [${period.from} .. ${period.to}]`);
      lines.push(`condition : ${match.supportingData.conditionType} (${match.severity})`);
      lines.push(`title     : ${match.title}`);
      lines.push(`summary   : ${match.summary}`);
      lines.push(`recommend : ${match.recommendation}`);
      lines.push(`metrics   : ${JSON.stringify(match.supportingData.metrics)}`);
      lines.push(`threshold : ${JSON.stringify(match.supportingData.threshold)}`);
      lines.push("");
    }

    writeFileSync(OUT, lines.join("\n"));
  });
});

describe("every insight is traceable to a condition and a number", () => {
  test("each carries its condition type, metrics and threshold", async () => {
    const insights = await generate(S.under.from, S.under.to);
    expect(insights.length).toBeGreaterThan(0);

    for (const i of insights) {
      expect(i.supportingData.conditionType, i.type).toBe(i.type);
      expect(Object.keys(i.supportingData.metrics).length).toBeGreaterThan(0);
      expect(["UNIVERSITY", "INSTRUCTOR"]).toContain(i.supportingData.scope);
    }
  });

  test("every number in the prose appears in the stored snapshot", async () => {
    for (const period of [S.overload, S.under, S.compliance, S.learningNow]) {
      const insights = await generate(period.from, period.to);
      for (const i of insights) {
        const snapshot = new Set(
          JSON.stringify(i.supportingData).match(/\d+(\.\d+)?/g) ?? [],
        );
        const quoted = `${i.summary} ${i.recommendation}`.match(/\d+(\.\d+)?/g) ?? [];
        for (const n of quoted) {
          expect(
            snapshot.has(n),
            `"${i.type}" quotes ${n}, absent from ${JSON.stringify(i.supportingData)}`,
          ).toBe(true);
        }
      }
    }
  });

  test("an instructor-scoped condition names the instructor it measured", async () => {
    const insights = await generate(S.overload.from, S.overload.to);
    const overload = insights.find((i) => i.type === "OVERLOAD")!;
    expect(overload.supportingData.scope).toBe("INSTRUCTOR");
    expect(overload.supportingData.instructorId).toBeTruthy();
    expect(Number(overload.supportingData.metrics.utilizationPct)).toBeGreaterThan(100);
  });

  test("with nothing recorded, no measured condition is asserted", async () => {
    // DELIVERABLE_RISK is deliberately period-independent (it reads current
    // deliverable state, not activity logs — see anomalies.ts), so this
    // cannot reuse Northfield: many OTHER test files assign low-completion
    // deliverables to the shared seeded north1Id/north2Id, and under full-suite
    // parallel execution one of those can exist at the moment this runs,
    // correctly tripping DELIVERABLE_RISK for reasons that have nothing to do
    // with THIS test's own data. A dedicated, freshly created university with
    // zero deliverables removes that race without weakening what is asserted.
    const probeUniversity = await admin.post("/api/universities", {
      name: "Phase7 NoData Probe University",
      code: "P7NODATA",
      slug: "phase7-nodata-probe-university",
      timezone: "UTC",
      workingHours: Array.from({ length: 7 }, (_, dayOfWeek) => ({
        dayOfWeek,
        isWorkingDay: dayOfWeek >= 1 && dayOfWeek <= 5,
        startMinute: dayOfWeek >= 1 && dayOfWeek <= 5 ? 540 : 0,
        endMinute: dayOfWeek >= 1 && dayOfWeek <= 5 ? 1020 : 1,
      })),
    });
    expect(probeUniversity.status).toBe(201);
    const probeUniversityId = probeUniversity.body.university.id as string;

    const probeInstructor = await admin.post("/api/instructors", {
      email: "phase7-nodata-probe@example.edu",
      name: "Phase7 NoData Probe Instructor",
      password: "Password123!",
      universityId: probeUniversityId,
    });
    expect(probeInstructor.status).toBe(201);

    // The distinction that matters: zero records means "we do not know", so a
    // utilisation figure of 0% must not be reported as underutilisation.
    const res = await admin.post(
      `/api/universities/${probeUniversityId}/insights?from=${S.noData.from}&to=${S.noData.to}`,
      {},
    );
    expect(res.status).toBe(201);
    const types = res.body.insights.map((i: { type: string }) => i.type);

    expect(types).toContain("NO_DATA_RECORDED");
    for (const measured of ["UNDERUTILIZATION", "OVERLOAD", "LEARNING_DROP", "DELIVERABLE_RISK", "COMPLIANCE_RISK"]) {
      expect(types, `${measured} asserted with no data behind it`).not.toContain(measured);
    }
  });

  test("no insight is generated for a university with no instructors or capacity", async () => {
    // A weekend-only window has no expected working time, so nothing is
    // measurable and nothing should be asserted.
    const insights = await generate("2027-03-06", "2027-03-07");
    expect(insights).toHaveLength(0);
  });
});

describe("language stays neutral and non-accusatory", () => {
  test("no character judgements anywhere in generated text", async () => {
    const banned = [
      "lazy", "inefficient", "unproductive", "poor performer", "negligent",
      "failing", "incompetent", "slacking", "not working hard",
    ];
    for (const period of [S.noData, S.overload, S.under, S.compliance, S.learningNow]) {
      const insights = await generate(period.from, period.to);
      for (const i of insights) {
        const text = `${i.title} ${i.summary} ${i.recommendation}`.toLowerCase();
        for (const word of banned) {
          expect(text, `"${word}" in ${i.type}`).not.toContain(word);
        }
      }
    }
  });

  test("under-recording is framed as possibly unrecorded, not as idleness", async () => {
    const insights = await generate(S.under.from, S.under.to);
    const under = insights.find((i) => i.type === "UNDERUTILIZATION")!;
    // The distinction this whole codebase defends.
    expect(`${under.summary} ${under.recommendation}`.toLowerCase()).toMatch(
      /not recorded|logging|may indicate/,
    );
  });
});

describe("the model boundary", () => {
  test("narration receives a condition only — never activity rows", async () => {
    // Structural, not behavioural: the stored payload is the whole input the
    // narration layer sees, so if an activity row could reach a model it would
    // have to appear here.
    const insights = await generate(S.overload.from, S.overload.to);
    for (const i of insights) {
      const keys = Object.keys(i.supportingData);
      expect(keys.sort()).toEqual(
        ["conditionType", "instructorId", "metrics", "scope", "threshold"].sort(),
      );
      // No activity log identifiers, timestamps, or remarks anywhere.
      const blob = JSON.stringify(i.supportingData);
      expect(blob).not.toMatch(/startTime|endTime|activityLogId|remarks/);
    }
  });
});
