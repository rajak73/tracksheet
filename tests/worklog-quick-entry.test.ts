import { beforeAll, describe, expect, test } from "vitest";
import { ApiClient, ACCOUNTS } from "./helpers/client";

/**
 * The four-field work log.
 *
 * ── What the client asked for ─────────────────────────────────────────────
 * An instructor writes up their day as: what they produced, how many of it,
 * how long it took, and anything worth adding. No clock range, no category
 * picker, no sentences for a model to read.
 *
 * ── What the form does not ask for, and why it still works ────────────────
 * The sheet has a Broad Category column. The subject is read from the
 * deliverable text, and a day naming none inherits from the last office day
 * that did — so the column answers without the instructor choosing from a menu,
 * which is the client's stated position.
 *
 * Under test the AI provider is deliberately absent, so classification falls
 * back to OTHER with no subject. That is the designed behaviour rather than a
 * limitation of the test: a provider outage must never stop somebody recording
 * their day, and these cases pin exactly that.
 *
 * ── Why the times matter ──────────────────────────────────────────────────
 * `ActivityLog` stores two instants and derives duration from them, so the
 * hours are laid on the day end to end. Stacking every entry at the same start
 * would trip the overlap rule on the second row of every day — the rule that
 * stops a day quietly holding fourteen hours.
 *
 * ── Why TODAY, and why a throwaway instructor ─────────────────────────────
 * This file used to write to a fixed past date (2026-04-14). That stopped
 * working when the day rule — "an instructor records TODAY", which the
 * narrative box had always enforced — was extended to the quick-entry routes
 * it had never covered. The date moved rather than the caller: writing as an
 * admin would have kept the tests green while quietly no longer exercising the
 * path an instructor actually takes, which is the whole subject of the file.
 *
 * The instructor is created here rather than seeded, because these cases lay
 * hours end to end on one day and assert on the day's running total — a
 * seeded instructor already carrying rollup data for today would move those
 * totals depending on which files ran first.
 */

const RUN = Math.random()
  .toString(36)
  .slice(2, 10)
  .replace(/[0-9]/g, (d) => String.fromCharCode(103 + Number(d)));

let admin: ApiClient, instructor: ApiClient;
let myId = "", theirId = "";

/* Northfield is Asia/Kolkata, and the university's own day is the only one the
 * server measures this rule in — so "today" is asked of that zone rather than
 * of the machine running the suite. */
const DAY = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

const PASSWORD = "quick-entry-test-pw-1234";

beforeAll(async () => {
  admin = new ApiClient("admin");
  await admin.login(ACCOUNTS.admin);

  const probe = new ApiClient("probe");
  const northId = (await probe.login(ACCOUNTS.instructorNorth1)).user.universityId!;

  const newInstructor = async (tag: string) => {
    const res = await admin.post("/api/instructors", {
      email: `quick.${tag}.${RUN}@example.edu`,
      name: `Quick ${tag} ${RUN}`,
      password: PASSWORD,
      universityId: northId,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return { id: res.body.instructor.id as string, email: res.body.instructor.user.email as string };
  };

  const me = await newInstructor("me");
  myId = me.id;
  instructor = new ApiClient("me");
  await instructor.login(me.email, PASSWORD);

  theirId = (await newInstructor("colleague")).id;
});

const entry = (over: Partial<Record<string, unknown>> = {}) => ({
  date: DAY,
  deliverable: `Build the user module API ${RUN}`,
  quantity: 2,
  workingHours: 3,
  remarks: "Completed as per plan",
  ...over,
});

describe("writing up a day", () => {
  test("four fields are enough", async () => {
    const res = await instructor.post(`/api/instructors/${myId}/worklog/entry`, entry());
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const list = await instructor.get(`/api/activities?from=${DAY}&to=${DAY}&limit=50`);
    const row = list.body.activities.find((a: { id: string }) => a.id === res.body.activity.id);
    expect(row, "the entry should come back in their own log").toBeTruthy();
    expect(row.rawText, "their words are kept exactly").toBe(`Build the user module API ${RUN}`);
    expect(row.quantity).toBe(2);
    expect(row.durationHours, "the hours they typed").toBe(3);
    expect(row.remarks).toBe("Completed as per plan");
  });

  test("a second entry on the same day sits after the first, not on top of it", async () => {
    const second = await instructor.post(
      `/api/instructors/${myId}/worklog/entry`,
      entry({ deliverable: `Write the unit tests ${RUN}`, workingHours: 2, quantity: 1 }),
    );
    expect(second.status, JSON.stringify(second.body)).toBe(201);

    const list = await instructor.get(`/api/activities?from=${DAY}&to=${DAY}&limit=50`);
    const mine = list.body.activities.filter((a: { rawText: string | null }) =>
      a.rawText?.includes(RUN),
    );
    expect(mine.length).toBe(2);

    // Laid end to end: no two entries occupy the same minute.
    const spans = mine
      .map((a: { startTime: string; endTime: string }) => ({
        start: Date.parse(a.startTime),
        end: Date.parse(a.endTime),
      }))
      .sort((a: { start: number }, b: { start: number }) => a.start - b.start);
    expect(spans[0].end).toBeLessThanOrEqual(spans[1].start);
  });

  test("the day's hours add up to what was typed", async () => {
    const list = await instructor.get(`/api/activities?from=${DAY}&to=${DAY}&limit=50`);
    const total = list.body.activities
      .filter((a: { rawText: string | null }) => a.rawText?.includes(RUN))
      .reduce((n: number, a: { durationHours: number }) => n + a.durationHours, 0);
    expect(total, "three hours plus two").toBe(5);
  });
});

describe("correcting an entry", () => {
  test("an edit keeps the row and changes what it says", async () => {
    const created = await instructor.post(
      `/api/instructors/${myId}/worklog/entry`,
      entry({ deliverable: `First wording ${RUN}`, workingHours: 1 }),
    );
    expect(created.status).toBe(201);
    const id = created.body.activity.id;

    const edited = await instructor.patch(
      `/api/instructors/${myId}/worklog/entry/${id}`,
      entry({ deliverable: `Corrected wording ${RUN}`, workingHours: 4, quantity: 7 }),
    );
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);

    const list = await instructor.get(`/api/activities?from=${DAY}&to=${DAY}&limit=50`);
    const row = list.body.activities.find((a: { id: string }) => a.id === id);
    expect(row, "the row keeps its id through an edit").toBeTruthy();
    expect(row.rawText).toBe(`Corrected wording ${RUN}`);
    expect(row.durationHours).toBe(4);
    expect(row.quantity).toBe(7);
  });
});

describe("what the form refuses", () => {
  test("no deliverable", async () => {
    const res = await instructor.post(
      `/api/instructors/${myId}/worklog/entry`,
      entry({ deliverable: "   " }),
    );
    expect(res.status).toBe(400);
  });

  test("hours that are not a number above zero", async () => {
    for (const workingHours of [0, -2, 25]) {
      const res = await instructor.post(`/api/instructors/${myId}/worklog/entry`, entry({ workingHours }));
      expect(res.status, `workingHours=${workingHours}`).toBe(400);
    }
  });

  test("a date that is not a date", async () => {
    const res = await instructor.post(
      `/api/instructors/${myId}/worklog/entry`,
      entry({ date: "2026-02-31" }),
    );
    expect(res.status).toBe(400);
  });

  test("more hours than the day can hold", async () => {
    // The day already holds nine hours from the cases above.
    const res = await instructor.post(
      `/api/instructors/${myId}/worklog/entry`,
      entry({ workingHours: 20 }),
    );
    expect(res.status, "should be refused rather than running past midnight").toBe(400);
  });
});

describe("it is their own log", () => {
  test("an instructor cannot write into a colleague's day", async () => {
    const res = await instructor.post(`/api/instructors/${theirId}/worklog/entry`, entry());
    expect([403, 404]).toContain(res.status);
  });

  test("nor edit a colleague's entry", async () => {
    const theirs = await admin.post(`/api/instructors/${theirId}/worklog/entry`, {
      ...entry({ deliverable: `Their work ${RUN}` }),
    });
    expect(theirs.status).toBe(201);

    const res = await instructor.patch(
      `/api/instructors/${theirId}/worklog/entry/${theirs.body.activity.id}`,
      entry(),
    );
    expect([403, 404]).toContain(res.status);
  });
});
