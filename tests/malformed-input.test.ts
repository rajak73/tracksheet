import { beforeAll, describe, expect, test } from "vitest";
import { ApiClient, ACCOUNTS } from "./helpers/client";

/**
 * A malformed request is a 400, never a 500.
 *
 * ── Why these particular shapes ───────────────────────────────────────────
 * Every case here passed a guard that was checking the SHAPE of a value rather
 * than the value itself, and then failed somewhere it could not be caught.
 *
 * `2026-02-31` matches `\\d{4}-\\d{2}-\\d{2}`. It is not a date. `Date.parse`
 * gives NaN for it, every comparison against NaN is false — so a range cap
 * written as `span > MAX` simply did not apply — and `toISOString()` on the
 * Invalid Date it produces throws a RangeError the route wrapper reports as a
 * server fault.
 *
 * `__proto__` is not a sort key, but `"__proto__" in SORTS` is true, because
 * `in` walks the prototype chain. The lookup then returned something that is
 * not a comparator and `Array.sort` threw.
 *
 * A 500 here is not a cosmetic difference. It says the server broke, when what
 * happened is that somebody sent a bad parameter — and it hides a genuine
 * fault when one occurs.
 */

let admin: ApiClient, manager: ApiClient;

beforeAll(async () => {
  admin = new ApiClient("admin");
  await admin.login(ACCOUNTS.admin);
  manager = new ApiClient("manager");
  await manager.login(ACCOUNTS.managerNorth);
});

const NOT_A_DATE = "2026-02-31";

describe("a date that is not a date", () => {
  

  test("the manager worklog refuses it", async () => {
    const res = await manager.get(`/api/manager/worklog?from=2026-01-01&to=${NOT_A_DATE}`);
    expect(res.status, JSON.stringify(res.body)).toBe(400);
  });

  test("the manager overview refuses a bad date", async () => {
    const res = await manager.get(`/api/manager/overview?date=${NOT_A_DATE}&month=2026-01`);
    expect(res.status, JSON.stringify(res.body)).toBe(400);
  });

  test("the manager overview refuses a thirteenth month", async () => {
    const res = await manager.get("/api/manager/overview?date=2026-01-15&month=2026-13");
    expect(res.status, JSON.stringify(res.body)).toBe(400);
  });
});

describe("a sort key that is not a sort key", () => {
  test("an inherited property does not pass the whitelist", async () => {
    for (const key of ["__proto__", "toString", "constructor", "hasOwnProperty"]) {
      const res = await admin.get(`/api/managers?sort=${encodeURIComponent(key)}`);
      expect(res.status, `sort=${key} returned ${res.status}`).toBe(400);
    }
  });

  test("a real sort key still works", async () => {
    expect((await admin.get("/api/managers?sort=utilization")).status).toBe(200);
  });
});

describe("a page number past what the database can express", () => {
  test("is refused rather than overflowing a query", async () => {
    const res = await admin.get("/api/instructors?page=99999999999&limit=10");
    expect(res.status, JSON.stringify(res.body)).toBe(400);
  });

  test("an ordinary page still works", async () => {
    expect((await admin.get("/api/instructors?page=1&limit=10")).status).toBe(200);
  });
});
