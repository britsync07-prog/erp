"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/server/auth/session";
import { fail, friendlyError, type ActionResult } from "@/server/platform";
import * as svc from "@/server/services/approvals";

async function actor() {
  const s = await getSession();
  if (!s) return fail("You are not signed in.");
  return s;
}

export async function approveRequestAction(id: string): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    await svc.approveRequest(me as never, id);
    revalidatePath("/approvals");
    revalidatePath("/inventory");
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function rejectRequestAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    await svc.rejectRequest(me as never, String(formData.get("id") ?? ""), String(formData.get("comment") ?? ""));
    revalidatePath("/approvals");
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}
