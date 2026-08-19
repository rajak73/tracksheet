import { config } from "dotenv";
config({ path: ".env", quiet: true });
const { prisma } = await import("@/server/db");
const { submitWorklog, runParse } = await import("@/server/worklog/service");

const DAY = "2043-09-15";
const inst = await prisma.instructor.findFirstOrThrow({
  where: { user: { email: "inst.north1@example.edu" } },
  select: { id: true, universityId: true, user: { select: { id: true, name: true } } },
});

// A clean slate for this throwaway date.
await prisma.activityLog.deleteMany({ where: { instructorId: inst.id, workDate: new Date(`${DAY}T00:00:00.000Z`) } });
await prisma.worklogSubmission.deleteMany({ where: { instructorId: inst.id, workDate: new Date(`${DAY}T00:00:00.000Z`) } });

const bullets = [
  "took DSA lec 10:00 AM to 11:30 AM",
  "lab session for unit 3 from 11:30 to 1",
  "checked 40 answer sheets 2pm-4pm",
  "took another lecture on trees, 5 to 6",
  "made slides for unit 2, 1.5 hrs",          // no range → should be rejected, text kept
];

console.log(`instructor: ${inst.user.name}\nday: ${DAY}\n`);
const t0 = Date.now();
const submission = await submitWorklog({
  instructorId: inst.id, universityId: inst.universityId, workDate: DAY, bullets,
});
console.log(`── submit returned in ${Date.now() - t0}ms → status ${submission.status}, ${submission.bulletCount} bullets`);
console.log("   (text already safe; parsing runs behind this)\n");

// The background call is already running; wait for it to settle.
for (let i = 0; i < 90; i++) {
  const s = await prisma.worklogSubmission.findUniqueOrThrow({ where: { id: submission.id }, select: { status: true } });
  if (s.status !== "PENDING") break;
  await new Promise((r) => setTimeout(r, 2000));
}

const done = await prisma.worklogSubmission.findUniqueOrThrow({
  where: { id: submission.id },
  select: { status: true, parsedAt: true, parseError: true, rawBullets: true, submittedAt: true },
});
console.log(`── submission is now ${done.status} (parsed ${done.parsedAt ? "yes" : "no"})`);
console.log(`   raw text still stored: ${JSON.stringify(done.rawBullets).slice(0, 90)}…\n`);

const rows = await prisma.activityLog.findMany({
  where: { submissionId: submission.id },
  orderBy: { startTime: "asc" },
  select: {
    startTime: true, endTime: true, quantity: true, rawText: true,
    activityType: { select: { label: true } },
    deliverableType: { select: { label: true } },
  },
});
console.log(`── ${rows.length} ActivityLog rows written`);
for (const r of rows) {
  console.log(`   ${r.startTime.toISOString().slice(11,16)}-${r.endTime.toISOString().slice(11,16)}Z  ` +
    `${r.activityType.label} / ${r.deliverableType?.label ?? "—"}  qty ${r.quantity}`);
  console.log(`        raw: "${r.rawText}"`);
}
const notif = await prisma.notification.findFirst({
  where: { userId: inst.user.id, type: "WORKLOG_PARSED" }, orderBy: { createdAt: "desc" },
  select: { title: true },
});
console.log(`\n── notification: ${notif ? `"${notif.title}"` : "none"}`);
await prisma.$disconnect();
