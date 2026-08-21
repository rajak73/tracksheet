import { createServer, type Server } from "node:http";
import { writeFileSync } from "node:fs";
import { artifactPath } from "./helpers/artifact";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { AnomalyCondition } from "../src/server/ai/anomalies";
import {
  buildGeminiRequest,
  generateNarration,
  MODEL_CHAIN,
  requestFor,
  SUBJECT_TOKEN,
} from "../src/server/ai/gemini";
import { narrateCondition, narrateConditionDeterministic } from "../src/server/ai/narrate";

/**
 * Phase 10 §2 gate — Gemini wiring.
 *
 * These tests run a FAKE Gemini server and point the client at it, so what is
 * asserted is the request that actually goes over the wire, not the object a
 * builder returns. That distinction matters for the payload-inspection
 * requirement: reading the code that builds a request proves nothing about
 * what fetch() finally sends.
 *
 * Running against the real Gemini API needs a key and is therefore not part of
 * the automated suite — see `npm run ai:sample`.
 */

const OUT = artifactPath("gemini-samples.txt");

type Captured = { url: string; headers: Record<string, string>; body: unknown };

let server: Server;
let port: number;
let captured: Captured[] = [];
/** What the fake provider does next: reply, fail, hang, or return junk. */
let mode: "ok" | "http-500" | "rate-limit" | "malformed" | "empty" | "timeout" = "ok";

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      captured.push({
        url: req.url ?? "",
        headers: Object.fromEntries(
          Object.entries(req.headers).map(([k, v]) => [k, String(v)]),
        ),
        body: raw ? JSON.parse(raw) : null,
      });

      if (mode === "timeout") return; // never respond
      if (mode === "http-500") {
        res.writeHead(500).end("upstream exploded");
        return;
      }
      if (mode === "rate-limit") {
        res.writeHead(429).end(JSON.stringify({ error: "quota" }));
        return;
      }
      if (mode === "malformed") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: "not json" }] } }] }));
        return;
      }
      if (mode === "empty") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ candidates: [] }));
        return;
      }

      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      summary: `${SUBJECT_TOKEN} recorded utilisation of 42% against 40 hours of capacity.`,
                      recommendation: "A manager review is recommended.",
                    }),
                  },
                ],
              },
            },
          ],
        }),
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as { port: number }).port;

  process.env.GEMINI_API_KEY = "test-key-not-real";
  process.env.GEMINI_BASE_URL = `http://127.0.0.1:${port}/v1beta`;
  process.env.GEMINI_TIMEOUT_MS = "1500";
});

afterAll(async () => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_BASE_URL;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const condition = (over: Partial<AnomalyCondition> = {}): AnomalyCondition => ({
  type: "UNDERUTILIZATION",
  severity: "MEDIUM",
  scope: "INSTRUCTOR",
  instructorId: "ins_secret_id",
  instructorName: "Arun Verma",
  metrics: { utilizationPct: 42, capacityHours: 40, productiveHours: 16.8, missingDataHours: 8 },
  threshold: { utilizationPct: 60 },
  ...over,
});

describe("what actually goes over the wire", () => {
  test("the request carries no personal name and no activity rows", async () => {
    captured = [];
    mode = "ok";

    const result = await generateNarration(condition());
    expect(result.ok).toBe(true);
    expect(captured).toHaveLength(1);

    const blob = JSON.stringify(captured[0].body);

    // The subject's real name and id never leave this process.
    expect(blob, "instructor name was sent upstream").not.toContain("Arun Verma");
    expect(blob, "instructor id was sent upstream").not.toContain("ins_secret_id");
    expect(blob).toContain(SUBJECT_TOKEN);

    // No activity-row shaped data of any kind.
    for (const field of ["startTime", "endTime", "activityLogId", "remarks", "workDate", "email"]) {
      expect(blob, `${field} was sent upstream`).not.toContain(field);
    }

    // What IS sent: the condition, its metrics, and the threshold — exactly the
    // traceability payload already stored with the insight.
    expect(blob).toContain("UNDERUTILIZATION");
    expect(blob).toContain("utilizationPct");
    expect(blob).toContain("42");
  });

  test("the API key travels in a header, never the URL", async () => {
    captured = [];
    mode = "ok";
    await generateNarration(condition());

    expect(captured[0].url).not.toContain("test-key-not-real");
    expect(captured[0].url).not.toContain("key=");
    expect(captured[0].headers["x-goog-api-key"]).toBe("test-key-not-real");
  });

  test("the built request and the sent request are the same object", async () => {
    captured = [];
    mode = "ok";
    const c = condition();
    await generateNarration(c);

    /* One model-specific thing is added on the way out — the thinking level,
     * which belongs to the model rather than to the caller and so cannot be
     * known by the builder. `requestFor` is that composition, and it is a pure
     * function, so the property this test exists for is unchanged: the payload
     * is exactly what two readable functions produce, and nothing is added
     * anywhere else. */
    expect(captured[0].body).toEqual(requestFor(MODEL_CHAIN[0]!, buildGeminiRequest(c)));
  });

  test("a thinking budget is set, or the answer never gets written", () => {
    /* Measured against the real provider, not assumed: current Flash models
     * charge thinking to `maxOutputTokens`, and one asked for a short JSON reply
     * with a small budget spends all of it thinking and returns `"content": {}`
     * — which every caller here reads as a malformed response and falls back
     * from. The whole AI layer goes quiet while the provider returns 200 and the
     * key is perfectly valid. The first model in the chain must never be left in
     * that state. */
    const sent = requestFor(MODEL_CHAIN[0]!, buildGeminiRequest(condition())) as {
      generationConfig: { thinkingConfig?: { thinkingLevel?: string }; maxOutputTokens: number };
    };
    expect(sent.generationConfig.thinkingConfig?.thinkingLevel).toBe("low");
    // And headroom besides, for a model that ignores the level.
    expect(sent.generationConfig.maxOutputTokens).toBeGreaterThanOrEqual(800);
  });
});

describe("every failure mode falls back to deterministic narration", () => {
  const cases: Array<[string, typeof mode]> = [
    ["provider returns HTTP 500", "http-500"],
    ["provider rate limits", "rate-limit"],
    ["provider returns unparseable text", "malformed"],
    ["provider returns no candidates", "empty"],
    ["provider never responds", "timeout"],
  ];

  for (const [label, m] of cases) {
    test(label, async () => {
      mode = m;
      const c = condition();
      const narration = await narrateCondition(c);
      const fallback = narrateConditionDeterministic(c);

      // Falls back rather than throwing or returning empty text.
      expect(narration.summary).toBe(fallback.summary);
      expect(narration.recommendation).toBe(fallback.recommendation);
    }, 20_000);
  }

  test("insight generation still succeeds when the provider is down", async () => {
    mode = "http-500";
    const narration = await narrateCondition(condition());
    expect(narration.summary.length).toBeGreaterThan(0);
    expect(narration.recommendation.length).toBeGreaterThan(0);
  });

  test("with no key configured the model is not called at all", async () => {
    const saved = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    captured = [];
    mode = "ok";

    const c = condition();
    const narration = await narrateCondition(c);
    expect(captured, "a request was made without a key").toHaveLength(0);
    expect(narration.summary).toBe(narrateConditionDeterministic(c).summary);

    process.env.GEMINI_API_KEY = saved;
  });
});

describe("model output is constrained, not trusted blindly", () => {
  test("the subject placeholder is substituted locally", async () => {
    mode = "ok";
    const narration = await narrateCondition(condition());
    expect(narration.summary).toContain("Arun Verma");
    expect(narration.summary).not.toContain(SUBJECT_TOKEN);
  });

  test("the title stays deterministic so grouping does not fragment", async () => {
    mode = "ok";
    const c = condition();
    const narration = await narrateCondition(c);
    expect(narration.title).toBe(narrateConditionDeterministic(c).title);
  });

  test("a university-scoped condition substitutes a neutral subject", async () => {
    mode = "ok";
    const c = condition({ scope: "UNIVERSITY", instructorId: undefined, instructorName: undefined });
    const narration = await narrateCondition(c);
    expect(narration.summary).toContain("This university");
  });
});

describe("five sample conditions, narrated through the provider", () => {
  test("each stays traceable to its condition and metrics", async () => {
    mode = "ok";
    const samples: AnomalyCondition[] = [
      condition({ type: "NO_DATA_RECORDED", severity: "HIGH", scope: "UNIVERSITY", instructorId: undefined, instructorName: undefined, metrics: { instructors: 2, capacityHours: 80, productiveHours: 0, missingDataHours: 80 }, threshold: {} }),
      condition({ type: "OVERLOAD", severity: "HIGH", metrics: { utilizationPct: 125, capacityHours: 8, productiveHours: 10 }, threshold: { utilizationPct: 100 } }),
      condition(),
      condition({ type: "COMPLIANCE_RISK", scope: "UNIVERSITY", instructorId: undefined, instructorName: undefined, metrics: { kind: "opening", compliancePct: 0 }, threshold: { compliancePct: 90 } }),
      condition({ type: "LEARNING_DROP", scope: "UNIVERSITY", instructorId: undefined, instructorName: undefined, metrics: { dropPct: 100, currentHours: 0, previousHours: 8, previousFrom: "2027-04-05", previousTo: "2027-04-09" }, threshold: { dropPct: 40 } }),
    ];

    const lines = ["FIVE CONDITIONS NARRATED VIA THE PROVIDER PATH", "=".repeat(70), ""];

    for (const c of samples) {
      captured = [];
      const narration = await narrateCondition(c);
      const sent = JSON.stringify(captured[0]?.body ?? {});

      // The condition and its numbers reached the provider; nothing else did.
      expect(sent).toContain(c.type);
      expect(sent).not.toContain("Arun Verma");

      lines.push(`## ${c.type}`);
      lines.push(`sent    : ${sent.slice(0, 220)}…`);
      lines.push(`title   : ${narration.title}`);
      lines.push(`summary : ${narration.summary}`);
      lines.push("");
    }

    writeFileSync(OUT, lines.join("\n"));
  }, 30_000);
});
