import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { createServer, type Server } from "node:http";

/**
 * A quota the chain has already discovered, remembered.
 *
 * ── What this is for ──────────────────────────────────────────────────────
 * The pinned primary on this project's key is capped at twenty requests a day
 * on the free tier, and spends them quickly. Every call after that paid ~350ms
 * to rediscover the same 429 before reaching a model that could answer.
 *
 * The fix is NOT to reorder the chain. The primary is the best model in it
 * whenever it can answer, and the cap is temporary by definition — a permanent
 * reorder would be wrong in the other direction the moment billing is enabled.
 * So the order stands and the dead hop is skipped.
 *
 * ── A day quota and a burst are not the same refusal ──────────────────────
 * Both are 429. One is over in seconds and the next call should try again; the
 * other refuses everything until the day rolls over. Telling them apart is the
 * whole point, and the provider says which in the body.
 */

let server: Server;
let port = 0;
const behaviour = new Map<string, { status: number; body?: unknown }>();
const hits: string[] = [];

/** The 429 the provider actually returns when the DAY's allowance is gone. */
const DAILY_QUOTA_BODY = {
  error: {
    code: 429,
    message:
      "You exceeded your current quota. Quota exceeded for metric: " +
      "generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }],
      },
    ],
  },
};

/** The 429 for a per-minute limit, which is over almost immediately. */
const BURST_BODY = {
  error: {
    code: 429,
    message: "Quota exceeded for metric: generate_requests_per_minute",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [{ quotaId: "GenerateRequestsPerMinutePerProject" }],
      },
    ],
  },
};

const OK_BODY = {
  candidates: [{ content: { parts: [{ text: JSON.stringify({ activities: [] }) }] } }],
};

beforeAll(async () => {
  server = createServer((req, res) => {
    const model = (req.url?.match(/models\/([^:]+):/) ?? [])[1] ?? "?";
    hits.push(model);
    const b = behaviour.get(model) ?? { status: 200 };
    res.writeHead(b.status, { "content-type": "application/json" });
    res.end(JSON.stringify(b.body ?? OK_BODY));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

const saved = { ...process.env };
afterEach(() => {
  for (const key of ["GEMINI_API_KEY", "GEMINI_BASE_URL", "GEMINI_MODEL", "GEMINI_THINKING_LEVEL", "GEMINI_DAILY_COOLDOWN_MS", "GEMINI_BURST_COOLDOWN_MS"]) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

/**
 * A fresh copy of the transport with one model pinned.
 *
 * The chain is read at import time, so the environment has to be set before the
 * module is loaded — hence `resetModules` rather than assigning and hoping.
 */
async function loadChain(env: Record<string, string>) {
  process.env.GEMINI_API_KEY = "test-key-not-a-real-credential";
  process.env.GEMINI_BASE_URL = `http://127.0.0.1:${port}/v1beta`;
  process.env.GEMINI_THINKING_LEVEL = "off";
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  vi.resetModules();
  return import("@/server/ai/gemini");
}

describe("a 429 says WHICH limit was hit", () => {
  test("a per-day quota is told apart from a per-minute one", async () => {
    const { capacityKindOf } = await loadChain({ GEMINI_MODEL: "unused" });
    expect(capacityKindOf(JSON.stringify(DAILY_QUOTA_BODY))).toBe("daily");
    expect(capacityKindOf(JSON.stringify(BURST_BODY))).toBe("burst");
  });

  test("an unrecognised refusal is treated as a burst", async () => {
    /* A short skip that corrects itself is the safe way to be wrong. Assuming
       a day-long outage from a message nobody has seen before would take a
       working model out of the chain for an hour. */
    const { capacityKindOf } = await loadChain({ GEMINI_MODEL: "unused" });
    expect(capacityKindOf('{"error":{"message":"slow down"}}')).toBe("burst");
  });
});

describe("7. a model out of quota for the day is skipped on the next call", () => {
  test("the second call never reaches the provider", async () => {
    behaviour.clear();
    hits.length = 0;
    behaviour.set("quota-model", { status: 429, body: DAILY_QUOTA_BODY });

    const gemini = await loadChain({ GEMINI_MODEL: "quota-model" });
    gemini.clearCapacityMemory();

    const first = await gemini.generateStructured("anything");
    expect(first.ok).toBe(false);
    expect(hits.filter((h) => h === "quota-model"), "the first call asks").toHaveLength(1);

    const before = gemini.geminiCallCount();
    const second = await gemini.generateStructured("anything");
    expect(second.ok).toBe(false);
    expect(
      hits.filter((h) => h === "quota-model"),
      "and the second does not ask again",
    ).toHaveLength(1);
    expect(gemini.geminiCallCount(), "no outbound call was counted either").toBe(before);

    expect(gemini.capacityMemory().map((m) => m.model)).toEqual(["quota-model"]);
  });

  test("a burst limit is retried rather than remembered", async () => {
    /* The opposite handling, from the same status code. With the burst window
       set to nothing, the next call goes straight back to the provider. */
    behaviour.clear();
    hits.length = 0;
    behaviour.set("busy-model", { status: 429, body: BURST_BODY });

    const gemini = await loadChain({ GEMINI_MODEL: "busy-model", GEMINI_BURST_COOLDOWN_MS: "0" });
    gemini.clearCapacityMemory();

    await gemini.generateStructured("anything");
    await gemini.generateStructured("anything");
    expect(hits.filter((h) => h === "busy-model"), "both calls asked").toHaveLength(2);
  });

  test("a model that answers again clears what it was refused for", async () => {
    behaviour.clear();
    hits.length = 0;
    behaviour.set("recovering-model", { status: 429, body: DAILY_QUOTA_BODY });

    const gemini = await loadChain({
      GEMINI_MODEL: "recovering-model",
      // The window a real quota would outlive; here it is only long enough to
      // prove the memory is consulted, then stepped over deliberately.
      GEMINI_DAILY_COOLDOWN_MS: "0",
    });
    gemini.clearCapacityMemory();

    await gemini.generateStructured("anything");
    behaviour.set("recovering-model", { status: 200 });
    const back = await gemini.generateStructured("anything");
    expect(back.ok, JSON.stringify(back)).toBe(true);
    expect(gemini.capacityMemory(), "nothing is being skipped any more").toEqual([]);
  });
});
