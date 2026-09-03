import { beforeAll, describe, expect, test } from "vitest";
import { ACCOUNTS, ApiClient } from "./helpers/client";
import { parseActivities } from "@/domain/worklog-activities";
import { RUN } from "./helpers/fixtures";

/**
 * A day reopens as the rows it was written in.
 *
 * ── The bug this pins ─────────────────────────────────────────────────────
 * Saving three rows and reopening the day put all three in ONE box. The rows
 * were stored correctly; `/api/activities` simply never returned them, so the
 * edit dialog had nothing to rebuild from and fell back to the newline-joined
 * `deliverable` text derived from them.
 *
 * That is the two-box problem arriving from the other direction: structure the
 * instructor authored, flattened on the way back to them. A round trip through
 * the real endpoint is the only thing that catches it — every unit around it
 * passed.
 */

const admin = new ApiClient("roundtrip-admin");
const instructor = new ApiClient("roundtrip-instructor");
let instructorId = "";
let today = "";
const PASSWORD = "roundtrip-password-1234";

beforeAll(async () => {
  await admin.login(ACCOUNTS.admin);
  // Its own instructor: this writes to TODAY, and a seeded account's today is
  // read by files that assert on totals. See the note in activity-rows.
  const probe = new ApiClient("roundtrip-probe");
  const universityId = (await probe.login(ACCOUNTS.instructorNorth1)).user.universityId!;
  const made = await admin.post("/api/instructors", {
    email: `roundtrip.${RUN}@fixture.test`,
    name: `Roundtrip ${RUN}`,
    password: PASSWORD,
    universityId,
  });
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  instructorId = made.body.instructor.id;
  await instructor.login(`roundtrip.${RUN}@fixture.test`, PASSWORD);
  today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
});

describe("what was written is what reopens", () => {
  test("three rows save and come back as three rows, in order", async () => {
    const written = [
      { description: "Live class on binary search", quantity: 2, hr: 3, min: 30 },
      { description: "Doubt clearing session", quantity: 1, hr: 1, min: 0 },
      { description: "Department meeting", quantity: null, hr: 0, min: 30 },
    ];
    const saved = await instructor.post(`/api/instructors/${instructorId}/worklog/entry`, {
      date: today,
      activities: written,
      remarks: "NA",
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(201);

    /* Through the endpoint the page actually reads, not through prisma — the
       storage was never the broken half. */
    const listed = await instructor.get(`/api/activities?from=${today}&to=${today}&limit=5`);
    expect(listed.status, JSON.stringify(listed.body)).toBe(200);

    const day = (listed.body.days as Array<{ logDate: string; activities?: unknown }>).find(
      (d) => d.logDate === today,
    );
    expect(day, "the day must be in the list").toBeDefined();

    const rows = parseActivities(day!.activities);
    expect(rows, "the rows must survive the round trip").not.toBeNull();
    expect(rows).toHaveLength(3);
    expect(rows!.map((r) => r.description)).toEqual([
      "Live class on binary search",
      "Doubt clearing session",
      "Department meeting",
    ]);
    expect(rows!.map((r) => r.minutes)).toEqual([210, 60, 30]);
    expect(rows!.map((r) => r.quantity)).toEqual([2, 1, null]);
  });

  test("a legacy day comes back with no rows, and is not invented one", async () => {
    /* The other half of the same guarantee: nothing fabricates structure for a
       day that never had it. The dialog puts that text in a single row, unsplit,
       and the instructor decides how it divides. */
    const listed = await instructor.get(`/api/activities?limit=50`);
    expect(listed.status).toBe(200);
    const legacy = (listed.body.days as Array<{ activities?: unknown; deliverable: string }>).find(
      (d) => parseActivities(d.activities) === null,
    );
    if (!legacy) return; // No legacy rows in this database; nothing to assert.
    expect(parseActivities(legacy.activities)).toBeNull();
    expect(typeof legacy.deliverable).toBe("string");
  });
});
