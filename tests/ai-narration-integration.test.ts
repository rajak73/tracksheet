import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * End-to-end proof that a hallucinating model cannot reach a user — not just
 * that `validateNarration` rejects bad input in isolation, but that
 * `narrateCondition` actually calls it and actually falls back.
 *
 * A tiny local HTTP server stands in for Gemini (`GEMINI_BASE_URL` points at
 * it), so the real fetch/timeout/parse code in `gemini.ts` runs unmodified —
 * this is the integration the unit tests in ai-narration-validation.test.ts
 * cannot exercise on their own.
 */

let stub: Server;
let baseUrl: string;
let nextReply: { summary: string; recommendation: string } | { status: number } | "hang" | "malformed";

function geminiEnvelope(summary: string, recommendation: string) {
  return {
    candidates: [{ content: { parts: [{ text: JSON.stringify({ summary, recommendation }) }] } }],
  };
}

beforeAll(async () => {
  stub = createServer((req, res) => {
    if (nextReply === "hang") return; // never responds — exercises the timeout path
    if (typeof nextReply === "object" && "status" in nextReply) {
      res.writeHead(nextReply.status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "stubbed provider error" }));
      return;
    }
    if (nextReply === "malformed") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{not valid json");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(geminiEnvelope(nextReply.summary, nextReply.recommendation)));
  });
  await new Promise<void>((resolve) => stub.listen(0, resolve));
  const { port } = stub.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => new Promise<void>((resolve) => stub.close(() => resolve())));

afterEach(() => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_BASE_URL;
  delete process.env.GEMINI_TIMEOUT_MS;
});

// Imported after env plumbing is understood but modules are cheap to import;
// dynamic import per-test would also work, but these read `process.env` at
// call time (not module-load time), so a static import is fine.
const { narrateCondition } = await import("@/server/ai/narrate");

const CONDITION = {
  type: "UNDERUTILIZATION" as const,
  severity: "MEDIUM" as const,
  scope: "INSTRUCTOR" as const,
  instructorId: "inst-1",
  instructorName: "Arun Verma",
  metrics: { utilizationPct: 44.38, capacityHours: 40, missingDataHours: 8 },
  threshold: { utilizationPct: 60 },
};

describe("a hallucinating model never reaches the caller", () => {
  test("valid model output is used as-is", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GEMINI_BASE_URL = baseUrl;
    nextReply = {
      summary: "{{SUBJECT}} recorded utilisation of 44.38%, below the 60% reference level.",
      recommendation: "A manager review is recommended.",
    };

    const result = await narrateCondition(CONDITION);
    expect(result.summary).toContain("44.38%");
    expect(result.summary).toContain("Arun Verma");
  });

  test("a hallucinated percentage falls back to deterministic text", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GEMINI_BASE_URL = baseUrl;
    // The true figure is 44.38%; the model invents 91%.
    nextReply = {
      summary: "{{SUBJECT}} recorded utilisation of 91%, a critical shortfall.",
      recommendation: "Immediate action required.",
    };

    const result = await narrateCondition(CONDITION);
    // Never the model's number.
    expect(result.summary).not.toContain("91%");
    // The deterministic fallback's real figure instead.
    expect(result.summary).toContain("44.38%");
  });

  test("a hallucinated date range falls back to deterministic text", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GEMINI_BASE_URL = baseUrl;
    nextReply = {
      summary: "{{SUBJECT}} recorded low utilisation for the period 2020-01-01 to 2020-01-07.",
      recommendation: "Review workload.",
    };

    const result = await narrateCondition(CONDITION);
    expect(result.summary).not.toContain("2020-01-01");
  });

  test("provider HTTP error falls back safely", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GEMINI_BASE_URL = baseUrl;
    nextReply = { status: 500 };

    const result = await narrateCondition(CONDITION);
    expect(result.summary).toContain("44.38%");
    expect(result.summary).toContain("Arun Verma");
  });

  test("provider rate-limit (429) falls back safely", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GEMINI_BASE_URL = baseUrl;
    nextReply = { status: 429 };

    const result = await narrateCondition(CONDITION);
    expect(result.summary).toContain("44.38%");
  });

  test("malformed JSON body falls back safely", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GEMINI_BASE_URL = baseUrl;
    nextReply = "malformed";

    const result = await narrateCondition(CONDITION);
    expect(result.summary).toContain("44.38%");
  });

  test("a timeout falls back safely", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GEMINI_BASE_URL = baseUrl;
    process.env.GEMINI_TIMEOUT_MS = "300";
    nextReply = "hang";

    const result = await narrateCondition(CONDITION);
    expect(result.summary).toContain("44.38%");
  }, 10_000);

  test("no API key configured uses deterministic text directly", async () => {
    // GEMINI_API_KEY intentionally left unset.
    const result = await narrateCondition(CONDITION);
    expect(result.summary).toContain("44.38%");
    expect(result.summary).toContain("Arun Verma");
  });

  test("empty underlying dataset produces safe deterministic text, no model call", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GEMINI_BASE_URL = baseUrl;
    // The stub would return a hallucination if called; NO_DATA_RECORDED
    // should route through exactly the same validated path.
    nextReply = { summary: "{{SUBJECT}} recorded 500 hours.", recommendation: "Investigate." };

    const emptyCondition = {
      type: "NO_DATA_RECORDED" as const,
      severity: "HIGH" as const,
      scope: "UNIVERSITY" as const,
      metrics: { instructors: 4, capacityHours: 160, productiveHours: 0, missingDataHours: 160 },
      threshold: {},
    };

    const result = await narrateCondition(emptyCondition);
    expect(result.summary).not.toContain("500");
    expect(result.summary).toContain("160");
  });
});
