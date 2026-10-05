import { NextResponse } from "next/server";
import { getSession } from "@/server/auth/session";
import { searchAll } from "@/server/services/platformRead";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const q = new URL(request.url).searchParams.get("q") ?? "";
  const hits = await searchAll(session.orgId, q);
  return NextResponse.json({ hits });
}
