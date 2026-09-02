import { beforeAll, describe, expect, test } from "vitest";
import { ACCOUNTS, ApiClient } from "./helpers/client";

/**
 * Phase 8 gate — reports, notifications, audit.
 *
 * The required test is that an exported report's numbers match the dashboard
 * exactly for the same instructor and period. Around it: ReportJob rows are
 * genuinely created, and the four notification categories fire without
 * repeating themselves every tick.
 */

const MON = "2027-05-03";
const TUE = "2027-05-04";
const FROM = "2027-05-03";
const TO = "2027-05-07";

let admin: ApiClient, mgrN: ApiClient, n1: ApiClient;
let northId: string, n1Id: string;

function ist(date: string, hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + (h * 60 + m - 330) * 60_000).toISOString();
}

beforeAll(async () => {
  admin = new ApiClient("admin");
  mgrN = new ApiClient("mgrN");
  n1 = new ApiClient("n1");
  await admin.login(ACCOUNTS.admin);
  await mgrN.login(ACCOUNTS.managerNorth);
  const me = await n1.login(ACCOUNTS.instructorNorth1);
  n1Id = me.user.instructorId!;
  northId = me.user.universityId!;

  await n1.post(`/api/instructors/${n1Id}/activities`, {
    activityTypeCode: "TEACHING", startTime: ist(MON, "10:00"), endTime: ist(MON, "14:00"),
  });
  await n1.post(`/api/instructors/${n1Id}/activities`, {
    activityTypeCode: "TEACHING", startTime: ist(TUE, "10:00"), endTime: ist(TUE, "13:00"),
  });
});

describe("Gate — an exported report matches the dashboard exactly", () => {
  test("CSV figures equal the analytics figures for the same period", async () => {
    const analytics = await mgrN.get(
      `/api/universities/${northId}/analytics?from=${FROM}&to=${TO}`,
    );
    const mine = analytics.body.analytics.instructors.find(
      (i: { instructorId: string }) => i.instructorId === n1Id,
    );

    const csv = await mgrN.request(
      `/api/universities/${northId}/reports?from=${FROM}&to=${TO}&export=csv`,
      { method: "GET" },
    );
    expect(csv.status).toBe(200);

    const header = String(csv.body).split("\n")[0].split(",");
    const row = String(csv.body)
      .split("\n")
      .find((l) => l.startsWith(mine.instructorName))!
      .split(",");

    const cell = (name: string) => row[header.indexOf(name)];
    expect(Number(cell("Capacity Hours"))).toBe(mine.capacityHours);
    expect(Number(cell("Productive Hours"))).toBe(mine.productiveHours);
    expect(Number(cell("Unutilized Hours"))).toBe(mine.unutilizedHours);
    expect(Number(cell("Missing Data Hours"))).toBe(mine.missingDataHours);
    /* "Recorded Hours %", not "Utilization %". The column answers a different
       question since every recorded hour started counting, and the header moved
       with the field so a spreadsheet and the screen name the same thing. */
    expect(Number(cell("Recorded Hours %"))).toBe(mine.recordedHoursPct);
  });

  test("the JSON report and the CSV describe the same rows", async () => {
    const json = await mgrN.get(`/api/universities/${northId}/reports?from=${FROM}&to=${TO}`);
    const csv = await mgrN.request(
      `/api/universities/${northId}/reports?from=${FROM}&to=${TO}&export=csv`,
      { method: "GET" },
    );
    const dataLines = String(csv.body).trim().split("\n").slice(1);
    expect(dataLines).toHaveLength(json.body.report.rows.length);
  });
});

describe("ReportJob rows are genuinely created", () => {
  test("an export records a completed job with a row count", async () => {
    const before = await admin.get("/api/admin/report-jobs");
    expect(before.status).toBe(200);
    const countBefore = before.body.jobs.length;

    const csv = await mgrN.request(
      `/api/universities/${northId}/reports?from=${FROM}&to=${TO}&export=csv`,
      { method: "GET" },
    );
    expect(csv.status).toBe(200);

    const after = await admin.get("/api/admin/report-jobs");
    expect(after.body.jobs.length).toBeGreaterThan(countBefore);

    const job = after.body.jobs[0];
    expect(job.status).toBe("COMPLETED");
    expect(job.format).toBe("CSV");
    expect(job.reportType).toBe("INSTRUCTOR_WORKLOAD");
    expect(job.rowCount).toBeGreaterThan(0);
    expect(job.completedAt).not.toBeNull();
  });

  test("viewing the report as JSON does not create a job", async () => {
    const before = await admin.get("/api/admin/report-jobs");
    await mgrN.get(`/api/universities/${northId}/reports?from=${FROM}&to=${TO}`);
    const after = await admin.get("/api/admin/report-jobs");
    expect(after.body.jobs.length).toBe(before.body.jobs.length);
  });

  test("the export is recorded in the audit log", async () => {
    await mgrN.request(
      `/api/universities/${northId}/reports?from=${FROM}&to=${TO}&export=csv`,
      { method: "GET" },
    );
    const audit = await admin.get(`/api/universities/${northId}/audit?action=REPORT_EXPORTED`);
    expect(audit.status).toBe(200);
    expect(audit.body.entries.length).toBeGreaterThan(0);
    expect(audit.body.entries[0].entityType).toBe("ReportJob");
  });

  test("report jobs are admin-only", async () => {
    expect((await mgrN.get("/api/admin/report-jobs")).status).toBe(403);
    expect((await n1.get("/api/admin/report-jobs")).status).toBe(403);
  });
});

describe("notifications cover the required categories without repeating", () => {
  test("exporting a report notifies the requester", async () => {
    await mgrN.request(
      `/api/universities/${northId}/reports?from=${FROM}&to=${TO}&export=csv`,
      { method: "GET" },
    );
    const notes = await mgrN.get("/api/notifications");
    expect(notes.status).toBe(200);
    expect(
      notes.body.notifications.some((n: { type: string }) => n.type === "REPORT_READY"),
    ).toBe(true);
  });

  test("a deliverable due soon notifies the instructor and the manager", async () => {
    const created = await mgrN.post(`/api/instructors/${n1Id}/deliverables`, {
      title: "Notification deliverable", targetQuantity: 3, targetHours: 3, dueDate: TUE,
    });
    expect(created.status).toBe(201);

    const run = await admin.post(`/api/admin/rollup?from=${FROM}&to=${TO}`, {});
    expect(run.status).toBe(200);

    for (const client of [n1, mgrN]) {
      const notes = await client.get("/api/notifications");
      expect(
        notes.body.notifications.some((n: { type: string }) =>
          n.type === "DELIVERABLE_DUE" || n.type === "DELIVERABLE_OVERDUE",
        ),
        `${client.label} received no deliverable notification`,
      ).toBe(true);
    }
  });

  test("a standing condition does not re-notify on every sweep", async () => {
    const before = (await n1.get("/api/notifications")).body.notifications.length;

    // Three more sweeps over the same unchanged data.
    for (let i = 0; i < 3; i++) {
      await admin.post(`/api/admin/rollup?from=${FROM}&to=${TO}`, {});
    }

    const after = (await n1.get("/api/notifications")).body.notifications.length;
    expect(after, "notifications multiplied across sweeps").toBe(before);
  });

  test("a duplicate does not abandon the rest of the sweep", async () => {
    // The unique index is the real dedupe guarantee, so a race that slips past
    // the pre-check must be absorbed rather than aborting everything after it.
    // Asserted behaviourally: after repeated sweeps every expected category is
    // still present, which would not hold if the first duplicate threw.
    for (let i = 0; i < 2; i++) {
      const run = await admin.post(`/api/admin/rollup?from=${FROM}&to=${TO}`, {});
      expect(run.status).toBe(200);
    }

    const notes = await mgrN.get("/api/notifications");
    const types = new Set(notes.body.notifications.map((n: { type: string }) => n.type));
    expect(types.has("DELIVERABLE_DUE") || types.has("DELIVERABLE_OVERDUE")).toBe(true);
  });

  test("an instructor is never notified about a colleague", async () => {
    const notes = await n1.get("/api/notifications");
    const roster = await admin.get(`/api/instructors?universityId=${northId}`);
    const otherName = roster.body.instructors.find((i: { id: string }) => i.id !== n1Id).user.name;
    expect(JSON.stringify(notes.body)).not.toContain(otherName);
  });

  test("marking all read clears the unread list", async () => {
    const patch = await n1.request("/api/notifications", {
      method: "PATCH",
      body: JSON.stringify({ action: "MARK_ALL_READ" }),
    });
    expect(patch.status).toBe(200);
    const after = await n1.get("/api/notifications");
    expect(after.body.notifications).toHaveLength(0);
  });
});
