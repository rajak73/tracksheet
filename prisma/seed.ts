import { config as loadEnv } from "dotenv";
loadEnv({ path: process.env.TEST_ENV ? ".env.test" : ".env", quiet: true });

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { hashPassword } from "../src/server/auth/password";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

/**
 * Two universities with DIFFERENT timezones and DIFFERENT working hours.
 * That difference is load-bearing: Phase 2's gate requires proving that two
 * universities produce different opening/closing windows simultaneously, which
 * is only meaningful if the seed data actually differs.
 */
const UNIVERSITIES = [
  {
    code: "UNIV001",
    slug: "northfield",
    name: "Northfield University",
    timezone: "Asia/Kolkata",
    openingDurationMin: 15,
    closingDurationMin: 15,
    breakDurationMin: 60,
    // Mon-Fri 09:00-18:00 local
    hours: { workingDays: [1, 2, 3, 4, 5], startMinute: 9 * 60, endMinute: 18 * 60 },
    manager: { email: "manager.north@example.edu", name: "Priya Raman" },
    instructors: [
      { email: "inst.north1@example.edu", name: "Arun Verma", employeeCode: "NF-001" },
      { email: "inst.north2@example.edu", name: "Sara Khan", employeeCode: "NF-002" },
    ],
  },
  {
    code: "UNIV002",
    slug: "westbrook",
    name: "Westbrook Institute",
    timezone: "America/New_York",
    openingDurationMin: 20,
    closingDurationMin: 10,
    breakDurationMin: 30,
    // Mon-Sat 08:30-16:30 local — different days, hours, and durations
    hours: { workingDays: [1, 2, 3, 4, 5, 6], startMinute: 8 * 60 + 30, endMinute: 16 * 60 + 30 },
    manager: { email: "manager.west@example.edu", name: "Daniel Okoro" },
    instructors: [
      { email: "inst.west1@example.edu", name: "Mei Lin", employeeCode: "WB-001" },
      { email: "inst.west2@example.edu", name: "Tomas Alvarez", employeeCode: "WB-002" },
    ],
  },
];

/**
 * The activity taxonomy. Seeded as DATA so a new type is an insert, not a
 * migration. Downstream logic keys off the behavioural flags, never the code.
 *
 * MISSING_DATA is deliberately absent: it is the absence of any record over a
 * window the university expected to be covered, so it is computed, never stored
 * (Phase 0 §3.5). Adding it here would let "we don't know" be written down as
 * if it were an observation.
 */
const ACTIVITY_TYPES = [
  {
    code: "DAILY_OPENING",
    label: "Daily Opening",
    description: "Once-per-working-day opening routine, derived from the university's hours.",
    sortOrder: 10,
    isOncePerDay: true,
    isDerivedFromWorkingHours: true,
  },
  { code: "TEACHING", label: "Teaching", sortOrder: 20 },
  { code: "LEARNING", label: "Learning", sortOrder: 30 },
  { code: "STUDENT_SUPPORT", label: "Student Support", sortOrder: 40 },
  { code: "ADMINISTRATIVE", label: "Administrative", sortOrder: 50 },
  { code: "MEETING", label: "Meeting", sortOrder: 60 },
  { code: "DELIVERABLE", label: "Deliverable Work", sortOrder: 70 },
  { code: "RESEARCH", label: "Research", sortOrder: 80 },
  { code: "OTHER", label: "Other", sortOrder: 90 },
  {
    code: "DAILY_CLOSING",
    label: "Daily Closing",
    description: "Once-per-working-day closing routine, derived from the university's hours.",
    sortOrder: 100,
    isOncePerDay: true,
    isDerivedFromWorkingHours: true,
  },
  {
    code: "UNUTILIZED",
    label: "Unutilized Time",
    description: "Known idle time. Distinct from missing data, which is never recorded.",
    sortOrder: 110,
    countsAsProductive: false,
    isUnutilized: true,
  },
] satisfies Array<{
  code: string;
  label: string;
  description?: string;
  sortOrder: number;
  isOncePerDay?: boolean;
  isDerivedFromWorkingHours?: boolean;
  countsAsProductive?: boolean;
  isUnutilized?: boolean;
}>;

const DEV_PASSWORD = "Password123!";

async function main() {
  console.log("Seeding…");

  // Strict dependency order. Several tables reference University with
  // onDelete: Restrict, so anything holding a universityId must go first —
  // otherwise reseeding works on an empty database and fails on a populated
  // one, which is exactly the case a test harness hits on its second run.
  await prisma.session.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.aiInsight.deleteMany();
  await prisma.deliverableLog.deleteMany();
  await prisma.deliverable.deleteMany();
  await prisma.activityLog.deleteMany();
  await prisma.leaveRequest.deleteMany();

  await prisma.university.updateMany({ data: { primaryManagerId: null } });
  await prisma.instructor.deleteMany();
  await prisma.manager.deleteMany();
  await prisma.user.deleteMany();
  await prisma.universityWorkingHours.deleteMany();
  await prisma.universityHoliday.deleteMany();
  await prisma.university.deleteMany();

  // Upserted rather than deleted-and-recreated: activity types are referenced
  // by historical activity records from Phase 3 onward, so reseeding must not
  // change their ids.
  for (const type of ACTIVITY_TYPES) {
    const data = {
      label: type.label,
      description: type.description ?? null,
      sortOrder: type.sortOrder,
      isSystem: true,
      isOncePerDay: type.isOncePerDay ?? false,
      isDerivedFromWorkingHours: type.isDerivedFromWorkingHours ?? false,
      countsAsProductive: type.countsAsProductive ?? true,
      isUnutilized: type.isUnutilized ?? false,
    };
    await prisma.activityType.upsert({
      where: { code: type.code },
      create: { code: type.code, ...data },
      update: data,
    });
  }
  console.log(`  activity types: ${ACTIVITY_TYPES.length}`);

  const passwordHash = await hashPassword(DEV_PASSWORD);

  const admin = await prisma.user.create({
    data: {
      email: "admin@example.edu",
      name: "Global Admin",
      role: "ADMIN",
      passwordHash,
      universityId: null, // required for ADMIN by the CHECK constraint
    },
  });
  console.log(`  admin: ${admin.email}`);

  for (const spec of UNIVERSITIES) {
    const university = await prisma.university.create({
      data: {
        code: spec.code,
        slug: spec.slug,
        name: spec.name,
        timezone: spec.timezone,
        openingDurationMin: spec.openingDurationMin,
        closingDurationMin: spec.closingDurationMin,
        breakDurationMin: spec.breakDurationMin,
        workingHours: {
          create: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => {
            const isWorkingDay = spec.hours.workingDays.includes(dayOfWeek);
            return {
              dayOfWeek,
              isWorkingDay,
              // Non-working days still need a well-formed window to satisfy the
              // working_hours_valid_window CHECK; isWorkingDay is what counts.
              startMinute: isWorkingDay ? spec.hours.startMinute : 0,
              endMinute: isWorkingDay ? spec.hours.endMinute : 1,
            };
          }),
        },
      },
    });

    const managerUser = await prisma.user.create({
      data: {
        email: spec.manager.email,
        name: spec.manager.name,
        role: "MANAGER",
        passwordHash,
        universityId: university.id,
      },
    });

    const manager = await prisma.manager.create({
      data: { userId: managerUser.id, universityId: university.id, employeeCode: "MGR-01" },
    });

    await prisma.university.update({
      where: { id: university.id },
      data: { primaryManagerId: manager.id },
    });

    for (const inst of spec.instructors) {
      const instUser = await prisma.user.create({
        data: {
          email: inst.email,
          name: inst.name,
          role: "INSTRUCTOR",
          passwordHash,
          universityId: university.id,
        },
      });
      await prisma.instructor.create({
        data: {
          userId: instUser.id,
          universityId: university.id,
          employeeCode: inst.employeeCode,
        },
      });
    }

    console.log(
      `  ${spec.name} (${spec.timezone}) — 1 manager, ${spec.instructors.length} instructors`,
    );
  }

  console.log(`\nAll seeded accounts use password: ${DEV_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
