import { beforeAll, describe, expect, test } from "vitest";
import { prisma } from "@/server/db";
import { ApiClient, ACCOUNTS } from "./helpers/client";
import { toDateOnly } from "@/server/time/workday";
import { daysAgo } from "./helpers/worklog";
import { RUN } from "./helpers/fixtures";
/**
 * Removing a day, and what goes with it.
 *
 * ── Three tables, three different answers ─────────────────────────────────
 * `WorklogEntry` is the record and goes. `DayExtraction` is a reading OF that
 * record and goes with it — a reading of a day that no longer exists would let
 * a later insight be assembled from work that has been removed.
 * `ai_insight_cache` is NOT swept, and that is deliberate rather than an
 * oversight: its rows are keyed by a hash of the day's content, so a deleted
 * day simply stops matching and the row is inert. Sweeping it would mean
 * remembering to, in every path that ever writes a day.
 */


let admin: ApiClient, instructor: ApiClient;
let instructorId = "", universityId = "";
const DAY = daysAgo(200);

beforeAll(async () => {
  admin = new ApiClient("admin");
  await admin.login(ACCOUNTS.admin);

  const probe = new ApiClient("probe");
  universityId = (await probe.login(ACCOUNTS.instructorNorth1)).user.universityId!;

  const created = await admin.post("/api/instructors", {
    email: `daydelete.${RUN}@fixture.test`,
    name: `Day Delete ${RUN}`,
    password: "day-delete-pw-1234",
    universityId,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  instructorId = created.body.instructor.id;

  instructor = new ApiClient("day-delete");
  await instructor.login(`daydelete.${RUN}@fixture.test`, "day-delete-pw-1234");
});

const writeDay = () =>
  instructor.post(`/api/instructors/${instructorId}/worklog/entry`, {
    date: DAY,
    deliverable: "Live Class on binary search",
    quantity: "2 classes",
    workingHours: "6h 30m",
  });

const removeDay = () =>
  instructor.delete(`/api/instructors/${instructorId}/worklog/entry?date=${DAY}`);

const storedDay = () =>
  prisma.worklogEntry.findUnique({
    where: { instructorId_logDate: { instructorId, logDate: toDateOnly(DAY) } },
  });

describe("11. one call removes the day and its reading", () => {
  test("both go, and saying so twice is not an error", async () => {
    expect((await writeDay()).status).toBe(201);

    /* A reading of the day, as extraction would leave one. Written directly
       because extraction is not built yet — what is being tested is the delete,
       and it must already be correct when extraction arrives. */
    await prisma.dayExtraction.create({
      data: {
        instructorId,
        logDate: toDateOnly(DAY),
        sourceHash: "0".repeat(64),
        rawContext: {},
        items: [],
        promptVersion: "extract_v1",
        modelId: "test-model",
      },
    });

    const first = await removeDay();
    expect(first.status, JSON.stringify(first.body)).toBe(200);

    expect(await storedDay()).toBeNull();
    expect(
      await prisma.dayExtraction.findFirst({
        where: { instructorId, logDate: toDateOnly(DAY) },
      }),
      "a reading of a day that no longer exists",
    ).toBeNull();

    /* Idempotent: the caller asked for the day to be absent, and it is. A 404
       here would tell somebody clicking Delete twice they had done wrong. */
    expect((await removeDay()).status).toBe(200);
  });
});

describe("12. the insight cache is left alone", () => {
  test("its row survives the delete, because its hash is what makes it stale", async () => {
    expect((await writeDay()).status).toBe(201);

    const cached = await prisma.aiInsightCache.create({
      data: {
        instructorId,
        scopeType: "DAY",
        periodStart: toDateOnly(DAY),
        periodEnd: toDateOnly(DAY),
        contextHash: "a".repeat(64),
        rawContext: {},
        insightPayload: { summary: "a reading from before the day was removed" },
        status: "READY",
        promptVersion: "day_v1",
        modelId: "test-model",
      },
    });

    expect((await removeDay()).status).toBe(200);

    const still = await prisma.aiInsightCache.findUnique({ where: { id: cached.id } });
    expect(still, "the cache row is not swept").toBeTruthy();

    /* And it is inert rather than dangerous: the day it describes is gone, so
       nothing can hash to it and nothing will serve it. */
    expect(await storedDay()).toBeNull();
  });
});

describe("16. no per-activity route remains reachable", () => {
  test("the day is the unit, so there is no entry id to address", async () => {
    expect((await writeDay()).status).toBe(201);
    const day = await storedDay();
    expect(day).toBeTruthy();

    /* The page used to PATCH and DELETE a single entry by id. Those routes are
       gone; asking for one by the day's own id must not find a way in. */
    for (const path of [
      `/api/instructors/${instructorId}/worklog/entry/${day!.id}`,
      `/api/instructors/${instructorId}/activities/${day!.id}`,
    ]) {
      expect([404, 405], `DELETE ${path}`).toContain(
        (await instructor.delete(path)).status,
      );
      expect([404, 405], `PATCH ${path}`).toContain(
        (await instructor.patch(path, { deliverable: "nope" })).status,
      );
    }

    // The day itself is untouched by any of that.
    expect((await storedDay())!.deliverable).toBe("Live Class on binary search");
  });
});
