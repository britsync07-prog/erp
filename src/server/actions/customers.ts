"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { fail, friendlyError, type ActionResult } from "@/server/platform";
import * as svc from "@/server/services/customers";

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

export async function createCustomerAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    const id = await svc.createCustomer(me as never, form(formData));
    revalidatePath("/customers");
    redirect(`/customers/${id}`);
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function updateCustomerAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  const id = String(formData.get("id") ?? "");
  try {
    await svc.updateCustomer(me as never, id, form(formData));
    revalidatePath(`/customers/${id}`);
    revalidatePath("/customers");
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function archiveCustomerAction(id: string, archived: boolean): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    await svc.archiveCustomer(me as never, id, archived);
    revalidatePath(`/customers/${id}`);
    revalidatePath("/customers");
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function deleteCustomerAction(id: string): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    await svc.deleteCustomer(me as never, id);
    revalidatePath("/customers");
    redirect("/customers");
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function addAddressAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  const customerId = String(formData.get("customerId") ?? "");
  try {
    const f = form(formData);
    await svc.addCustomerAddress(me as never, customerId, { ...f, isDefault: formData.get("isDefault") === "on" });
    revalidatePath(`/customers/${customerId}`);
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function addContactAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  const customerId = String(formData.get("customerId") ?? "");
  try {
    await svc.addCustomerContact(me as never, customerId, form(formData));
    revalidatePath(`/customers/${customerId}`);
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function setCustomerPriceAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  const customerId = String(formData.get("customerId") ?? "");
  try {
    await svc.setCustomerPrice(me as never, customerId, form(formData));
    revalidatePath(`/customers/${customerId}`);
    revalidatePath("/pricing");
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}
