/**
 * Operator command: install the reference data the application cannot run
 * without.
 *
 *   npm run db:reference-data
 *
 * Safe for production, and safe to run again. It upserts the canonical
 * `ActivityType` rows on their natural key and deletes nothing — no
 * `deleteMany`, no truncate, no reset. Rows it does not define are untouched,
 * and rows that already exist keep their ids, so historical `ActivityLog`
 * records go on pointing at the same types.
 *
 * This is NOT `prisma db seed`. The seed wipes fourteen tables and installs
 * development accounts; it must never run against production. This command
 * exists precisely so that production never needs it.
 *
 * Run it against whatever `DATABASE_URL` is set, after `prisma migrate deploy`
 * and before the application serves traffic.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: process.env.TEST_ENV ? ".env.test" : ".env", quiet: true });

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  ACTIVITY_TYPE_COUNT,
  DELIVERABLE_TYPE_COUNT,
  provisionActivityTypes,
  provisionDeliverableTypes,
  provisionInstructorCategories,
  INSTRUCTOR_CATEGORY_COUNT,
} from "../prisma/reference-data";

function fail(message: string): never {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    fail("DATABASE_URL is not set. Set it to the target database and run again.");
  }

  // Show WHICH database is about to be written to, without printing credentials.
  let target = "(unparseable)";
  try {
    const u = new URL(connectionString);
    target = `${u.hostname}:${u.port || "5432"}${u.pathname}`;
  } catch {
    /* leave as unparseable — the connection itself will fail informatively */
  }
  console.log(`\nTarget database: ${target}`);

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const { created, updated } = await provisionActivityTypes(prisma);
    const total = await prisma.activityType.count();

    console.log(`✔ Activity types provisioned.\n`);
    console.log(`  created:   ${created.length}${created.length ? ` (${created.join(", ")})` : ""}`);
    console.log(`  unchanged: ${updated.length}`);
    console.log(`  in database: ${total}\n`);

    if (total < ACTIVITY_TYPE_COUNT) {
      fail(`Expected at least ${ACTIVITY_TYPE_COUNT} activity types, found ${total}.`);
    }

    // Second, and only after the categories exist: every deliverable points at
    // one, and the foreign key refuses an orphan.
    const deliverables = await provisionDeliverableTypes(prisma);
    const deliverableTotal = await prisma.deliverableType.count();

    console.log(`✔ Deliverable types provisioned.\n`);
    console.log(
      `  created:   ${deliverables.created.length}${
        deliverables.created.length ? ` (${deliverables.created.length} codes)` : ""
      }`,
    );
    console.log(`  unchanged: ${deliverables.updated.length}`);
    console.log(`  in database: ${deliverableTotal}\n`);

    // Third, and independent of the two above: what an instructor TEACHES.
    // It references nothing, so its order does not matter — it is provisioned
    // here so one command still leaves the database fully seeded.
    const categories = await provisionInstructorCategories(prisma);
    const categoryTotal = await prisma.instructorCategory.count();

    console.log(`✔ Instructor categories provisioned.\n`);
    console.log(`  created:   ${categories.created.length}`);
    console.log(`  unchanged: ${categories.updated.length}`);
    console.log(`  in database: ${categoryTotal}\n`);

    if (categoryTotal < INSTRUCTOR_CATEGORY_COUNT) {
      fail(`Expected at least ${INSTRUCTOR_CATEGORY_COUNT} instructor categories, found ${categoryTotal}.`);
    }

    if (deliverableTotal < DELIVERABLE_TYPE_COUNT) {
      fail(`Expected at least ${DELIVERABLE_TYPE_COUNT} deliverable types, found ${deliverableTotal}.`);
    }

    console.log("Nothing was deleted. Safe to run again at any time.\n");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  fail(e instanceof Error ? e.message : "Reference-data provisioning failed.");
});
