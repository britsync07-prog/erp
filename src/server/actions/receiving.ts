"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { fail, friendlyError, type ActionResult } from "@/server/platform";
import * as svc from "@/server/services/receiving";

async function actor() {
  const s = await getSession();
  if (!s) return fail("You are not signed in.");
  return s;
}

export async function submitReceiptAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    const parsed = JSON.parse(String(formData.get("linesJson") ?? "[]")) as unknown;
    const result = await svc.receiveGoods(me as never, {
      poId: String(formData.get("poId") ?? ""),
      lines: parsed,
    });
    for (const p of ["/inventory/receiving", "/inventory", "/orders", "/procurement", "/"]) revalidatePath(p);
    redirect(`/inventory/receipts/${result.receiptId}`);
  } catch (e) {
    return fail(friendlyError(e));
  }
}
