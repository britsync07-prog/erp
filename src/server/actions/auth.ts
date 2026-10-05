"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { db } from "@/server/db";
import { assertPasswordAcceptable, hashPassword, verifyPassword } from "@/server/auth/password";
import { createSession, destroySession, getSession, invalidateSession } from "@/server/auth/session";
import { loginLimiter, ipLimiter, sleep } from "@/server/auth/rateLimit";
import { audit, fail, friendlyError, type ActionResult } from "@/server/platform";
import type { Permission } from "@/domain/constants";

/** Best-effort client IP from proxy headers set by the VPS reverse proxy. */
async function clientIp(): Promise<string> {
  try {
    const h = await headers();
    const fwd = h.get("x-forwarded-for");
    if (fwd) return fwd.split(",")[0]!.trim();
    return h.get("x-real-ip") ?? "unknown";
  } catch {
    return "unknown";
  }
}

export async function login(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return fail("Please enter your email and password.");

  const limiter = loginLimiter();
  const perIp = ipLimiter();
  const ip = await clientIp();
  if (!limiter.allow(`${ip}|${email}`) || !perIp.allow(ip)) {
    await sleep(400);
    return fail("Too many failed sign-in attempts. Please wait a few minutes and try again.");
  }

  const user = await db.user.findFirst({ where: { email, isActive: true }, include: { role: true } });
  const ok = user ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !ok) {
    limiter.record(`${ip}|${email}`);
    perIp.record(ip);
    await audit({
      orgId: user?.organisationId ?? "unknown",
      action: "LOGIN_FAILED",
      entityType: "USER",
      entityId: user?.id ?? email,
      actor: { id: user?.id ?? "anonymous", name: email },
      source: "SECURITY",
    });
    // Uniform message: never reveal whether the address exists.
    return fail("Invalid email or password.");
  }

  limiter.reset(`${ip}|${email}`);
  perIp.reset(ip);
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await createSession({
    id: user.id,
    orgId: user.organisationId,
    name: user.name,
    email: user.email,
    roleCode: user.role.code,
    permissions: user.role.permissions as unknown as Permission[],
    mustChangePassword: user.mustChangePassword,
    roleId: user.roleId,
  });
  await audit({
    orgId: user.organisationId,
    action: "LOGIN",
    entityType: "USER",
    entityId: user.id,
    actor: { id: user.id, name: user.name },
    source: "USER",
  });
  redirect(user.mustChangePassword ? "/account/password" : "/");
}

/**
 * Self-service password change. Works for every signed-in user, so an
 * admin-issued temporary password can be rotated by its owner.
 */
export async function changePasswordAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return fail("You are not signed in.");
  const current = String(formData.get("currentPassword") ?? "");
  const next = String(formData.get("newPassword") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");
  if (!current) return fail("Please enter your current password.");
  if (next !== confirm) return fail("The new passwords do not match.");
  if (next === current) return fail("The new password must be different from your current one.");

  try {
    assertPasswordAcceptable(next);
    const user = await db.user.findUnique({ where: { id: session.id }, include: { role: true } });
    if (!user) return fail("Your account could not be found. Please sign in again.");
    if (!(await verifyPassword(current, user.passwordHash))) {
      return fail("Your current password is not correct.");
    }
    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(next), mustChangePassword: false },
    });
    // Re-issue the session so mustChangePassword clears immediately.
    await createSession({
      id: user.id,
      orgId: user.organisationId,
      name: user.name,
      email: user.email,
      roleCode: user.role.code,
      permissions: user.role.permissions as unknown as Permission[],
      mustChangePassword: false,
      roleId: user.roleId,
    });
    await audit({
      orgId: user.organisationId,
      action: "PASSWORD_CHANGED",
      entityType: "USER",
      entityId: user.id,
      actor: { id: user.id, name: user.name },
      source: "USER",
    });
    // New token issued; drop any stale cached revalidation.
    invalidateSession(user.id);
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}
