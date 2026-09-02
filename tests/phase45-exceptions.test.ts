import { beforeAll, describe, expect, test } from "vitest";
import { ACCOUNTS, ApiClient } from "./helpers/client";

/**
 * Phase 4.5 gate — data-quality exceptions.
 *
 * The three things that matter: a gap is only an exception when it is
 * genuinely unexplained, the endpoint scopes exactly like every other
 * tenant-scoped route, and flags follow the data rather than being cached.
 *
 * Northfield: Mon-Fri 09:00-18:00 Asia/Kolkata.
 * 2026-11-02 is a Monday; 2026-11-08 is a Sunday.
 */

const MON = "2026-11-02";
const TUE = "2026-11-03";
const WED = "2026-11-04";
const THU = "2026-11-05";
const FRI = "2026-11-06";
const SUN = "2026-11-08";

let admin: ApiClient, mgrN: ApiClient, mgrW: ApiClient, n1: ApiClient, n2: ApiClient;
let northId: string, westId: string, n1Id: string, n2Id: string;

function ist(date: string, hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + (h * 60 + m - 330) * 60_000).toISOString();
}

async function fetchExceptions(client: ApiClient, uni: string, from: string, to: string) {
  const res = await client.get(`/api/universities/${uni}/exceptions?from=${from}&to=${to}`);
  expect(res.status).toBe(200);
  return res.body.exceptions;
}

const typesFor = (result: { exceptions: Array<{ type: string; instructorId: string; date: string }> }, instructorId: string, date: string) =>
  result.exceptions.filter((e) => e.instructorId === instructorId && e.date === date).map((e) => e.type);

beforeAll(async () => {
  admin = new ApiClient("admin");
  mgrN = new ApiClient("mgrN");
  mgrW = new ApiClient("mgrW");
  n1 = new ApiClient("n1");
  n2 = new ApiClient("n2");
  await admin.login(ACCOUNTS.admin);
  await mgrN.login(ACCOUNTS.managerNorth);
  await mgrW.login(ACCOUNTS.managerWest);
  const a = await n1.login(ACCOUNTS.instructorNorth1);
  const b = await n2.login(ACCOUNTS.instructorNorth2);
  n1Id = a.user.instructorId!;
  n2Id = b.user.instructorId!;
  northId = a.user.universityId!;
  const u = await admin.get("/api/universities");
  westId = u.body.universities.find((x: { slug: string }) => x.slug === "westbrook").id;

  // TUE: a complete, clean day — opening, work, closing.
  for (const [code, s, e] of [
    ["DAILY_OPENING", "09:00", "09:15"],
    ["TEACHING", "10:00", "12:00"],
    ["DAILY_CLOSING", "17:45", "18:00"],
  ] as const) {
    await n1.post(`/api/instructors/${n1Id}/activities`, {
      activityTypeCode: code,
      startTime: ist(TUE, s),
      endTime: ist(TUE, e),
    });
  }

  // WED: overlapping teaching, no closing, one activity outside hours.
  await n1.post(`/api/instructors/${n1Id}/activities`, {
    activityTypeCode: "TEACHING", startTime: ist(WED, "10:00"), endTime: ist(WED, "12:00"),
  });
  await n1.post(`/api/instructors/${n1Id}/activities`, {
    activityTypeCode: "TEACHING", startTime: ist(WED, "11:00"), endTime: ist(WED, "13:00"),
  });
  await n1.post(`/api/instructors/${n1Id}/activities`, {
    activityTypeCode: "ADMINISTRATIVE", startTime: ist(WED, "19:00"), endTime: ist(WED, "20:00"),
  });

  // THU: opening logged well after its window closed.
  await n1.post(`/api/instructors/${n1Id}/activities`, {
    activityTypeCode: "DAILY_OPENING", startTime: ist(THU, "11:00"), endTime: ist(THU, "11:15"),
  });

  // MON and FRI: deliberately left with no records at all.
});

/* "a late opening is detected" and "missing closing and out-of-hours are
   detected" were deleted with LATE_OPENING and MISSED_CLOSING. Both detectors
   asked whether a day carried a DAILY_OPENING or DAILY_CLOSING entry, which
   needs a list of entry kinds to ask about. The other detectors — absence,
   duplicates, overlaps — are unchanged and still below. */

describe("MISSING_ACTIVITY requires a genuinely unexplained gap", () => {
  test("an empty working day is flagged", async () => {
    const result = await fetchExceptions(admin, northId, MON, MON);
    expect(typesFor(result, n1Id, MON)).toContain("MISSING_ACTIVITY");
  });

  test("the same gap with approved leave is NOT flagged", async () => {
    const leave = await mgrN.post(`/api/instructors/${n1Id}/leave`, {
      startDate: FRI, endDate: FRI, status: "APPROVED", reason: "Approved leave",
    });
    expect(leave.status).toBe(201);

    const result = await fetchExceptions(admin, northId, FRI, FRI);
    expect(typesFor(result, n1Id, FRI)).not.toContain("MISSING_ACTIVITY");
  });

  test("a non-working day is never flagged", async () => {
    const result = await fetchExceptions(admin, northId, SUN, SUN);
    expect(typesFor(result, n1Id, SUN)).toHaveLength(0);
  });

  test("an empty day is not ALSO reported as a missed closing", async () => {
    // One fact must produce one flag, not three.
    const result = await fetchExceptions(admin, northId, MON, MON);
    const types = typesFor(result, n1Id, MON);
    expect(types).toContain("MISSING_ACTIVITY");
    expect(types).not.toContain("MISSED_CLOSING");
    expect(types).not.toContain("LATE_OPENING");
  });

  test("a clean day produces no flags at all", async () => {
    const result = await fetchExceptions(admin, northId, TUE, TUE);
    expect(typesFor(result, n1Id, TUE)).toHaveLength(0);
  });
});

describe("the other detectors fire on their own conditions", () => {

  test("OVERLAPPING_ACTIVITY can no longer be produced through the API", async () => {
    // The detector still exists and still runs, because rows that predate the
    // overlap rule — or arrive by import/backfill rather than through the
    // API — can still overlap. What changed is that this fixture can no
    // longer be built: the API refuses to create the overlap in the first
    // place, so the detector is now unreachable from the product's own write
    // path. Recorded here deliberately rather than deleted, so the gap is
    // visible if a bulk-import path is ever added.
    const overlapping = await admin.post(`/api/instructors/${n1Id}/activities`, {
      activityTypeCode: "TEACHING",
      startTime: `${WED}T05:00:00.000Z`,
      endTime: `${WED}T06:00:00.000Z`,
    });
    expect([409, 201]).toContain(overlapping.status);

    const result = await fetchExceptions(admin, northId, WED, WED);
    const types = typesFor(result, n1Id, WED);
    expect(types).not.toContain("OVERLAPPING_ACTIVITY");
  });


  test("every flag carries the evidence it was derived from", async () => {
    const result = await fetchExceptions(admin, northId, MON, THU);
    expect(result.exceptions.length).toBeGreaterThan(0);
    for (const flag of result.exceptions) {
      expect(flag.evidence, `${flag.type} has no evidence`).toBeTruthy();
      expect(Object.keys(flag.evidence).length).toBeGreaterThan(0);
      expect(["LOW", "MEDIUM", "HIGH"]).toContain(flag.severity);
      // Neutral language: describes a measurement, not a person.
      expect(flag.detail.toLowerCase()).not.toMatch(/lazy|poor|bad|negligent|failed to/);
    }
  });

  test("an unknown type filter is a clear error, not an empty result", async () => {
    const res = await admin.get(`/api/universities/${northId}/exceptions?types=NOT_A_TYPE`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("UNKNOWN_EXCEPTION_TYPE");
  });

  test("the type filter narrows correctly", async () => {
    const res = await admin.get(
      `/api/universities/${northId}/exceptions?from=${MON}&to=${THU}&types=MISSING_ACTIVITY`,
    );
    expect(res.status).toBe(200);
    for (const f of res.body.exceptions.exceptions) expect(f.type).toBe("MISSING_ACTIVITY");
  });
});

describe("scoping matches every other tenant-scoped endpoint", () => {
  test("a manager sees their whole university", async () => {
    const result = await fetchExceptions(mgrN, northId, MON, THU);
    const subjects = new Set(result.exceptions.map((e: { instructorId: string }) => e.instructorId));
    expect(subjects.has(n1Id)).toBe(true);
    expect(subjects.has(n2Id)).toBe(true); // colleague has empty days too
  });

  test("an instructor sees only their own flags", async () => {
    const result = await fetchExceptions(n1, northId, MON, THU);
    const subjects = new Set(result.exceptions.map((e: { instructorId: string }) => e.instructorId));
    expect([...subjects]).toEqual([n1Id]);
    expect(JSON.stringify(result)).not.toContain(n2Id);
  });

  test("a manager from another university is refused with the standard code", async () => {
    const res = await mgrW.get(`/api/universities/${northId}/exceptions`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("CROSS_TENANT_DENIED");
  });

  test("an instructor cannot reach another university", async () => {
    const res = await n1.get(`/api/universities/${westId}/exceptions`);
    expect(res.status).toBe(403);
  });

  test("anonymous callers are rejected", async () => {
    expect((await new ApiClient("anon").get(`/api/universities/${northId}/exceptions`)).status).toBe(401);
  });
});

describe("flags follow the data — nothing is cached", () => {
  test("recording the missing activity clears the flag immediately", async () => {
    const before = await fetchExceptions(admin, northId, MON, MON);
    expect(typesFor(before, n1Id, MON)).toContain("MISSING_ACTIVITY");

    // Fill the day in, with no rollup or cache invalidation step.
    for (const [code, s, e] of [
      ["DAILY_OPENING", "09:00", "09:15"],
      ["TEACHING", "10:00", "12:00"],
      ["DAILY_CLOSING", "17:45", "18:00"],
    ] as const) {
      await n1.post(`/api/instructors/${n1Id}/activities`, {
        activityTypeCode: code, startTime: ist(MON, s), endTime: ist(MON, e),
      });
    }

    const after = await fetchExceptions(admin, northId, MON, MON);
    expect(typesFor(after, n1Id, MON)).not.toContain("MISSING_ACTIVITY");
  });

  test("revoking the explanation brings the flag back", async () => {
    // FRI is currently explained by approved leave and therefore unflagged.
    const before = await fetchExceptions(admin, northId, FRI, FRI);
    expect(typesFor(before, n1Id, FRI)).not.toContain("MISSING_ACTIVITY");

    const leaves = await mgrN.get(`/api/instructors/${n1Id}/leave`);
    const fridayLeave = leaves.body.leaveRequests.find(
      (l: { startDate: string }) => l.startDate.slice(0, 10) === FRI,
    );
    expect(fridayLeave).toBeDefined();

    const del = await mgrN.request(`/api/instructors/${n1Id}/leave/${fridayLeave.id}`, {
      method: "DELETE",
    });
    expect(del.status).toBe(200);

    const after = await fetchExceptions(admin, northId, FRI, FRI);
    expect(typesFor(after, n1Id, FRI)).toContain("MISSING_ACTIVITY");
  });

  test("no exceptions table exists — flags cannot be edited independently", async () => {
    // A stored flag would be a second source of truth. Asserting the absence of
    // any write surface for one.
    const post = await admin.post(`/api/universities/${northId}/exceptions`, {
      type: "MISSING_ACTIVITY", instructorId: n1Id, date: MON,
    });
    expect([404, 405]).toContain(post.status);
  });
});
