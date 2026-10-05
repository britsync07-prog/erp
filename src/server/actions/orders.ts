"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { fail, friendlyError, type ActionResult } from "@/server/platform";
import * as svc from "@/server/services/orders";

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

export async function createDraftAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    const id = await svc.createDraft(me as never, form(formData));
    revalidatePath("/orders");
    redirect(`/orders/${id}`);
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function updateDraftAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  const id = String(formData.get("id") ?? "");
  try {
    await svc.updateDraft(me as never, id, form(formData));
    revalidatePath(`/orders/${id}`);
    revalidatePath("/orders");
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function setDraftLinesAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  const id = String(formData.get("id") ?? "");
  try {
    const parsed = JSON.parse(String(formData.get("linesJson") ?? "[]")) as unknown;
    await svc.setDraftLines(me as never, id, { lines: parsed as never[] });
    revalidatePath(`/orders/${id}`);
    revalidatePath("/orders");
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function deleteDraftAction(id: string): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    await svc.deleteDraft(me as never, id);
    revalidatePath("/orders");
    redirect("/orders");
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function confirmOrderAction(id: string): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    await svc.confirmOrder(me as never, id);
    revalidatePath(`/orders/${id}`);
    revalidatePath("/orders");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function recheckOrderAction(id: string): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    await svc.recheckOrder(me as never, id);
    revalidatePath(`/orders/${id}`);
    revalidatePath("/orders");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function cancelOrderAction(id: string): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    await svc.cancelOrder(me as never, id);
    revalidatePath(`/orders/${id}`);
    revalidatePath("/orders");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}
