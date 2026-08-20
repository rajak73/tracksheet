import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { config as loadEnv } from "dotenv";

const testEnv = loadEnv({ path: ".env.test", quiet: true }).parsed ?? {};
const DATABASE_URL = testEnv.DATABASE_URL;

const PORT = Number(process.env.TEST_PORT ?? 3100);
export const BASE_URL = `http://127.0.0.1:${PORT}`;

let server: ChildProcess | undefined;

async function waitForServer(url: string, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/api/auth/me`);
      // 401 is the correct unauthenticated answer, so it proves routes are live.
      if (res.status === 401 || res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Test server did not become ready at ${url}`);
}

export async function setup() {
  if (!DATABASE_URL) throw new Error("DATABASE_URL missing from .env.test");

  // `migrate deploy` + seed, deliberately NOT `migrate reset`. The seed already
  // truncates every table it owns, so the harness gets a clean database without
  // any destructive CLI command in the loop.
  const childEnv = { ...process.env, TEST_ENV: "1" };

  console.log("[test] applying migrations to the test database…");
  execFileSync("npx", ["prisma", "migrate", "deploy"], { env: childEnv, stdio: "inherit" });

  console.log("[test] seeding the test database…");
  execFileSync("npx", ["prisma", "db", "seed"], { env: childEnv, stdio: "inherit" });

  console.log(`[test] starting Next.js on ${BASE_URL}…`);
  server = spawn("npx", ["next", "dev", "--port", String(PORT), "--hostname", "127.0.0.1"], {
    // Explicit DATABASE_URL takes precedence over the .env file Next would load,
    // so the server under test can only ever talk to the throwaway database.
    // The periodic rollup is disabled under test: a timer firing mid-suite
    // would race the explicit rollups the tests trigger, and a wall-clock
    // timer is not something a test should wait on. The function the timer
    // calls (runRollup) is exercised directly through the MANUAL and SEED
    // paths; the timer wiring itself is verified separately against a live
    // server, see README.
    env: {
      ...process.env,
      DATABASE_URL,
      DISABLE_ROLLUP_SCHEDULER: "1",
      // No provider, deliberately. With a real GEMINI_API_KEY in .env the server
      // makes real calls to Google during the suite, and those are neither fast
      // nor reliable: a 503 under load took 35 seconds and a cold call 41, which
      // blocked the server long enough to time out every test in whichever file
      // happened to be running. A test suite must not depend on a third party
      // being up. The AI paths are exercised against a FAKE provider that speaks
      // the real protocol (tests/phase10-gemini, ai-narration-integration,
      // ai-assistant, bulk-import-pdf), and the real provider is verified
      // separately — see `npm run ai:sample`.
      GEMINI_API_KEY: "",
      // Every test logs in from 127.0.0.1, so the shared per-IP ceiling has to
      // be raised or the suite throttles itself. The per-account limit stays
      // low enough that one test can trip it with a throwaway address, so the
      // limiter is genuinely exercised rather than switched off.
      RATE_LIMIT_LOGIN_IP: "100000",
      RATE_LIMIT_LOGIN_EMAIL: "50",
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  /* ── Both pipes MUST be drained, or the server freezes ──────────────────
   * `stdio` above makes stdout and stderr pipes. A pipe has a small kernel
   * buffer — tens of kilobytes — and when it fills, the next `write()` by the
   * child BLOCKS until somebody reads. Nothing here read stdout, so Next's
   * ordinary request logging filled it after roughly six hundred tests' worth
   * of lines and the server stopped dead.
   *
   * It stopped in a way that hid the cause completely. The process was alive,
   * the port still accepted TCP connections, Postgres sat idle with no locks,
   * and CPU was flat zero — every symptom of a server waiting politely for
   * work. A stack sample said otherwise: the main thread was inside
   * `uv__try_write → write()`, reached from an HTTP read callback. The event
   * loop was not idle, it was parked mid-log-line, so no request was ever
   * accepted again and every later test failed on its own 30s timeout.
   *
   * Attaching a listener puts the stream in flowing mode, which is the whole
   * fix: the bytes have somewhere to go. stderr is forwarded because a crash
   * or a stack trace is the reason anyone reads this output. stdout is
   * discarded by default — it is compile and request noise that would bury the
   * reporter — but set TEST_SERVER_LOG=1 to see it when a test fails for
   * reasons the assertion cannot explain.
   *
   * The `?.` are load-bearing in the other direction: if `stdio` is ever
   * changed back to "inherit" these are undefined, and the child then writes
   * to the real terminal, which drains itself. */
  server.stderr?.on("data", (d) => process.stderr.write(`[next] ${d}`));
  server.stdout?.on("data", (d) => {
    if (process.env.TEST_SERVER_LOG) process.stdout.write(`[next] ${d}`);
  });

  await waitForServer(BASE_URL);
  console.log("[test] server ready");
}

export async function teardown() {
  if (server?.pid) {
    try {
      process.kill(-server.pid, "SIGKILL");
    } catch {
      server.kill("SIGKILL");
    }
  }
}
