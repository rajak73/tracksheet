import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { chainVerdict, checkModel, type ModelHealth } from "@/server/ai/health";
import { runGrouping, GROUPING_ATTEMPTS, type GroupMember } from "@/server/insights/group";
import { runExtraction } from "@/server/insights/extract";
import type { DayText } from "@/server/insights/extraction-checks";

/**
 * The chain, its budget, and what a build should refuse to ship.
 *
 * ── What happened ─────────────────────────────────────────────────────────
 * `gemini-flash-latest` led the committed chain and returned 404 for this
 * project's key — "no longer available to new users". A 404 is not retryable,
 * so the chain STOPPED on it: every AI call in the product failed, and what
 * reached the screen was a timeout, which points at the network.
 *
 * The suite could not see it, because the suite runs with no provider on
 * purpose. Only asking the provider finds a retired model, and the only useful
 * time to ask is before shipping.
 */

let server: Server;
let port = 0;
/** How each model path should behave, set per test. */
const behaviour = new Map<string, { status: number; delayMs?: number; body?: unknown }>();
const hits: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const model = (req.url?.match(/models\/([^:]+):/) ?? [])[1] ?? "?";
    hits.push(model);
    const b = behaviour.get(model) ?? { status: 200 };
    const send = () => {
      res.writeHead(b.status, { "content-type": "application/json" });
      res.end(
        JSON.stringify(
          b.body ?? {
            candidates: [{ content: { parts: [{ text: JSON.stringify({ groups: [] }) }] } }],
          },
        ),
      );
    };
    if (b.delayMs) setTimeout(send, b.delayMs);
    else send();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe("7. the health check fails a build on a retired model", () => {
  test("a 404 is GONE and reddens the build", () => {
    const results: ModelHealth[] = [
      {
        model: "gemini-flash-latest",
        ok: false,
        capacity: false,
        status: 404,
        ms: 2600,
        detail: "This model models/gemini-2.5-flash is no longer available to new users.",
      },
    ];
    const verdict = chainVerdict(results);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("no longer available");
  });

  test("a 429 is BUSY and does not", () => {
    /* Measured, not assumed: the primary on this key flipped from answering in
       three seconds to "quota exceeded" inside an hour of ordinary testing.
       Failing a build on that teaches people to ignore the check. */
    const results: ModelHealth[] = [
      { model: "a", ok: false, capacity: true, status: 429, ms: 300, detail: "quota" },
      { model: "b", ok: true, capacity: false, status: 200, ms: 900, detail: "answered" },
    ];
    expect(chainVerdict(results).ok).toBe(true);
  });

  test("but every model being busy is still a failure", () => {
    const results: ModelHealth[] = [
      { model: "a", ok: false, capacity: true, status: 429, ms: 10, detail: "quota" },
      { model: "b", ok: false, capacity: true, status: 503, ms: 10, detail: "busy" },
    ];
    expect(chainVerdict(results).ok).toBe(false);
  });

  test("it reports the provider's own sentence, not just a status", async () => {
    behaviour.clear();
    behaviour.set("dead-model", {
      status: 404,
      body: { error: { message: "This model is no longer available to new users." } },
    });
    const saved = { key: process.env.GEMINI_API_KEY, base: process.env.GEMINI_BASE_URL };
    process.env.GEMINI_API_KEY = "test-key-not-a-real-credential";
    process.env.GEMINI_BASE_URL = `http://127.0.0.1:${port}/v1beta`;
    try {
      const health = await checkModel({ model: "dead-model" });
      expect(health.ok).toBe(false);
      expect(health.capacity).toBe(false);
      expect(health.status).toBe(404);
      expect(health.detail).toContain("no longer available");
    } finally {
      if (saved.key === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = saved.key;
      if (saved.base === undefined) delete process.env.GEMINI_BASE_URL;
      else process.env.GEMINI_BASE_URL = saved.base;
    }
  });
});

describe("8 & 9. how many times each stage tries", () => {
  const MEMBERS: GroupMember[] = [
    { label: "Live class on binary tree", date: "2026-09-01", subtopic: null, topic: null },
    { label: "Live class on hashing", date: "2026-09-02", subtopic: null, topic: null },
  ];
  const good = JSON.stringify({ groups: [{ name: "Live class", members: [0, 1] }] });

  function counting(replies: string[]) {
    let calls = 0;
    return {
      calls: () => calls,
      call: async () => {
        const body = replies[Math.min(calls, replies.length - 1)]!;
        calls += 1;
        return { ok: true as const, text: body };
      },
    };
  }

  test("grouping tries three times", async () => {
    /* Observed: a month's grouping failed validation twice and returned FAILED,
       and the same call succeeded later. Grouping at month scale must place a
       hundred labels in exactly one group each — a task whose failure rate
       rises with size, unlike a single day's handful of lines. */
    const bad = JSON.stringify({ groups: [{ name: "Live class", members: [0] }] });
    const p = counting([bad, bad, good]);
    const r = await runGrouping(MEMBERS, p.call);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(p.calls()).toBe(GROUPING_ATTEMPTS);
    expect(GROUPING_ATTEMPTS).toBe(3);
  });

  test("and gives up after the third", async () => {
    const bad = JSON.stringify({ groups: [{ name: "Live class", members: [0] }] });
    const p = counting([bad, bad, bad, good]);
    const r = await runGrouping(MEMBERS, p.call);
    expect(r.ok).toBe(false);
    expect(p.calls()).toBe(3);
  });

  test("extraction still retries exactly once", async () => {
    /* One day and a handful of lines: a second refusal is usually a real
       problem with the text, and a third attempt buys a third identical no. */
    const day: DayText = {
      deliverable: "checked 25 quiz papers — 45 minutes",
      deliverableQuantity: null,
      workingMinutes: 360,
    };
    const bad = JSON.stringify({ activities: "not an array" });
    let calls = 0;
    const r = await runExtraction(day, async () => {
      calls += 1;
      return { ok: true as const, text: bad };
    });
    expect(r.status).toBe("FAILED");
    expect(calls).toBe(2);
  });

  test("a grouping refusal names the check that refused it", async () => {
    const dropped = JSON.stringify({ groups: [{ name: "Live class", members: [0] }] });
    const p = counting([dropped, dropped, dropped]);
    const r = await runGrouping(MEMBERS, p.call);
    expect(r.ok).toBe(false);
    /* The suspicion is that "every label in exactly one group" fails as the
       list grows. A reason naming the check is what makes that checkable from
       three or four real failures rather than guessed at from one. */
    expect(!r.ok && r.reason).toContain("left out");
  });
});

describe("6. each model gets its own budget", () => {
  test("a dead first model costs one attempt, not the allowance", async () => {
    /* The shared deadline made the second model inherit whatever the first left
       behind, so a model that 404s in 2.6s taxed every call after it. */
    behaviour.clear();
    hits.length = 0;
    behaviour.set("busy-model", { status: 503 });
    behaviour.set("slow-model", { status: 200, delayMs: 900 });

    const saved = {
      key: process.env.GEMINI_API_KEY,
      base: process.env.GEMINI_BASE_URL,
      model: process.env.GEMINI_MODEL,
      timeout: process.env.GEMINI_TIMEOUT_MS,
    };
    process.env.GEMINI_API_KEY = "test-key-not-a-real-credential";
    process.env.GEMINI_BASE_URL = `http://127.0.0.1:${port}/v1beta`;
    try {
      const { checkModel: probe } = await import("@/server/ai/health");
      const busy = await probe({ model: "busy-model" }, 2_000);
      expect(busy.capacity, "503 is capacity, not death").toBe(true);

      const slow = await probe({ model: "slow-model" }, 2_000);
      expect(slow.ok, "900ms is well inside a 2s per-attempt budget").toBe(true);

      const timedOut = await probe({ model: "slow-model" }, 300);
      expect(timedOut.ok).toBe(false);
      expect(timedOut.capacity, "a timeout is not a capacity refusal").toBe(false);
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        const name = { key: "GEMINI_API_KEY", base: "GEMINI_BASE_URL", model: "GEMINI_MODEL", timeout: "GEMINI_TIMEOUT_MS" }[k]!;
        if (v === undefined) delete process.env[name];
        else process.env[name] = v;
      }
    }
  });
});
