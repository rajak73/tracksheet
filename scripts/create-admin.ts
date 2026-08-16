/**
 * One-off operator command: create the first ADMIN on a fresh database.
 *
 *   npm run admin:create -- --email you@org.com --name "Your Name"
 *
 * The password is prompted for with echo suppressed, so it never reaches shell
 * history, `ps` output, CI logs, or a process listing. It is held in memory
 * only long enough to hash.
 *
 * Runs against whatever `DATABASE_URL` is set — point it at production
 * deliberately and once. It is not imported by the application and has no
 * effect on startup.
 *
 * Refuses if the database already has any ADMIN. Deletes nothing, ever.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: process.env.TEST_ENV ? ".env.test" : ".env", quiet: true });

import { createInterface } from "node:readline";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { bootstrapAdmin, MIN_PASSWORD_LENGTH } from "../src/server/users/bootstrap-admin";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

/** Reads a line with echo suppressed. Nothing is written to the terminal. */
function promptSecret(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    const output = process.stdout;
    if (!input.isTTY) {
      reject(
        new Error(
          "A terminal is required so the password can be typed without being echoed.\n" +
            "Run this interactively rather than piping input.",
        ),
      );
      return;
    }

    const rl = createInterface({ input, output, terminal: true });
    // Suppress echo: the muted writer swallows everything after the prompt.
    let muted = false;
    const realWrite = output.write.bind(output);
    // Deliberately swapping the stream writer while muted.
    output.write = (chunk: string | Uint8Array, ...rest: unknown[]) =>
      muted ? true : realWrite(chunk as string, ...(rest as []));

    output.write(question);
    muted = true;

    rl.question("", (answer) => {
      muted = false;
      // Restore the original writer.
      output.write = realWrite;
      output.write("\n");
      rl.close();
      resolve(answer);
    });
    rl.on("error", (e) => {
      muted = false;
      // Restore the original writer.
      output.write = realWrite;
      reject(e);
    });
  });
}

function fail(message: string): never {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

async function main() {
  const email = arg("--email");
  const name = arg("--name");

  if (!email || !name) {
    fail(
      'Usage: npm run admin:create -- --email you@org.com --name "Your Name"\n' +
        "  Both --email and --name are required. The password is prompted for.",
    );
  }

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
  console.log(`Creating ADMIN:  ${name} <${email}>\n`);

  const password = await promptSecret(`Password (min ${MIN_PASSWORD_LENGTH} chars, not echoed): `);
  const confirm = await promptSecret("Confirm password: ");

  if (password !== confirm) fail("The two passwords do not match. Nothing was written.");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const result = await bootstrapAdmin(prisma, { email, name, password });
    if (!result.ok) fail(result.message);

    console.log(`✔ Administrator created.\n`);
    console.log(`  id:    ${result.id}`);
    console.log(`  name:  ${result.name}`);
    console.log(`  email: ${result.email}\n`);
    console.log("Sign in with the password you just entered. It was not stored or logged.\n");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  // Deliberately prints the message only — never the input that produced it.
  fail(e instanceof Error ? e.message : "Bootstrap failed.");
});
