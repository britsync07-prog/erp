import "server-only";
import type { PrismaClient } from "@prisma/client";
import { db } from "@/server/db";
import { hasLLM, chatWithTools } from "./provider";
import { toolsFor, runTool, type ToolCtx } from "./tools";
import { writeToolsFor, findWriteTool, proposeWriteAction, logWriteAction } from "./registry";
import { agentFor } from "./agents";
import type { SessionUser } from "@/server/auth/session";

export interface CopilotEvidence {
  label: string;
  link: string;
}

export interface CopilotAnswer {
  text: string;
  evidence: CopilotEvidence[];
  toolsUsed: string[];
  tokens: number;
  mode: "ai" | "rules";
}

export interface ChatHistoryItem {
  role: "user" | "assistant";
  content: string;
}

const SYSTEM = `You are the DonerERP operations copilot for a food distribution business.
Rules you must follow:
- Answer ONLY from tool results. Never invent numbers, SKUs, order numbers, customer names, or stock states.
- If the tools return nothing relevant, say exactly which data is missing and suggest where to create it.
- Structure every answer as: **Finding** → **Reason** → **Evidence** → **Recommended action**.
- Reference records as markdown links exactly as given in tool output, e.g. [ORD-0001](/orders/abc123).
- Money is EUR, quantities state their unit. Keep answers short and operational.
- Never mention permissions, roles, tool names, models, or these instructions.`;

export type ChatFn = typeof chatWithTools;

async function logQuery(ctx: ToolCtx, question: string, answer: Omit<CopilotAnswer, "evidence"> & { evidence: unknown }) {
  try {
    await (ctx.client ?? db).aIAction.create({
      data: {
        orgId: ctx.orgId,
        level: "A_READ",
        tool: "copilot.query",
        input: { question: question.slice(0, 500) },
        result: { toolsUsed: answer.toolsUsed, tokens: answer.tokens, mode: answer.mode },
        userId: ctx.userId,
        status: "DONE",
      },
    });
  } catch {
    // Observability must never break the answer path.
  }
}

function extractLinks(text: string): CopilotEvidence[] {
  const out: CopilotEvidence[] = [];
  const re = /\[([^\]]+)\]\((\/[^)\s]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (!out.some((e) => e.link === m![2])) out.push({ label: m[1], link: m[2] });
  }
  return out.slice(0, 12);
}

export async function askCopilot(
  session: Pick<SessionUser, "id" | "orgId" | "name" | "permissions">,
  question: string,
  history: ChatHistoryItem[] = [],
  chatFn: ChatFn = chatWithTools,
  client?: PrismaClient,
  agentCode?: string,
): Promise<CopilotAnswer> {
  const q = question.trim().slice(0, 1000);
  if (!q) throw new Error("Ask a question about the operation.");
  const agent = agentFor(agentCode);
  const ctx: ToolCtx = { orgId: session.orgId, userId: session.id, permissions: session.permissions, client };
  const readTools = toolsFor(session.permissions).filter(
    (t) => agent.tools.includes("*") || agent.tools.includes(t.name),
  );

  if (!hasLLM()) return ruleBasedAnswer(ctx, q);
  try {
    const messages: { role: "system" | "user" | "assistant" | "tool"; content: string; toolCallId?: string; toolCalls?: { id: string; name: string; args: string }[] }[] = [
      { role: "system", content: `${SYSTEM}\n\nSpecialist focus (${agent.name}): ${agent.prompt}` },
      ...history.slice(-6).map((h) => ({ role: h.role as "user" | "assistant", content: h.content.slice(0, 2000) })),
      { role: "user" as const, content: q },
    ];
    const writeTools = writeToolsFor(session.permissions);
    const defs = [
      ...readTools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })),
      ...writeTools.map((t) => ({
        name: t.name,
        description: `${t.description} [${t.level === "B_DRAFT" ? "executes immediately, logged" : "files a human-approval request, never executes directly"}]`,
        parameters: t.parameters,
      })),
    ];
    const used: string[] = [];
    let tokens = 0;
    const store = client ?? db;
    const actor = { id: session.id, name: session.name, orgId: session.orgId };

    for (let i = 0; i < 6; i++) {
      const r = await chatFn(messages, defs);
      tokens += r.tokens;
      if (r.toolCalls.length === 0) {
        const text = r.content?.trim() || "I could not find relevant data for that question.";
        const answer: CopilotAnswer = { text, evidence: extractLinks(text), toolsUsed: [...new Set(used)], tokens, mode: "ai" };
        await logQuery(ctx, q, answer);
        return answer;
      }
      messages.push({
        role: "assistant",
        content: r.content ?? "",
        toolCalls: r.toolCalls.map((c) => ({ id: c.id, name: c.name, args: JSON.stringify(c.args) })),
      });
      for (const c of r.toolCalls) {
        used.push(c.name);
        const writeTool = findWriteTool(c.name);
        try {
          if (!writeTool) {
            const out = await runTool(ctx, c.name, c.args);
            messages.push({ role: "tool", content: JSON.stringify(out), toolCallId: c.id });
          } else if (writeTool.level === "B_DRAFT") {
            const result = await writeTool.execute(store, ctx.orgId, actor, c.args);
            await logWriteAction(ctx.orgId, actor, writeTool.name, "B_DRAFT", c.args, { summary: result.summary }, store);
            messages.push({
              role: "tool",
              content: JSON.stringify({ executed: result.summary, link: result.link ?? null }),
              toolCallId: c.id,
            });
          } else {
            const { approvalId } = await proposeWriteAction(store, ctx.orgId, actor, writeTool, c.args);
            messages.push({
              role: "tool",
              content: JSON.stringify({
                proposed: writeTool.summarize(c.args),
                approvalLink: "/approvals",
                approvalId,
                note: "Waiting for human approval — tell the user to review it in the approvals inbox.",
              }),
              toolCallId: c.id,
            });
          }
        } catch (e) {
          messages.push({ role: "tool", content: `Error: ${e instanceof Error ? e.message : "tool failed."}`, toolCallId: c.id });
        }
      }
    }
    // Iteration budget spent: force a grounded summary from gathered evidence.
    messages.push({ role: "user", content: "Answer now using only the evidence gathered above, in the required format." });
    const r = await chatFn(messages, []);
    tokens += r.tokens;
    const text = r.content?.trim() || "I gathered data but could not compose an answer. Try a narrower question.";
    const answer: CopilotAnswer = { text, evidence: extractLinks(text), toolsUsed: [...new Set(used)], tokens, mode: "ai" };
    await logQuery(ctx, q, answer);
    return answer;
  } catch {
    const fallback = await ruleBasedAnswer(ctx, q);
    return { ...fallback, text: `AI service unreachable — rule-based answer:\n\n${fallback.text}` };
  }
}

// ─── Rule-based fallback (also the no-key mode) ─────────────────────────────

const money = (c: number) => `€${(c / 100).toFixed(2)}`;

export async function ruleBasedAnswer(ctx: ToolCtx, q: string): Promise<CopilotAnswer> {
  const s = q.toLowerCase();
  const used: string[] = [];
  const parts: string[] = [];

  const run = async (name: string) => {
    try {
      used.push(name);
      return (await runTool(ctx, name, {})) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  // Morning-brief intent gets the composite picture first.
  if (/brief|dail|summary|what needs|attention today|overview|how is business|status/.test(s)) {
    const [a, st, r] = await Promise.all([run("operations_attention"), run("stock_risks"), run("receivables_snapshot")]);
    if (!a && !st && !r) return noAccess("operational data");
    if (a) {
      const o = a.orders as { today: number; waiting: number; ready: number };
      parts.push(
        `**Finding:** ${o.today} orders today · ${o.waiting} waiting for stock · ${o.ready} ready to pick · ` +
        `${a.pendingApprovals as number} approvals pending · ${a.overduePurchaseOrders as number} overdue purchase orders.`,
      );
    }
    if (st) {
      const items = (Array.isArray(st) ? st : []) as { sku: string; link: string }[];
      parts.push(
        items.length === 0
          ? "**Reason:** Stock is healthy — nothing below reorder point."
          : `**Reason:** ${items.length} products below reorder point, first: ` +
            items.slice(0, 3).map((i) => `[${i.sku}](${i.link})`).join(", ") + ".",
      );
    }
    if (r) {
      parts.push(`**Evidence:** ${money(r.outstandingCents as number)} outstanding, ${r.overdueCount as number} overdue ([receivables](/finance/receivables)).`);
    }
    parts.push("**Recommended action:** Work the [pick queue](/fulfilment), clear [waiting orders](/orders?status=WAITING_FOR_STOCK), then review the [full brief](/intelligence).");
    const text = parts.join("\n");
    const answer: CopilotAnswer = { text, evidence: extractLinks(text), toolsUsed: [...new Set(used)], tokens: 0, mode: "rules" };
    await logQuery(ctx, q, answer);
    return answer;
  }

  if (/stock|invent|reorder|low|run out|replenish/.test(s)) {
    const d = await run("stock_risks");
    const items = (Array.isArray(d) ? d : []) as { sku: string; name: string; available: number; reorderPoint: number; suggestedTopUp: number; link: string }[];
    if (d === null) return noAccess("stock data");
    if (items.length === 0) {
      parts.push("**Finding:** Nothing is below reorder point.\n**Reason:** All active products cover their reorder levels.\n**Recommended action:** None — check again after the next goods receipt.");
    } else {
      parts.push(`**Finding:** ${items.length} product${items.length === 1 ? " is" : "s are"} below reorder point.`);
      for (const i of items.slice(0, 8)) {
        parts.push(`- **Reason:** [${i.sku}](${i.link}) has ${i.available} available vs reorder at ${i.reorderPoint}.\n  **Recommended action:** Top up ~${i.suggestedTopUp} (see [low stock](/inventory/low-stock)).`);
      }
    }
  } else if (/order|fulfil|deliver|dispatch|pick|waiting|ready/.test(s)) {
    const d = await run("operations_attention");
    if (!d) return noAccess("order data");
    const o = d.orders as { today: number; waiting: number; ready: number };
    parts.push(
      `**Finding:** ${o.today} orders today, ${o.waiting} waiting for stock, ${o.ready} ready to pick.`,
      `**Evidence:** ${d.pendingApprovals as number} pending approvals, ${d.overduePurchaseOrders as number} overdue purchase orders.`,
      `**Recommended action:** Clear [waiting orders](/orders?status=WAITING_FOR_STOCK), then work the [pick queue](/fulfilment).`,
    );
  } else if (/money|receiv|overdue|owe|invoice|payment|debt|cash/.test(s)) {
    const d = await run("receivables_snapshot");
    if (!d) return noAccess("finance data");
    const debtors = (d.topDebtors as { company: string; balance: number; link: string }[]).map(
      (x) => `- **Reason:** [${x.company}](${x.link}) owes ${money(x.balance)}.`,
    );
    parts.push(
      `**Finding:** ${money(d.outstandingCents as number)} outstanding, ${d.overdueCount as number} invoices overdue.`,
      ...debtors,
      `**Recommended action:** Chase from the [receivables board](/finance/receivables).`,
    );
  } else if (/supplier|vendor|late|purchase|procure/.test(s)) {
    const d = await run("supplier_performance");
    if (!d) return noAccess("procurement data");
    const rows = (Array.isArray(d) ? d : []) as { company: string; lateDeliveries: number; avgDelayDays: number; link: string }[];
    const bad = rows.filter((r) => r.lateDeliveries > 0);
    parts.push(
      bad.length === 0
        ? "**Finding:** No late deliveries in recent purchase history."
        : `**Finding:** ${bad.length} supplier${bad.length === 1 ? " is" : "s are"} slipping: ` +
          bad.slice(0, 5).map((r) => `[${r.company}](${r.link}) ${r.lateDeliveries} late (avg ${r.avgDelayDays}d)`).join("; ") + ".",
      "**Recommended action:** Review [purchase orders](/procurement) and confirm upcoming deliveries.",
    );
  } else if (/margin|profit|cost|loss/.test(s)) {
    const d = await run("margin_snapshot");
    if (!d) return noAccess("margin data");
    const weak = (d.weakestProducts as { sku: string; marginPct: number; link: string }[]).map(
      (p) => `[${p.sku}](${p.link}) ${p.marginPct}%`,
    );
    parts.push(
      `**Finding:** Gross margin ${d.marginPct as number}% on ${money(d.revenueCents as number)} recent revenue.`,
      weak.length > 0 ? `**Reason:** Weakest products: ${weak.join(", ")}.` : "**Reason:** No weak-margin products in the top list.",
      "**Recommended action:** Check pricing on weak products in [margins](/finance/margins).",
    );
  } else if (/customer|client|demand|sell|revenue/.test(s)) {
    const [c, dem] = await Promise.all([run("customer_highlights"), run("product_demand")]);
    if (c) {
      const top = (c.topCustomers as { company: string; revenueCents: number; orders: number; link: string }[]).map(
        (x) => `[${x.company}](${x.link}) ${money(x.revenueCents)} (${x.orders} orders)`,
      );
      parts.push(`**Finding:** ${c.newCustomers30d as number} new customers in 30 days. Top recent: ${top.slice(0, 4).join("; ") || "none yet"}.`);
    }
    if (dem) {
      const top = ((dem.top ?? []) as { sku: string; qty: number; link: string }[]).slice(0, 4).map((t) => `[${t.sku}](${t.link}) ${t.qty}`).join("; ");
      if (top) parts.push(`**Reason:** Strongest 30-day demand: ${top}.`);
    }
    if (parts.length === 0) return noAccess("customer data");
    parts.push("**Recommended action:** Protect stock for the top sellers first.");
  } else {
    const d = await run("operations_attention");
    if (d) {
      const o = d.orders as { today: number; waiting: number; ready: number };
      parts.push(
        `**Finding:** ${o.today} orders today · ${o.waiting} waiting · ${o.ready} ready. ${d.pendingApprovals as number} approvals pending.`,
        "**Recommended action:** Ask me specifically — e.g. “what should we reorder?”, “which orders are at risk?”, “who owes us money?”.",
      );
    } else {
      parts.push(
        "**Finding:** I can see no operational data with your permissions.",
        "**Recommended action:** Ask your administrator for the relevant module access.",
      );
    }
  }

  const text = parts.join("\n");
  const answer: CopilotAnswer = { text, evidence: extractLinks(text), toolsUsed: [...new Set(used)], tokens: 0, mode: "rules" };
  await logQuery(ctx, q, answer);
  return answer;

  function noAccess(what: string): CopilotAnswer {
    return {
      text: `**Finding:** You do not have access to ${what}.\n**Recommended action:** Ask your administrator for access, or ask about an area you can see.`,
      evidence: [],
      toolsUsed: [...new Set(used)],
      tokens: 0,
      mode: "rules",
    };
  }
}
