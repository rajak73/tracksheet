import { beforeAll, describe, expect, test } from "vitest";
import { ApiClient, ACCOUNTS } from "./helpers/client";

/**
 * A rewrite that records nothing must leave the day as it found it.
 *
 * ── The bug ───────────────────────────────────────────────────────────────
 * "Edit Today's Log" sends `replace: true`, and the route clears the day before
 * writing the new lines — it has to, because `recordQuickEntry` lays each entry
 * after whatever is already there, so replacing eight hours with eight more
 * would run past midnight and be refused for it.
 *
 * Parsing is not the only way a rewrite fails. A line can parse perfectly and
 * still be refused by the WRITER, and "20h" is the easy one to reach: an
 * instructor correcting 3h types it, the parser is happy, and the writer says
 * it would run past midnight. By then the day was already deleted. Every line
 * is refused, `NOTHING_RECORDED` comes back as a 400, and the instructor sees
 * an error and reasonably concludes nothing changed.
 *
 * Their day was gone. Confirmed against the database before the fix: a day
 * holding one valid entry came back holding none.
 *
 * ── What this pins ────────────────────────────────────────────────────────
 * Not the error — the error is correct and should stay a 400. What must hold is
 * that the entries which were there before the attempt are still there after
 * it, unchanged, so a refusal costs the instructor nothing but the retype.
 */

const RUN = Math.random().toString(36).slice(2, 8).replace(/[0-9]/g, "z");
const PASSWORD = "replace-rollback-pw-1234";

let admin: ApiClient, instructor: ApiClient;
let myId = "";

/* Northfield is Asia/Kolkata, and a work day is judged in the UNIVERSITY's
 * zone — so that is the zone this date is built in, not the machine's. */
const TODAY = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

beforeAll(async () => {
  admin = new ApiClient("admin");
  await admin.login(ACCOUNTS.admin);

  const probe = new ApiClient("probe");
  const northId = (await probe.login(ACCOUNTS.instructorNorth1)).user.universityId!;

  /* Its own instructor. The day is deliberately emptied and rewritten here, and
   * doing that to a seeded account would break whatever else reads it. */
  const email = `replace.rollback.${RUN}@example.edu`;
  const created = await admin.post("/api/instructors", {
    email,
    name: `Replace Rollback ${RUN}`,
    password: PASSWORD,
    universityId: northId,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  myId = created.body.instructor.id;

  instructor = new ApiClient("instructor");
  await instructor.login(email, PASSWORD);
});

const entry = (workingHours: string, remarks: string | null) => ({
  date: TODAY,
  deliverable: "Live Class",
  quantity: 1,
  workingHours,
  remarks,
  replace: true,
});

async function dayEntries() {
  const res = await admin.get(
    `/api/activities?instructorId=${myId}&from=${TODAY}&to=${TODAY}&limit=100`,
  );
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.activities as Array<{ id: string; remarks: string | null }>;
}

describe("a replace that records nothing leaves the day untouched", () => {
  test("the day starts with one recorded entry", async () => {
    const res = await instructor.post(
      `/api/instructors/${myId}/worklog/entry`,
      entry("3h", "the original"),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const before = await dayEntries();
    expect(before.length).toBe(1);
    expect(before[0]!.remarks).toBe("the original");
  });

  test("a rewrite the WRITER refuses is still a 400", async () => {
    /* Parses fine — "20h" is a valid length of time. It is the writer that
     * refuses it, which is precisely what made this dangerous: the request gets
     * past the guard that runs before the delete. */
    const res = await instructor.post(`/api/instructors/${myId}/worklog/entry`, entry("20h", null));
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error.code).toBe("NOTHING_RECORDED");
  });

  test("and the entry that was already there survived it", async () => {
    const after = await dayEntries();
    expect(after.length, "a refused rewrite must not empty the day").toBe(1);
    expect(after[0]!.remarks, "the original entry must come back unchanged").toBe("the original");
  });

  test("a rewrite that DOES record still replaces the day", async () => {
    // The restore must not have turned `replace` into "append" — a successful
    // rewrite has to leave exactly the new lines behind.
    const res = await instructor.post(
      `/api/instructors/${myId}/worklog/entry`,
      entry("2h", "the correction"),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const after = await dayEntries();
    expect(after.length).toBe(1);
    expect(after[0]!.remarks).toBe("the correction");
  });
});
