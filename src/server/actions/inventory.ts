"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { fail, friendlyError, type ActionResult } from "@/server/platform";
import * as svc from "@/server/services/inventory";

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

export async function createAdjustmentAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    const outcome = await svc.createAdjustment(me as never, form(formData));
    revalidatePath("/inventory");
    revalidatePath("/inventory/movements");
    revalidatePath("/inventory/adjustments");
    if (!outcome.applied) redirect("/approvals");
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function createTransferAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    await svc.createTransfer(me as never, form(formData));
    revalidatePath("/inventory");
    revalidatePath("/inventory/movements");
    revalidatePath("/inventory/transfers");
    redirect("/inventory/movements");
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function createCountAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    const id = await svc.createCount(me as never, String(formData.get("warehouseId") ?? ""));
    revalidatePath("/inventory/counts");
    redirect(`/inventory/counts/${id}`);
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function submitCountedAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  const countId = String(formData.get("countId") ?? "");
  try {
    const entries: Record<string, number> = {};
    formData.forEach((v, k) => {
      if (k.startsWith("qty_") && typeof v === "string" && v.trim() !== "") {
        const n = Number(v.replace(",", "."));
        if (Number.isFinite(n)) entries[k.slice(4)] = n;
      }
    });
    await svc.submitCounted(me as never, countId, entries);
    revalidatePath(`/inventory/counts/${countId}`);
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function postCountAction(countId: string): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    const corrections = await svc.postCount(me as never, countId);
    void corrections;
    revalidatePath(`/inventory/counts/${countId}`);
    revalidatePath("/inventory");
    revalidatePath("/inventory/counts");
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function cancelCountAction(countId: string): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    await svc.cancelCount(me as never, countId);
    revalidatePath(`/inventory/counts/${countId}`);
    revalidatePath("/inventory/counts");
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function createRequirementAction(productId: string, qty: number, reason: string): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    await svc.createRequirement(me as never, { productId, qty, reason });
    revalidatePath("/inventory/low-stock");
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}
