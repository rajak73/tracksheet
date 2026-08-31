import { beforeAll, describe, expect, test } from "vitest";
import { ApiClient, ACCOUNTS } from "./helpers/client";

/**
 * Correcting a PAST day replaces it, exactly as correcting today does.
 *
 * ── The bug ───────────────────────────────────────────────────────────────
 * The form sent `replace: true` only when the day being edited was TODAY. That
 * was right while today was the only editable day. When any past day became
 * editable, the flag stayed behind: the pencil on last Tuesday read that day's
 * lines back into the boxes, and saving them ADDED them to the day a second
 * time.
 *
 * So a correction doubled the day. Every deliverable appeared twice, the hours
 * doubled, and nothing on screen said anything had gone wrong — the table
 * simply showed twice the work.
 *
 * It surfaced as an error rather than as silence only by luck: a day already
 * holding eight hours had no room for eight more, so the writer refused it with
 * "that would run past midnight". On a day with room it succeeded, which is the
 * worse outcome.
 *
 * ── What this pins ────────────────────────────────────────────────────────
 * That a rewrite of any day the instructor may write is a REPLACEMENT. The
 * count and the hours after correcting must be the correction's, not the
 * correction's plus what was there before.
 */

const RUN = Math.random().toString(36).slice(2, 8).replace(/[0-9]/g, "z");
const PASSWORD = "edit-past-day-password-1234";

let admin: ApiClient;
let instructor: ApiClient;
let myId = "";

/* Northfield is Asia/Kolkata, and a work day is judged in the UNIVERSITY's
 * zone — so that is the zone these dates are built in, not the machine's. */
const TODAY = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

/** Two days back: comfortably past, and still a day the instructor may write. */
const PAST = (() => {
  const at = new Date(`${TODAY}T00:00:00.000Z`);
  at.setUTCDate(at.getUTCDate() - 2);
  return at.toISOString().slice(0, 10);
})();

beforeAll(async () => {
  admin = new ApiClient("admin");
  await admin.login(ACCOUNTS.admin);

  const probe = new ApiClient("probe");
  const northId = (await probe.login(ACCOUNTS.instructorNorth1)).user.universityId!;

  /* Its own instructor: this writes a day and rewrites it, and doing that to a
   * seeded account would disturb whatever else reads one. */
  const email = `edit.past.${RUN}@example.edu`;
  const created = await admin.post("/api/instructors", {
    email,
    name: `Edit Past ${RUN}`,
    password: PASSWORD,
    universityId: northId,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  myId = created.body.instructor.id;

  instructor = new ApiClient("instructor");
  await instructor.login(email, PASSWORD);
});

/** What the day holds, read the way the table reads it. */
async function dayEntries(date: string) {
  const res = await admin.get(
    `/api/activities?instructorId=${myId}&from=${date}&to=${date}&limit=100`,
  );
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.activities as Array<{ id: string; durationHours: number; rawText: string | null }>;
}

const hoursOn = (rows: Array<{ durationHours: number }>) =>
  Math.round(rows.reduce((n, r) => n + r.durationHours, 0) * 100) / 100;

describe("correcting a past day replaces it", () => {
  test("the day starts with one entry of eight hours", async () => {
    const res = await instructor.post(`/api/instructors/${myId}/worklog/entry`, {
      date: PAST,
      deliverable: "Live Class",
      quantity: "1",
      workingHours: "8h",
      remarks: "the original",
      replace: true,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const rows = await dayEntries(PAST);
    expect(rows.length).toBe(1);
    expect(hoursOn(rows)).toBe(8);
  });

  /* Eight hours on a day that already holds eight. Before the fix this was
   * refused outright — there was no room to APPEND it — which is the error an
   * instructor actually saw. As a replacement it fits, because the day is
   * cleared first. */
  test("rewriting it with the same length is accepted, not refused as a full day", async () => {
    const res = await instructor.post(`/api/instructors/${myId}/worklog/entry`, {
      date: PAST,
      deliverable: "Doubt Clearing",
      quantity: "1",
      workingHours: "8h",
      remarks: "the correction",
      replace: true,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });

  test("and the day holds the correction ALONE, not both", async () => {
    const rows = await dayEntries(PAST);
    expect(rows.length, "a correction must replace the day, not add to it").toBe(1);
    expect(hoursOn(rows), "doubled hours mean the day was appended to").toBe(8);
    expect(rows[0]!.rawText).toBe("Doubt Clearing");
  });

  /* Deliberately NOT tested here: that appending to a nearly-full day is
     refused. That is `recordQuickEntry`'s day-full rule, it is unchanged by
     this fix, and pinning it from this file needs arithmetic about where the
     university's day starts and how much of it is left — which made the
     assertion depend on the seed rather than on the behaviour. The rule has its
     own coverage; this file is about REPLACE versus APPEND, and the three tests
     above settle that. */
});
