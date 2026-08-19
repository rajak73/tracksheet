import { config as dotenv } from "dotenv";
dotenv({ path: ".env", quiet: true });
const { prisma } = await import("@/server/db");
const { loadUniversityConfig } = await import("@/server/universities/config");
const { verifyEntry, todayFor } = await import("@/server/worklog/window");

const uni = await prisma.university.findFirstOrThrow({ where: { slug: "northfield" }, select: { id: true, name: true, timezone: true } });
const cfg = await loadUniversityConfig(uni.id);
const today = todayFor(cfg);
console.log(`${uni.name}  tz=${uni.timezone}  today=${today}`);
const { computeDayWindows } = await import("@/server/time/schedule-windows");
const w = computeDayWindows(cfg, today);
console.log(`working hours: ${w.workingHours ? `${w.workingHours.startLocal}–${w.workingHours.endLocal}` : "non-working day"}\n`);

// The app's own resolver: a local wall-clock time on `today`, in the
// university's zone, DST-correct — the same function logActivity uses.
const { zonedToUtc } = await import("@/server/time/workday");
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return zonedToUtc(today, h * 60 + m, cfg.timezone);
};
const mins = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
const act = (a: string, b: string) => [{ startMinute: mins(a), endMinute: mins(b) }];

const cases: Array<[string, Parameters<typeof verifyEntry>[0]]> = [
  ["aaj, 11:00 pe submit, activity 10-11:30", { config: cfg, workDate: today, now: at("11:00"), activityWindows: act("10:00","11:30") }],
  ["kal ki date (backdated)",                  { config: cfg, workDate: "2026-01-05", now: at("11:00"), activityWindows: act("10:00","11:30") }],
  ["future date",                              { config: cfg, workDate: "2099-01-05", now: at("11:00"), activityWindows: act("10:00","11:30") }],
  ["aaj, 21:00 pe submit (hours ke baad)",     { config: cfg, workDate: today, now: at("21:00"), activityWindows: act("10:00","11:30") }],
  ["aaj, 11:00 submit, activity 20:00-22:00",  { config: cfg, workDate: today, now: at("11:00"), activityWindows: act("20:00","22:00") }],
  ["aaj, 21:00 submit + activity 20-22 (dono)",{ config: cfg, workDate: today, now: at("21:00"), activityWindows: act("20:00","22:00") }],
];
for (const [label, input] of cases) {
  const v = verifyEntry(input);
  const tag = v.kind === "allowed" ? "✅ ALLOWED" : v.kind === "blocked" ? "⛔ BLOCKED" : `⚠️  REQUEST (${v.reason})`;
  console.log(`  ${tag.padEnd(28)} ${label}`);
  if (v.kind !== "allowed") console.log(`       → "${v.message}"`);
}
await prisma.$disconnect();
