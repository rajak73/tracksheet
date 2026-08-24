import { beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/server/db";
import { ApiClient, ACCOUNTS } from "./helpers/client";

/**
 * The data contract behind "Edit Today's Log".
 *
 * ── What this does and does not prove ──────────────────────────────────────
 * The button's two states, its click-vs-hover trigger, and the textarea
 * actually filling in are client interactions — this project has no
 * component-rendering test infrastructure (no `@testing-library`, nothing
 * here ever renders React), and standing practice in this codebase is never
 * to browser-test either. What IS testable, and what the client feature
 * genuinely depends on, is proved here instead: that a fresh instructor's day
 * starts empty, that a submission is readable back with its own words intact,
 * and that resubmitting the same day REPLACES it rather than piling a second
 * submission on top — the exact rule `service.ts` documents ("The box offers
 * 'Edit' once something is written, and an edit that appended a second
 * worklog underneath the first was not an edit at all").
 *
 * Deliberately does not wait for AI parsing to finish, matching every other
 * end-to-end test in this suite that touches this route (see
 * `roster-write-boundary.test.ts`) — a live model call is slow and the two
 * things this file checks (raw bullets stored, the prior submission marked
 * superseded) both happen synchronously in the same transaction that accepts
 * the POST, before parsing ever starts.
 */

let admin: ApiClient;
let northId = "";
let instructorId = "";
const RUN = Math.random().toString(36).slice(2, 8).replace(/[0-9]/g, "x");

const TODAY_IST = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

beforeAll(async () => {
  admin = new ApiClient("admin");
  await admin.login(ACCOUNTS.admin);

  const probe = new ApiClient("probe");
  northId = (await probe.login(ACCOUNTS.instructorNorth1)).user.universityId!;

  // A fresh instructor, so "today starts empty" is not at the mercy of
  // whatever another test file left in the shared database.
  const created = await admin.post("/api/instructors", {
    email: `edit-today.${RUN}@example.edu`,
    name: `Edit Today ${RUN}`,
    password: "edit-today-test-pw-1234",
    universityId: northId,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  instructorId = created.body.instructor.id;
});

describe("a fresh instructor's today starts with nothing recorded", () => {
  test("no activities for today — the '+ Add' state's own signal", async () => {
    const res = await admin.get(
      `/api/activities?instructorId=${instructorId}&from=${TODAY_IST}&to=${TODAY_IST}`,
    );
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
    expect(res.body.activities).toHaveLength(0);
  });

  test("no live submission for today either", async () => {
    const res = await admin.get(`/api/instructors/${instructorId}/worklog?date=${TODAY_IST}`);
    expect(res.status).toBe(200);
    expect(res.body.submissions).toHaveLength(0);
  });
});

describe("a submission is readable back with its own words", () => {
  test("what was typed is what 'Edit Today's Log' would read back", async () => {
    const text = "9 to 11 taught DSA lecture on trees for section A";
    const submitted = await admin.post(`/api/instructors/${instructorId}/worklog`, {
      workDate: TODAY_IST,
      text,
    });
    expect([200, 201, 202], JSON.stringify(submitted.body)).toContain(submitted.status);

    const res = await admin.get(`/api/instructors/${instructorId}/worklog?date=${TODAY_IST}`);
    expect(res.status).toBe(200);
    expect(res.body.submissions).toHaveLength(1);
    // `rawBullets` for a narrative submission is the whole paragraph, as one
    // element — the exact shape `openEditToday()`'s pre-fill reads.
    expect(res.body.submissions[0].rawBullets).toEqual([text]);
    expect(res.body.submissions[0].inputMode).toBe("NARRATIVE");
  });
});

describe("resubmitting today REPLACES it, never appends a second one", () => {
  test("the earlier submission is marked superseded, synchronously", async () => {
    const first = await prisma.worklogSubmission.findMany({
      where: { instructorId, workDate: new Date(`${TODAY_IST}T00:00:00.000Z`) },
      orderBy: { submittedAt: "asc" },
    });
    expect(first, "the previous test's submission").toHaveLength(1);
    expect(first[0]!.supersededAt).toBeNull();

    const secondText = "1 to 2 doubt clearing session for the same section";
    const submitted = await admin.post(`/api/instructors/${instructorId}/worklog`, {
      workDate: TODAY_IST,
      text: secondText,
    });
    expect([200, 201, 202], JSON.stringify(submitted.body)).toContain(submitted.status);

    // Both rows are kept — the record of what was actually typed is never
    // deleted — but only one may be LIVE for a given instructor and day.
    const rows = await prisma.worklogSubmission.findMany({
      where: { instructorId, workDate: new Date(`${TODAY_IST}T00:00:00.000Z`) },
      orderBy: { submittedAt: "asc" },
    });
    expect(rows, "the first is kept, not deleted, and a second now exists").toHaveLength(2);
    expect(rows[0]!.supersededAt, "the first is no longer live").not.toBeNull();
    expect(rows[1]!.supersededAt, "the second is").toBeNull();
    expect((rows[1]!.rawBullets as string[])[0]).toBe(secondText);
  });

  test("the endpoint 'Edit Today's Log' reads from returns only the live one", async () => {
    const res = await admin.get(`/api/instructors/${instructorId}/worklog?date=${TODAY_IST}`);
    expect(res.status).toBe(200);
    // Not two submissions to choose between — the superseded one is filtered
    // server-side, so the client's `submissions.at(-1)` is unambiguously the
    // current day, never a stale first attempt.
    expect(res.body.submissions).toHaveLength(1);
    expect(res.body.submissions[0].rawBullets).toEqual([
      "1 to 2 doubt clearing session for the same section",
    ]);
  });
});

describe("rewriting today through the four fields replaces it", () => {
  /* The path "Edit Today's Log" takes now: the day's lines come back into the
   * boxes and are saved with `replace`, so what was there is gone rather than
   * doubled. Its own throwaway instructor, because these cases assert on the
   * whole of one day. */
  let mine = "";
  let asMe: ApiClient;

  beforeAll(async () => {
    const created = await admin.post("/api/instructors", {
      email: `replace.${RUN}@example.edu`,
      name: `Replace ${RUN}`,
      password: "replace-test-pw-1234",
      universityId: northId,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    mine = created.body.instructor.id;
    asMe = new ApiClient("replace-me");
    await asMe.login(created.body.instructor.user.email, "replace-test-pw-1234");
  });

  const dayRows = async () => {
    const res = await asMe.get(`/api/activities?from=${TODAY_IST}&to=${TODAY_IST}&limit=50`);
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
    return res.body.activities as Array<{ rawText: string | null; durationHours: number }>;
  };

  test("without `replace`, a second save adds to the day", async () => {
    const first = await asMe.post(`/api/instructors/${mine}/worklog/entry`, {
      date: TODAY_IST,
      deliverable: "Live class on trees",
      quantity: "1",
      workingHours: "2h",
    });
    expect(first.status, JSON.stringify(first.body)).toBe(201);

    const second = await asMe.post(`/api/instructors/${mine}/worklog/entry`, {
      date: TODAY_IST,
      deliverable: "Doubt session",
      quantity: "1",
      workingHours: "1h",
    });
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expect(await dayRows()).toHaveLength(2);
  });

  test("with `replace`, the day becomes exactly what was sent", async () => {
    const res = await asMe.post(`/api/instructors/${mine}/worklog/entry`, {
      date: TODAY_IST,
      // The same two lines the boxes would hand back, with one corrected.
      deliverable: "Live class on binary trees\nDoubt session",
      quantity: "1\n1",
      workingHours: "3h\n1h",
      replace: true,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const rows = await dayRows();
    expect(rows, "two in, two out — not four").toHaveLength(2);
    expect(rows.map((r) => r.rawText).sort()).toEqual(
      ["Doubt session", "Live class on binary trees"],
    );
    // The correction took: 2h became 3h.
    expect(rows.reduce((n, r) => n + r.durationHours, 0)).toBe(4);
  });

  test("a replace that cannot parse leaves the day untouched", async () => {
    const before = await dayRows();
    const res = await asMe.post(`/api/instructors/${mine}/worklog/entry`, {
      date: TODAY_IST,
      deliverable: "Live class\nDoubt session",
      // Three hours for two deliverables — refused by `splitEntries`.
      workingHours: "1h\n2h\n3h",
      replace: true,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    // The clearing happens AFTER the parse, so a refusal never empties a day.
    expect(await dayRows()).toHaveLength(before.length);
  });
});
