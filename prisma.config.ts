import { config as loadEnv } from "dotenv";
import { defineConfig, env } from "prisma/config";

// Prisma 7 does not read .env automatically. TEST_ENV lets the test harness
// point every prisma CLI invocation at the throwaway test database.
loadEnv({ path: process.env.TEST_ENV ? ".env.test" : ".env", quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
    // Needed by `prisma migrate diff --from-migrations`, which is how CI
    // checks that the migrations directory and schema.prisma agree.
    shadowDatabaseUrl:
      process.env.SHADOW_DATABASE_URL ??
      "postgresql://tracksheet:tracksheet@localhost:5434/tracksheet_shadow?schema=public",
  },
});
