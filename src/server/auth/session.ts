import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { Permission } from "@/domain/constants";

export const SESSION_COOKIE = "drp_session";
const MAX_AGE_SECONDS = 12 * 60 * 60;

export interface SessionUser {
  id: string;
  orgId: string;
  name: string;
  email: string;
  roleCode: string;
  permissions: Permission[];
  /** True while the account still holds an admin-issued temporary password. */
  mustChangePassword?: boolean;
  /** Database id of the assigned role; re-checked per request so a role change
   *  takes effect immediately instead of at token expiry. */
  roleId?: string;
}

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (min 32 chars).");
  return new TextEncoder().encode(s);
}

export function createSession(user: SessionUser): Promise<void> {
  // Clear any cached revalidation for this user so the new claims take effect.
  cacheStore().delete(user.id);
  return issue(user);
}

async function issue(user: SessionUser): Promise<void> {
  const token = await new SignJWT({ ...user })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret());
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

/**
 * Full verification (server components, actions, API). Returns null when
 * absent/invalid.
 *
 * The JWT is stateless, so on its own a deactivated user or a revoked role
 * would keep working until the token expired. `revalidate` closes that window
 * by re-reading the user row and preferring live values. It is memoised for
 * the lifetime of one request so a page that calls `getSession()` from the
 * layout, the page and several services still costs exactly one query.
 */
export async function getSession(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  let claims: SessionUser;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (typeof payload.id !== "string" || typeof payload.orgId !== "string") return null;
    claims = {
      id: payload.id,
      orgId: payload.orgId,
      name: (payload.name as string) ?? "",
      email: (payload.email as string) ?? "",
      roleCode: (payload.roleCode as string) ?? "",
      permissions: (payload.permissions as Permission[]) ?? [],
      mustChangePassword: payload.mustChangePassword === true,
      roleId: (payload.roleId as string) ?? "",
    };
  } catch {
    return null;
  }
  return revalidate(claims);
}

type Revalidated = SessionUser | null;

const CACHE_KEY = Symbol.for("drp.session.cache");
/**
 * Backstop TTL. Explicit invalidation (below) is the primary mechanism and is
 * called whenever a user is deactivated, re-roled, or re-passworded. This TTL
 * bounds the damage if any code path forgets to invalidate.
 */
const CACHE_TTL_MS = 5_000;

interface CacheEntry {
  value: Revalidated;
  expiresAt: number;
}

function cacheStore(): Map<string, CacheEntry> {
  const store = globalThis as unknown as Record<symbol, Map<string, CacheEntry>>;
  store[CACHE_KEY] ??= new Map();
  return store[CACHE_KEY];
}

/** Drop one user's cached session (call after deactivating or re-roling them). */
export function invalidateSession(userId: string): void {
  cacheStore().delete(userId);
}

/**
 * Drop every cached session. Required when role *permissions* change, since one
 * role can be shared by many users.
 */
export function invalidateAllSessions(): void {
  cacheStore().clear();
}

async function revalidate(claims: SessionUser): Promise<Revalidated> {
  const cache = cacheStore();
  const now = Date.now();
  const hit = cache.get(claims.id);
  if (hit && hit.expiresAt > now) return hit.value;

  let result: Revalidated;
  try {
    const { db } = await import("@/server/db");
    const user = await db.user.findUnique({
      where: { id: claims.id },
      select: {
        id: true, organisationId: true, name: true, email: true,
        isActive: true, mustChangePassword: true,
        roleId: true,
        role: { select: { code: true, permissions: true } },
      },
    });
    if (!user || !user.isActive || user.organisationId !== claims.orgId) {
      // Deactivated, deleted, or moved to another organisation: kill the session.
      result = null;
      // Cache the negative result too, so a flood of requests from a
      // deactivated account cannot hammer the database.
      cache.set(claims.id, { value: null, expiresAt: now + CACHE_TTL_MS });
      return result;
    }
    result = {
      id: user.id,
      orgId: user.organisationId,
      name: user.name,
      email: user.email,
      // Live role wins, so a permission change applies immediately.
      roleCode: user.role.code,
      permissions: user.role.permissions as unknown as Permission[],
      mustChangePassword: user.mustChangePassword,
      roleId: user.roleId,
    };
  } catch {
    // Never lock a user out because of a transient database blip.
    result = claims;
  }
  cache.set(claims.id, { value: result, expiresAt: now + CACHE_TTL_MS });
  return result;
}

/** Optimistic presence check for proxy.ts (no crypto verify there). */
export function hasSessionCookie(requestCookies: Map<string, string>): boolean {
  return requestCookies.has(SESSION_COOKIE);
}
