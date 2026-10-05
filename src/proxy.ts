import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/server/auth/session";

// Optimistic auth gate (Next.js 16 proxy). Full session verification happens in
// layouts/actions/services via the DAL — proxy only checks cookie presence.
export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has(SESSION_COOKIE);
  const { pathname } = request.nextUrl;

  if (!hasSession && pathname !== "/login") {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (hasSession && pathname === "/login") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // An account still holding an admin-issued temporary password may only reach
  // the change-password page and sign-out. The JWT carries the flag, so this
  // needs no database round trip.
  if (hasSession && request.cookies.get(SESSION_COOKIE)?.value.includes(RESET_FLAG)) {
    const allowed =
      pathname.startsWith("/account/password") ||
      pathname.startsWith("/_next") ||
      pathname === "/favicon.ico";
    if (!allowed) {
      return NextResponse.redirect(new URL("/account/password", request.url));
    }
  }
  return NextResponse.next();
}

/**
 * Marker searched for in the raw cookie value. The session payload is a
 * base64url JWT, so the flag appears verbatim as `"mustChangePassword":true`.
 */
const RESET_FLAG = '"mustChangePassword":true';

export const config = {
  // Exempt, each for its own auth model:
  //   api/auth   — session lifecycle endpoints
  //   api/cron   — CRON_SECRET (server-to-server, no session)
  //   api/health — unauthenticated liveness probe for the container/monitor
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/auth|api/cron|api/health).*)",
  ],
};