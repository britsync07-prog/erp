"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/server/auth/session";
import { assertPermission } from "@/server/auth/permissions";
import { fail, friendlyError, type ActionResult } from "@/server/platform";
import { askCopilot, type CopilotAnswer, type ChatHistoryItem } from "@/server/ai/copilot";
import { generateBriefAs, triageFinding, executeRecommendation } from "@/server/ai/brief";
import { runMonitor, setRuleEnabled } from "@/server/ai/automation";

export interface AskResult extends ActionResult {
  answer?: CopilotAnswer;
}

/** Direct-call friendly (used by the chat client without useActionState). */
export async function askCopilotAction(
  question: string,
  history: ChatHistoryItem[] = [],
  agentCode?: string,
): Promise<AskResult> {
  const session = await getSession();
  if (!session) return fail("You are not signed in.");
  try {
    const answer = await askCopilot(session, question, history, undefined, undefined, agentCode);
    return { ok: true, answer };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function generateBriefAction(): Promise<ActionResult & { briefId?: string; mode?: string }> {
  const session = await getSession();
  if (!session) return fail("You are not signed in.");
  try {
    const r = await generateBriefAs(session);
    revalidatePath("/intelligence");
    revalidatePath("/");
    return { ok: true, briefId: r.briefId, mode: r.mode };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function triageFindingAction(id: string, status: "ACCEPTED" | "DISMISSED"): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return fail("You are not signed in.");
  try {
    await triageFinding({ id: session.id, name: session.name, orgId: session.orgId }, id, status);
    revalidatePath("/intelligence");
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function executeRecommendationAction(id: string): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return fail("You are not signed in.");
  try {
    await executeRecommendation(session, id);
    revalidatePath("/intelligence");
    revalidatePath("/procurement/requirements");
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function runMonitorAction(): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return fail("You are not signed in.");
  try {
    await assertPermission("intelligence.manage");
    const r = await runMonitor(session.orgId);
    void r;
    revalidatePath("/notifications");
    revalidatePath("/procurement/requirements");
    revalidatePath("/admin/automation");
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function setRuleEnabledAction(id: string, enabled: boolean): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return fail("You are not signed in.");
  try {
    await setRuleEnabled({ id: session.id, name: session.name, orgId: session.orgId }, id, enabled);
    revalidatePath("/admin/automation");
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}
