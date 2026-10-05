"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/server/auth/session";
import { fail, friendlyError, type ActionResult } from "@/server/platform";
import * as svc from "@/server/services/platformRead";

async function actor() {
  const s = await getSession();
  if (!s) return fail("You are not signed in.");
  return s;
}

export async function markNotificationReadAction(id: string): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    await svc.markNotificationRead((me as never as { orgId: string }).orgId, me as never, id);
    revalidatePath("/notifications");
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function markAllNotificationsReadAction(): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    await svc.markAllNotificationsRead((me as never as { orgId: string }).orgId, me as never);
    revalidatePath("/notifications");
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}
