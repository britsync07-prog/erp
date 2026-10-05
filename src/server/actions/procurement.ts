"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { fail, friendlyError, type ActionResult } from "@/server/platform";
import * as svc from "@/server/services/procurement";

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

export async function createPODraftAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    const id = await svc.createDraft(me as never, form(formData));
    revalidatePath("/procurement");
    redirect(`/procurement/${id}`);
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function updatePODraftAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  const id = String(formData.get("id") ?? "");
  try {
    await svc.updateDraft(me as never, id, form(formData));
    revalidatePath(`/procurement/${id}`);
    revalidatePath("/procurement");
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function setPOLinesAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  const id = String(formData.get("id") ?? "");
  try {
    const parsed = JSON.parse(String(formData.get("linesJson") ?? "[]")) as unknown;
    await svc.setPOLines(me as never, id, { lines: parsed as never[] });
    revalidatePath(`/procurement/${id}`);
    revalidatePath("/procurement");
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function deletePODraftAction(id: string): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    await svc.deleteDraft(me as never, id);
    revalidatePath("/procurement");
    redirect("/procurement");
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function submitPOAction(id: string): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    await svc.submitForApproval(me as never, id);
    revalidatePath(`/procurement/${id}`);
    revalidatePath("/procurement");
    revalidatePath("/approvals");
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function sendPOAction(id: string): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    await svc.sendPO(me as never, id);
    revalidatePath(`/procurement/${id}`);
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function confirmSupplierPOAction(id: string): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    await svc.confirmSupplierPO(me as never, id);
    revalidatePath(`/procurement/${id}`);
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function closePOAction(id: string): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    await svc.closePO(me as never, id);
    revalidatePath(`/procurement/${id}`);
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function cancelPOAction(id: string): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    await svc.cancelPO(me as never, id);
    revalidatePath(`/procurement/${id}`);
    revalidatePath("/procurement");
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function cancelRequirementAction(id: string): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    await svc.cancelRequirement(me as never, id);
    revalidatePath("/procurement/requirements");
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function convertRequirementsAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    const ids = formData.getAll("ids").map(String).filter(Boolean);
    await svc.convertRequirements(me as never, ids);
    revalidatePath("/procurement");
    revalidatePath("/procurement/requirements");
    redirect("/procurement");
  } catch (e) {
    return fail(friendlyError(e));
  }
}
