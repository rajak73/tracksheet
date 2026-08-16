import { beforeAll, describe, expect, test } from "vitest";
import { ACCOUNTS, ApiClient } from "./helpers/client";

/**
 * Who may read a university's workload targets.
 *
 * A `WorkloadTarget` row may carry an `instructorId`, naming the one person it
 * applies to. The GET on this route was tenant-scoped but had no role gate and
 * no self-pin, so any instructor could enumerate what every colleague in their
 * university is measured against. Nothing in `src/app` fetches this endpoint,
 * so no product flow depended on that access.
 *
 * These are wire-level probes: they prove the refusal is server-side, which is
 * the only kind that counts.
 */

let admin: ApiClient, mgrNorth: ApiClient, mgrWest: ApiClient;
let instNorth: ApiClient, anon: ApiClient;
let northId: string, westId: string;

beforeAll(async () => {
  admin = new ApiClient("admin");
  const a = await admin.login(ACCOUNTS.admin);
  expect(a.user.role).toBe("ADMIN");

  mgrNorth = new ApiClient("manager-north");
  northId = (await mgrNorth.login(ACCOUNTS.managerNorth)).user.universityId!;

  mgrWest = new ApiClient("manager-west");
  westId = (await mgrWest.login(ACCOUNTS.managerWest)).user.universityId!;

  instNorth = new ApiClient("instructor-north");
  await instNorth.login(ACCOUNTS.instructorNorth1);

  anon = new ApiClient("anonymous");

  expect(northId).toBeTruthy();
  expect(westId).toBeTruthy();
  expect(northId).not.toBe(westId);
});

describe("GET /api/universities/:id/workload-targets", () => {
  test("an ADMIN may read any university's targets", async () => {
    for (const id of [northId, westId]) {
      const res = await admin.get(`/api/universities/${id}/workload-targets`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.targets)).toBe(true);
    }
  });

  test("a MANAGER may read their own university's targets", async () => {
    const res = await mgrNorth.get(`/api/universities/${northId}/workload-targets`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.targets)).toBe(true);
  });

  test("a MANAGER is refused another university's targets", async () => {
    const res = await mgrNorth.get(`/api/universities/${westId}/workload-targets`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("CROSS_TENANT_DENIED");
  });

  test("an INSTRUCTOR is refused, even for their own university", async () => {
    const res = await instNorth.get(`/api/universities/${northId}/workload-targets`);
    expect(res.status).toBe(403);
    // The ROLE gate must fire, not the tenant check and not a filtered read.
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect(res.body.targets).toBeUndefined();
  });

  test("an INSTRUCTOR is refused another university's targets too", async () => {
    const res = await instNorth.get(`/api/universities/${westId}/workload-targets`);
    expect(res.status).toBe(403);
    expect(res.body.targets).toBeUndefined();
  });

  test("the refusal is the role gate, so it cannot be widened by a query param", async () => {
    const res = await instNorth.get(
      `/api/universities/${northId}/workload-targets?instructorId=anything`,
    );
    expect(res.status).toBe(403);
    expect(res.body.targets).toBeUndefined();
  });

  test("an unauthenticated caller is refused", async () => {
    const res = await anon.get(`/api/universities/${northId}/workload-targets`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
    expect(res.body.targets).toBeUndefined();
  });
});

describe("POST /api/universities/:id/workload-targets stays ADMIN-only", () => {
  const body = {
    activityTypeCode: "TEACHING",
    targetMinutes: 60,
    effectiveFrom: "2027-01-04",
  };

  test("a MANAGER may not create a target for their own university", async () => {
    const res = await mgrNorth.post(`/api/universities/${northId}/workload-targets`, body);
    expect(res.status).toBe(403);
  });

  test("an INSTRUCTOR may not create a target", async () => {
    const res = await instNorth.post(`/api/universities/${northId}/workload-targets`, body);
    expect(res.status).toBe(403);
  });

  test("an unauthenticated caller may not create a target", async () => {
    const res = await anon.post(`/api/universities/${northId}/workload-targets`, body);
    expect(res.status).toBe(401);
  });
});
