import { NextResponse } from "next/server";
import { prisma } from "@/server/db";

/**
 * Health check for Render's instance monitoring.
 *
 * Deliberately unauthenticated — Render probes it without credentials — and
 * deliberately minimal: it reports whether the process can reach its database
 * and nothing about the data. A health endpoint that leaks counts or tenant
 * names is an unauthenticated information disclosure.
 *
 * It DOES touch the database rather than returning a static "ok": a process
 * that is running but cannot reach Postgres is not healthy, and reporting it as
 * healthy is how an outage stays invisible.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", database: "reachable" });
  } catch {
    // No error detail: this endpoint is public, and connection strings and
    // driver messages have a habit of appearing in them.
    return NextResponse.json({ status: "degraded", database: "unreachable" }, { status: 503 });
  }
}
