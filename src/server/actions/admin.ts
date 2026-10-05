"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/server/auth/session";
import { fail, friendlyError, type ActionResult } from "@/server/platform";
import * as svc from "@/server/services/admin";

async function actor() {
  const s = await getSession();
  if (!s) return fail("You are not signed in.");
  return s;
}

function form(raw: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  raw.forEach((v, k) => {
    if (typeof v === "string") out[k] = v;
  });
  return out;
}

export async function createUserAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    await svc.createUser(me as never, form(formData));
    revalidatePath("/users");
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function setUserActiveAction(id: string, active: boolean): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    await svc.setUserActive(me as never, id, active);
    revalidatePath("/users");
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function setUserRoleAction(id: string, roleId: string): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    await svc.setUserRole(me as never, id, roleId);
    revalidatePath("/users");
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function createRoleAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    const permissions = formData.getAll("permissions").map(String);
    await svc.createRole(me as never, {
      code: String(formData.get("code") ?? ""),
      name: String(formData.get("name") ?? ""),
      permissions,
    });
    revalidatePath("/roles");
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function updateRolePermissionsAction(id: string, permissions: string[]): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    await svc.updateRolePermissions(me as never, id, permissions);
    revalidatePath("/roles");
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function deleteRoleAction(id: string): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    await svc.deleteRole(me as never, id);
    revalidatePath("/roles");
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}
