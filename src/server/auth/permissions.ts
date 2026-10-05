import "server-only";
import { redirect } from "next/navigation";
import type { Permission } from "@/domain/constants";
import { hasPermission } from "@/domain/constants";
import { getSession, type SessionUser } from "./session";

export { hasPermission };
export class AuthError extends Error {}
export class ForbiddenError extends Error {}

/** Pages/layouts: redirect to /login when unauthenticated. */
export async function requireSession(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/** Pages: redirect home when the user lacks permission (no technical leak). */
export async function requirePermission(perm: Permission): Promise<SessionUser> {
  const session = await requireSession();
  if (!hasPermission(session, perm)) redirect("/");
  return session;
}

/** Services/actions: throw typed errors; callers map them to friendly messages. */
export async function assertPermission(perm: Permission): Promise<SessionUser> {
  const session = await getSession();
  if (!session) throw new AuthError("You are not signed in.");
  if (!hasPermission(session, perm)) throw new ForbiddenError("You do not have permission for this action.");
  return session;
}

/** Pass when the user holds ANY of the listed permissions. */
export async function assertAnyPermission(perms: Permission[]): Promise<SessionUser> {
  const session = await getSession();
  if (!session) throw new AuthError("You are not signed in.");
  if (!perms.some((p) => hasPermission(session, p))) {
    throw new ForbiddenError("You do not have permission for this action.");
  }
  return session;
}
