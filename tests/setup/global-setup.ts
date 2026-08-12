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
    env: { ...process.env, DATABASE_URL, DISABLE_ROLLUP_SCHEDULER: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  server.stderr?.on("data", (d) => process.stderr.write(`[next] ${d}`));

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
