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
    slug: "northfield",
    name: "Northfield University",
    timezone: "Asia/Kolkata",
    openingDurationMin: 15,
    closingDurationMin: 15,
    // Mon-Fri 09:00-18:00 local
    hours: { workingDays: [1, 2, 3, 4, 5], startMinute: 9 * 60, endMinute: 18 * 60 },
    manager: { email: "manager.north@example.edu", name: "Priya Raman" },
    instructors: [
      { email: "inst.north1@example.edu", name: "Arun Verma", employeeCode: "NF-001" },
      { email: "inst.north2@example.edu", name: "Sara Khan", employeeCode: "NF-002" },
    ],
  },
  {
    slug: "westbrook",
    name: "Westbrook Institute",
    timezone: "America/New_York",
    openingDurationMin: 20,
    closingDurationMin: 10,
    // Mon-Sat 08:30-16:30 local — different days, hours, and durations
    hours: { workingDays: [1, 2, 3, 4, 5, 6], startMinute: 8 * 60 + 30, endMinute: 16 * 60 + 30 },
    manager: { email: "manager.west@example.edu", name: "Daniel Okoro" },
    instructors: [
      { email: "inst.west1@example.edu", name: "Mei Lin", employeeCode: "WB-001" },
      { email: "inst.west2@example.edu", name: "Tomas Alvarez", employeeCode: "WB-002" },
    ],
  },
];

const DEV_PASSWORD = "Password123!";

async function main() {
  console.log("Seeding…");

  // Order matters: profiles hold FKs back to users and universities.
  await prisma.session.deleteMany();
  await prisma.university.updateMany({ data: { primaryManagerId: null } });
  await prisma.instructor.deleteMany();
  await prisma.manager.deleteMany();
  await prisma.user.deleteMany();
  await prisma.universityWorkingHours.deleteMany();
  await prisma.universityHoliday.deleteMany();
  await prisma.university.deleteMany();

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
        slug: spec.slug,
        name: spec.name,
        timezone: spec.timezone,
        openingDurationMin: spec.openingDurationMin,
        closingDurationMin: spec.closingDurationMin,
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
