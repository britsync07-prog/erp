import { NextResponse } from "next/server";
import { db } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness/readiness probe used by the Docker healthcheck and by any external
 * uptime monitor. Deliberately unauthenticated and free of secrets: it reveals
 * only whether the process and its database are alive.
 */
export async function GET() {
  const startedAt = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json(
      { status: "ok", database: "reachable", latencyMs: Date.now() - startedAt },
      { status: 200 },
    );
  } catch {
    return NextResponse.json(
      { status: "degraded", database: "unreachable" },
      { status: 503 },
    );
  }
}