import { beforeAll, describe, expect, test } from "vitest";
import { ACCOUNTS, ApiClient } from "./helpers/client";

/**
 * A figure with no writer behind it says so.
 *
 * ── What went wrong, and why it is marked rather than fixed ───────────────
 * `InstructorDailyMetric` and `UniversityDailyMetric` are a cache over
 * `ActivityLog`, refreshed by `recomputeDay`. The instructor's worklog writes
 * `WorklogEntry` now, which `recomputeDay` does not read — and the route that
 * used to refresh a day on every write went with the model it belonged to.
 *
 * So the figures describe work as it stood before the write path moved, and
 * nothing in the data said so. Repairing `recomputeDay` against `WorklogEntry`
 * is not the answer: it summarises a table that is being retired, and the
 * replacement is the analytics work. What is wrong TODAY is that a stale number
 * is on screen looking exactly like a real one.
 *
 * ── Why zero is the specific thing being guarded against ──────────────────
 * Three of these figures used to fall back to `?? 0`. Zero is not "unknown" —
 * it is a measurement, and "0 hours recorded" is a sentence somebody acts on.
 * An admin seeing it for a university that filed a full week will go looking
 * for the missing work rather than for the missing rollup.
 */

let admin: ApiClient;

beforeAll(async () => {
  admin = new ApiClient("admin");
  await admin.login(ACCOUNTS.admin);
});

/** Every route whose numbers come out of a stored metric table. */
const STORED_METRIC_ROUTES = [
  { name: "the admin overview", url: "/api/admin/overview" },
  { name: "average hours by university", url: "/api/admin/average-hours?view=week" },
];

describe("1. every stored-metric response says its figures cannot be believed", () => {
  for (const route of STORED_METRIC_ROUTES) {
    test(route.name, async () => {
      const res = await admin.get(route.url);
      expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);

      const flag = res.body.storedMetrics ?? res.body.overview?.storedMetrics;
      expect(flag, `${route.name} must carry the flag`).toBeTruthy();
      expect(flag.available, "the flag only ever says NO").toBe(false);

      /* A note a person can read, not a code. It is rendered verbatim, so an
         empty one would leave a blank space where the explanation goes. */
      expect(typeof flag.note).toBe("string");
      expect(flag.note.length).toBeGreaterThan(20);
    });
  }

  test("an instructor's own metrics carry it too", async () => {
    const probe = new ApiClient("probe");
    const me = await probe.login(ACCOUNTS.instructorNorth1);
    const res = await probe.get(`/api/instructors/${me.user.instructorId}/metrics`);
    expect(res.status).toBe(200);
    expect(res.body.storedMetrics?.available).toBe(false);
  });
});

describe("1. the flag is not a decoration — the figures are still there to be hidden", () => {
  test("the payload keeps its shape so no consumer breaks on the way past", async () => {
    /* The numbers are not stripped from the response. Deleting them would break
       every consumer at once, including ones that do not render them; the flag
       is what tells a consumer not to PRINT them, and the compiler is what
       stops a render site being missed — `recordedHours` is nullable on the
       page for exactly that reason. */
    const res = await admin.get("/api/admin/overview");
    expect(res.body.overview).toHaveProperty("productiveHours");
    expect(res.body.overview).toHaveProperty("capacityHours");
  });

  test("and nothing in the flag itself is a number that could be printed", async () => {
    const res = await admin.get("/api/admin/overview");
    const flag = res.body.overview.storedMetrics;
    for (const value of Object.values(flag)) {
      expect(typeof value === "number", "a figure must not hide inside the flag").toBe(false);
    }
  });
});
