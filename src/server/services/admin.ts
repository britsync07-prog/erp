import "server-only";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/server/db";
import { assertPermission } from "@/server/auth/permissions";
import { invalidateAllSessions, invalidateSession } from "@/server/auth/session";
import { assertPasswordAcceptable } from "@/server/auth/password";
import { audit, activity } from "@/server/platform";
import { PERMISSIONS, ROLES, type Permission } from "@/domain/constants";
import type { Actor } from "./util";

const UserSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120),
  email: z.string().trim().min(1, "Email is required.").max(160),
  password: z.string().min(1, "Please enter a temporary password.").max(200),
  roleId: z.string().min(1, "Role is required."),
});

export async function listUsers(orgId: string) {
  await assertPermission("users.manage");
  return db.user.findMany({
    where: { organisationId: orgId },
    orderBy: { name: "asc" },
    include: { role: true },
  });
}

export async function createUser(actor: Actor, raw: unknown) {
  const me = await assertPermission("users.manage");
  const data = UserSchema.parse(raw);
  const role = await db.role.findFirst({ where: { id: data.roleId, organisationId: actor.orgId } });
  if (!role) throw new Error("The selected role was not found.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) throw new Error("Please enter a valid email.");
  // The admin-issued password is a temporary one: it must clear the same
  // policy, and the owner is forced to replace it at first sign-in.
  assertPasswordAcceptable(data.password);
  const user = await db.user.create({
    data: {
      organisationId: actor.orgId,
      roleId: role.id,
      name: data.name,
      email: data.email.toLowerCase(),
      passwordHash: await bcrypt.hash(data.password, 12),
      mustChangePassword: true,
    },
  });
  await audit({ orgId: actor.orgId, action: "CREATE", entityType: "USER", entityId: user.id, newValue: { email: user.email, role: role.code }, actor: me });
  return user.id;
}

/** Admin-initiated password reset for a user who cannot self-serve. */
export async function resetUserPassword(actor: Actor, id: string, raw: unknown) {
  const me = await assertPermission("users.manage");
  const data = z.object({ password: z.string().min(1, "Please enter a temporary password.").max(200) }).parse(raw);
  assertPasswordAcceptable(data.password);
  const user = await db.user.findFirst({ where: { id, organisationId: actor.orgId } });
  if (!user) throw new Error("This user was not found.");
  await db.user.update({
    where: { id },
    data: { passwordHash: await bcrypt.hash(data.password, 12), mustChangePassword: true },
  });
  invalidateSession(id);
  await audit({ orgId: actor.orgId, action: "RESET_PASSWORD", entityType: "USER", entityId: id, actor: me });
  return user.id;
}

export async function setUserActive(actor: Actor, id: string, active: boolean) {
  const me = await assertPermission("users.manage");
  if (id === me.id) throw new Error("You cannot deactivate your own account.");
  const user = await db.user.findFirst({ where: { id, organisationId: actor.orgId } });
  if (!user) throw new Error("This user was not found.");
  await db.user.update({ where: { id }, data: { isActive: active } });
  // Deactivation must bite now, not when the token expires.
  invalidateSession(id);
  await audit({ orgId: actor.orgId, action: active ? "ACTIVATE" : "DEACTIVATE", entityType: "USER", entityId: id, actor: me });
}

export async function setUserRole(actor: Actor, id: string, roleId: string) {
  const me = await assertPermission("users.manage");
  if (id === me.id) throw new Error("You cannot change your own role.");
  const [user, role] = await Promise.all([
    db.user.findFirst({ where: { id, organisationId: actor.orgId } }),
    db.role.findFirst({ where: { id: roleId, organisationId: actor.orgId } }),
  ]);
  if (!user) throw new Error("This user was not found.");
  if (!role) throw new Error("The selected role was not found.");
  await db.user.update({ where: { id }, data: { roleId } });
  invalidateSession(id);
  await audit({ orgId: actor.orgId, action: "ROLE_CHANGE", entityType: "USER", entityId: id, oldValue: { roleId: user.roleId }, newValue: { roleId }, actor: me });
}

export async function listRoles(orgId: string) {
  await assertPermission("roles.manage");
  return db.role.findMany({
    where: { organisationId: orgId },
    orderBy: { code: "asc" },
    include: { _count: { select: { users: true } } },
  });
}

export async function createRole(actor: Actor, raw: { code: string; name: string; permissions: string[] }) {
  const me = await assertPermission("roles.manage");
  const code = raw.code.trim().toUpperCase().replace(/[^A-Z_]/g, "_");
  if (!code) throw new Error("Role code is required.");
  if ((ROLES as readonly string[]).includes(code)) throw new Error("This code is reserved for a system role.");
  if (!raw.name.trim()) throw new Error("Role name is required.");
  const permissions = validatePermissions(raw.permissions);
  const role = await db.role.create({
    data: { organisationId: actor.orgId, code, name: raw.name.trim(), permissions },
  });
  await audit({ orgId: actor.orgId, action: "CREATE", entityType: "ROLE", entityId: role.id, newValue: role, actor: me });
  return role.id;
}

export async function updateRolePermissions(actor: Actor, id: string, permissions: string[]) {
  const me = await assertPermission("roles.manage");
  const role = await db.role.findFirst({ where: { id, organisationId: actor.orgId } });
  if (!role) throw new Error("This role was not found.");
  const valid = validatePermissions(permissions);
  if (role.code === "OWNER" && (!valid.includes("users.manage") || !valid.includes("roles.manage"))) {
    throw new Error("The Owner role must keep user and role management permissions.");
  }
  await db.role.update({ where: { id }, data: { permissions: valid } });
  // One role can be shared by many users, so drop every cached session.
  invalidateAllSessions();
  await audit({ orgId: actor.orgId, action: "PERMISSIONS_CHANGE", entityType: "ROLE", entityId: id, oldValue: role.permissions, newValue: valid, actor: me });
  await activity({ orgId: actor.orgId, entityType: "ROLE", entityId: id, message: `Permissions updated for role ${role.name}.`, actor: me });
}

export async function deleteRole(actor: Actor, id: string) {
  const me = await assertPermission("roles.manage");
  const role = await db.role.findFirst({
    where: { id, organisationId: actor.orgId },
    include: { _count: { select: { users: true } } },
  });
  if (!role) throw new Error("This role was not found.");
  if (role.isSystem) throw new Error("System roles cannot be deleted.");
  if (role._count.users > 0) throw new Error("This role is assigned to users. Reassign them first.");
  await db.role.delete({ where: { id } });
  await audit({ orgId: actor.orgId, action: "DELETE", entityType: "ROLE", entityId: id, oldValue: { code: role.code }, actor: me });
}

function validatePermissions(permissions: string[]): Permission[] {
  const valid = permissions.filter((p): p is Permission => (PERMISSIONS as readonly string[]).includes(p));
  return [...new Set(valid)];
}
