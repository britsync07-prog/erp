"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { fail, friendlyError, type ActionResult } from "@/server/platform";
import * as svc from "@/server/services/fulfilment";

async function actor() {
  const s = await getSession();
  if (!s) return fail("You are not signed in.");
  return s;
}

function touch(id: string) {
  revalidatePath(`/fulfilment/${id}`);
  revalidatePath("/fulfilment");
  revalidatePath("/orders");
  revalidatePath("/");
}

export async function startPickingAction(id: string): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    await svc.startPicking(me as never, id);
    touch(id);
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function confirmPickAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  const id = String(formData.get("id") ?? "");
  try {
    const parsed = JSON.parse(String(formData.get("picksJson") ?? "[]")) as unknown;
    await svc.confirmPick(me as never, id, { picks: parsed });
    touch(id);
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function dispatchAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  const id = String(formData.get("id") ?? "");
  try {
    await svc.dispatchOrder(me as never, id, {
      carrier: String(formData.get("carrier") ?? ""),
      tracking: String(formData.get("tracking") ?? ""),
    });
    touch(id);
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function deliverAction(id: string): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    await svc.markDelivered(me as never, id);
    touch(id);
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function createReturnAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    const parsed = JSON.parse(String(formData.get("linesJson") ?? "[]")) as unknown;
    const id = await svc.createReturn(me as never, {
      orderId: String(formData.get("orderId") ?? ""),
      reason: String(formData.get("reason") ?? ""),
      lines: parsed,
    });
    revalidatePath("/fulfilment/returns");
    redirect(`/fulfilment/returns/${id}`);
  } catch (e) {
    return fail(friendlyError(e));
  }
}
