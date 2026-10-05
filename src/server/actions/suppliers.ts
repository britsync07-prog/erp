"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { fail, friendlyError, type ActionResult } from "@/server/platform";
import * as svc from "@/server/services/suppliers";

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

export async function createSupplierAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    const id = await svc.createSupplier(me as never, form(formData));
    revalidatePath("/suppliers");
    redirect(`/suppliers/${id}`);
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function updateSupplierAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  const id = String(formData.get("id") ?? "");
  try {
    await svc.updateSupplier(me as never, id, form(formData));
    revalidatePath(`/suppliers/${id}`);
    revalidatePath("/suppliers");
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function archiveSupplierAction(id: string, archived: boolean): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    await svc.archiveSupplier(me as never, id, archived);
    revalidatePath(`/suppliers/${id}`);
    revalidatePath("/suppliers");
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function deleteSupplierAction(id: string): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    await svc.deleteSupplier(me as never, id);
    revalidatePath("/suppliers");
    redirect("/suppliers");
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function addSupplierContactAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  const supplierId = String(formData.get("supplierId") ?? "");
  try {
    await svc.addSupplierContact(me as never, supplierId, form(formData));
    revalidatePath(`/suppliers/${supplierId}`);
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}
