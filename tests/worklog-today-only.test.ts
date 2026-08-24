import { beforeAll, describe, expect, test } from "vitest";
import { ApiClient, ACCOUNTS } from "./helpers/client";

/**
 * An instructor records TODAY — on the worklog routes, and on the routes the
 * worklog screen mutates through.
 *
 * ── The shape of the bug this pins ────────────────────────────────────────
 * The rule is old and was always documented — see the header of
 * `src/server/worklog/window.ts`: "An instructor writes up TODAY. Not
 * yesterday, not last week." What was not true is that it applied everywhere.
 * `verifyEntry` enforced it for the narrative paragraph, and the four-field
 * quick entry, its per-row edit, and the activity edit/delete routes grew up
 * beside it without ever picking it up. So the same past day was refused by
 * the paragraph box and freely rewritten by the pencil on the row next to it.
 *
 * ── Where the line was drawn, and where it was not ───────────────────────
 * Guarded: the two worklog quick-entry routes, and activity PATCH/DELETE —
 * which is what the worklog screen's own edit and delete buttons call, so the
 * screen and the server now agree about which rows are writable.
 *
 * Not guarded: `POST /api/instructors/:id/activities`. See the second describe
 * below for why that is a decision rather than an omission.
 *
 * ── Why the manager cases are here too ───────────────────────────────────
 * The refusal's own wording — "Ask your manager to record anything from an
 * earlier day" — makes a manager's ability to backdate part of the rule rather
 * than a gap in it. If a later tightening took that away, the message would be
 * telling instructors to ask for something nobody could do, so it is pinned
 * from both sides: refused for the instructor, allowed for the admin.
 */

const RUN = Math.random()
  .toString(36)
  .slice(2, 10)
  .replace(/[0-9]/g, (d) => String.fromCharCode(103 + Number(d)));

let admin: ApiClient, instructor: ApiClient;
let myId = "";

/* Northfield is Asia/Kolkata. The rule is judged in the UNIVERSITY's zone, so
 * that is the zone these dates are built in — not the machine's. */
const TODAY = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

const shift = (days: number) => {
  const d = new Date(`${TODAY}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const YESTERDAY = shift(-1);
const TOMORROW = shift(1);

const PASSWORD = "today-only-test-pw-1234";

beforeAll(async () => {
  admin = new ApiClient("admin");
  await admin.login(ACCOUNTS.admin);

  const probe = new ApiClient("probe");
  const northId = (await probe.login(ACCOUNTS.instructorNorth1)).user.universityId!;

  const created = await admin.post("/api/instructors", {
    email: `today-only.${RUN}@example.edu`,
    name: `Today Only ${RUN}`,
    password: PASSWORD,
    universityId: northId,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  myId = created.body.instructor.id;

  instructor = new ApiClient("me");
  await instructor.login(created.body.instructor.user.email, PASSWORD);
});

const entry = (date: string) => ({
  date,
  deliverable: `Live class ${RUN}`,
  quantity: 1,
  workingHours: 1,
  remarks: null,
});

describe("the four-field quick entry", () => {
  test("today is accepted", async () => {
    const res = await instructor.post(`/api/instructors/${myId}/worklog/entry`, entry(TODAY));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });

  test("yesterday is refused, and says to ask a manager", async () => {
    const res = await instructor.post(`/api/instructors/${myId}/worklog/entry`, entry(YESTERDAY));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("WORKLOG_DATE_NOT_ALLOWED");
    expect(res.body.error.message).toContain("manager");
  });

  test("tomorrow is refused as not having happened", async () => {
    const res = await instructor.post(`/api/instructors/${myId}/worklog/entry`, entry(TOMORROW));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("WORKLOG_DATE_NOT_ALLOWED");
  });
});

describe("the activity create route is deliberately NOT held to today", () => {
  /* Stated as a test rather than left as a silence, because the asymmetry
   * looks exactly like a route somebody forgot. It is not: this is the
   * general activity API, it is how a manager records hours and how history
   * gets built, and a route that only accepts today cannot express "last week
   * against the week before". Holding it to today broke twenty-six suites,
   * several of them legitimately about multi-day arithmetic.
   *
   * The instructor-facing consequence is bounded in the UI instead — no
   * instructor screen offers a non-today date into it. If that ever changes,
   * this test says out loud what the server does and does not promise. */
  const local = (date: string) => ({
    activityTypeCode: "TEACHING",
    local: { date, start: "14:00", end: "15:00" },
  });

  test("today is accepted", async () => {
    const res = await instructor.post(`/api/instructors/${myId}/activities`, local(TODAY));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });

  test("a past day is still accepted here — and cannot then be edited or deleted", async () => {
    const res = await instructor.post(`/api/instructors/${myId}/activities`, local(YESTERDAY));
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    // The wart, pinned: created, then immovable by the same caller.
    const edit = await instructor.patch(
      `/api/instructors/${myId}/activities/${res.body.activity.id}`,
      local(YESTERDAY),
    );
    expect(edit.status).toBe(400);
    expect(edit.body.error.code).toBe("WORKLOG_DATE_NOT_ALLOWED");
  });
});

describe("editing and removing a day that is not today", () => {
  /** An activity on YESTERDAY, put there by an admin — who is allowed to. */
  let past = "";

  beforeAll(async () => {
    const res = await admin.post(`/api/instructors/${myId}/activities`, {
      activityTypeCode: "TEACHING",
      local: { date: YESTERDAY, start: "09:00", end: "10:00" },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    past = res.body.activity.id;
  });

  test("an admin may record an earlier day — the escape hatch the refusal names", () => {
    // Established by the beforeAll above; asserted so the rule's own advice
    // ("ask your manager") cannot quietly stop being true.
    expect(past).toBeTruthy();
  });

  test("the instructor cannot edit it", async () => {
    const res = await instructor.patch(`/api/instructors/${myId}/activities/${past}`, {
      activityTypeCode: "RESEARCH",
      local: { date: YESTERDAY, start: "09:00", end: "10:00" },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error.code).toBe("WORKLOG_DATE_NOT_ALLOWED");
  });

  test("nor drag it onto today to get around that", async () => {
    /* The check that is easy to miss. Guarding only the date being saved TO
     * would pass this — it writes today — while quietly removing work from a
     * day the same caller was just refused. Both ends of a move are checked. */
    const res = await instructor.patch(`/api/instructors/${myId}/activities/${past}`, {
      activityTypeCode: "TEACHING",
      local: { date: TODAY, start: "17:00", end: "18:00" },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error.code).toBe("WORKLOG_DATE_NOT_ALLOWED");
  });

  test("nor delete it", async () => {
    const res = await instructor.delete(`/api/instructors/${myId}/activities/${past}`);
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error.code).toBe("WORKLOG_DATE_NOT_ALLOWED");
  });

  test("and it is still there afterwards", async () => {
    const list = await admin.get(
      `/api/activities?instructorId=${myId}&from=${YESTERDAY}&to=${YESTERDAY}&limit=50`,
    );
    expect(list.status).toBe(200);
    expect(
      list.body.activities.some((a: { id: string }) => a.id === past),
      "a refused delete must not have deleted anything",
    ).toBe(true);
  });
});
