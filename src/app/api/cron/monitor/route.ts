import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { runMonitor } from "@/server/ai/automation";

export const runtime = "nodejs";

/** Server-to-server automation monitors. Guarded by CRON_SECRET (see docs/AI.md). */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const secret = params.get("secret") ?? "";
  const orgId = params.get("org") ?? "";
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const org = await db.organisation.findUnique({ where: { id: orgId } });
  if (!org) return NextResponse.json({ error: "Unknown organisation." }, { status: 404 });
  const result = await runMonitor(orgId, db, "scheduler");
  return NextResponse.json({ ok: true, ...result });
}
