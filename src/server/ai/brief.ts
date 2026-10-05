import "server-only";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { db } from "@/server/db";
import { hasLLM, chatJson } from "./provider";
import { runTool, type ToolCtx } from "./tools";
import { PERMISSIONS } from "@/domain/constants";
import { assertPermission, assertAnyPermission } from "@/server/auth/permissions";
import { audit } from "@/server/platform";
import { findWriteTool, logWriteAction } from "./registry";
import type { SessionUser } from "@/server/auth/session";

// AI Daily Brief (§6, Phase 9): every insight links to its record. Composed by
// the LLM when configured, otherwise by deterministic rules — same shape either
// way, persisted as triageable AIRecommendation rows.

const FindingSchema = z.object({
  kind: z.enum(["STOCK_RISK", "ORDER_RISK", "RECEIVABLE_RISK", "SUPPLIER_RISK", "MARGIN_WATCH", "REORDER", "INFO"]),
  title: z.string().min(1).max(200),
  reason: z.string().min(1).max(1000),
  evidence: z.record(z.string(), z.unknown()).default({}),
  actionLink: z.string().regex(/^\//, "Link must be an internal path.").nullish(),
});

const BriefDocSchema = z.object({
  headline: z.string().min(1).max(500),
  kpis: z.object({
    ordersToday: z.number(),
    waiting: z.number(),
    ready: z.number(),
    lowCount: z.number(),
    overdueCents: z.number(),
    overdueCount: z.number(),
    pendingApprovals: z.number(),
    overduePOs: z.number(),
  }),
  findings: z.array(FindingSchema).max(10),
  reorders: z.array(z.object({
    sku: z.string(),
    name: z.string().optional(),
    suggested: z.number(),
    link: z.string().regex(/^\//),
  })).max(8),
});

export type BriefDoc = z.infer<typeof BriefDocSchema>;
export type BriefScope = {
  orgId: string;
  userId: string | null;
  actorName: string;
  permissions: readonly string[];
  /** Isolated client for tests; production callers omit it. */
  client?: PrismaClient;
};

export async function gatherBriefData(ctx: ToolCtx): Promise<Record<string, unknown>> {
  const get = async (name: string) => {
    try {
      return await runTool(ctx, name, {});
    } catch {
      return null;
    }
  };
  const [attention, stock, receivables, suppliers, margins] = await Promise.all([
    get("operations_attention"),
    get("stock_risks"),
    get("receivables_snapshot"),
    get("supplier_performance"),
    get("margin_snapshot"),
  ]);
  return { date: new Date().toISOString().slice(0, 10), attention, stock, receivables, suppliers, margins };
}

const money = (c: number) => `€${(c / 100).toFixed(2)}`;

export function ruleComposeBrief(data: Record<string, unknown>): BriefDoc {
  const attention = (data.attention ?? {}) as { orders?: { today: number; waiting: number; ready: number }; pendingApprovals?: number; overduePurchaseOrders?: number };
  const stock = (Array.isArray(data.stock) ? data.stock : []) as {
    sku: string; name: string; productId: string; available: number;
    reorderPoint: number; suggestedTopUp: number; hasOpenRequirement: boolean; link: string;
  }[];
  const receivables = (data.receivables ?? null) as { outstandingCents: number; overdueCount: number } | null;
  const suppliers = (Array.isArray(data.suppliers) ? data.suppliers : []) as { company: string; lateDeliveries: number; avgDelayDays: number; link: string }[];
  const margins = (data.margins ?? null) as { marginPct: number } | null;

  const o = attention.orders ?? { today: 0, waiting: 0, ready: 0 };
  const kpis = {
    ordersToday: o.today,
    waiting: o.waiting,
    ready: o.ready,
    lowCount: stock.length,
    overdueCents: receivables?.outstandingCents ?? 0,
    overdueCount: (receivables as { overdueCount?: number } | null)?.overdueCount ?? 0,
    pendingApprovals: attention.pendingApprovals ?? 0,
    overduePOs: attention.overduePurchaseOrders ?? 0,
  };
  const headline =
    `${o.today} orders today · ${o.waiting} waiting for stock · ${o.ready} ready · ` +
    `${stock.length} low-stock · ${money(kpis.overdueCents)} outstanding · ${kpis.pendingApprovals} approvals pending`;

  const findings: BriefDoc["findings"] = [];
  if (o.waiting > 0) {
    findings.push({
      kind: "ORDER_RISK",
      title: `${o.waiting} orders waiting for stock`,
      reason: `Confirmed demand cannot ship until goods arrive.`,
      evidence: {},
      actionLink: "/orders?status=WAITING_FOR_STOCK",
    });
  }
  for (const s of stock.slice(0, 4)) {
    findings.push({
      kind: "STOCK_RISK",
      title: `${s.sku} below reorder point (${s.available} left)`,
      reason: `Available ${s.available} vs reorder at ${s.reorderPoint}; deterministic top-up ≈ ${s.suggestedTopUp}.`,
      evidence: {
        sku: s.sku,
        // One-click execution: raises an OPEN requirement (Level B, reversible).
        ...(s.hasOpenRequirement
          ? {}
          : { proposedAction: { tool: "create_requirement", args: { productId: s.productId, qty: s.suggestedTopUp, reason: `AI brief: ${s.sku} below reorder point` } } }),
      },
      actionLink: s.link,
    });
  }
  if (kpis.overdueCount > 0) {
    findings.push({
      kind: "RECEIVABLE_RISK",
      title: `${kpis.overdueCount} invoices overdue`,
      reason: `${money(kpis.overdueCents)} outstanding across customers.`,
      evidence: {},
      actionLink: "/finance?overdue=1",
    });
  }
  const badSuppliers = suppliers.filter((s) => s.lateDeliveries > 0).slice(0, 2);
  for (const s of badSuppliers) {
    findings.push({
      kind: "SUPPLIER_RISK",
      title: `${s.company}: ${s.lateDeliveries} late deliveries`,
      reason: `Average delay ${s.avgDelayDays} days on recent purchase orders.`,
      evidence: {},
      actionLink: s.link,
    });
  }
  if (kpis.overduePOs > 0) {
    findings.push({
      kind: "SUPPLIER_RISK",
      title: `${kpis.overduePOs} purchase orders past expected date`,
      reason: `Supplier confirmations or partial receipts are outstanding.`,
      evidence: {},
      actionLink: "/inventory/receiving",
    });
  }
  if (margins && margins.marginPct < 15) {
    findings.push({
      kind: "MARGIN_WATCH",
      title: `Gross margin soft at ${margins.marginPct}%`,
      reason: `Below the 15% watch threshold on recent revenue.`,
      evidence: {},
      actionLink: "/finance/margins",
    });
  }
  if (kpis.pendingApprovals > 0) {
    findings.push({
      kind: "INFO",
      title: `${kpis.pendingApprovals} approvals waiting`,
      reason: `Purchase orders or adjustments need a second person.`,
      evidence: {},
      actionLink: "/approvals",
    });
  }

  return {
    headline,
    kpis,
    findings: findings.slice(0, 10),
    reorders: stock
      .filter((s) => s.suggestedTopUp > 0)
      .slice(0, 8)
      .map((s) => ({ sku: s.sku, name: s.name, suggested: s.suggestedTopUp, link: "/inventory/low-stock" })),
  };
}

const BRIEF_SYSTEM = `You are a distribution operations analyst. Compose the morning daily brief as a single JSON object with exactly this shape:
{"headline": string (one-line business summary), "kpis": {"ordersToday": number, "waiting": number, "ready": number, "lowCount": number, "overdueCents": number, "overdueCount": number, "pendingApprovals": number, "overduePOs": number}, "findings": [{"kind": one of STOCK_RISK|ORDER_RISK|RECEIVABLE_RISK|SUPPLIER_RISK|MARGIN_WATCH|REORDER|INFO, "title": string, "reason": string, "evidence": object, "actionLink": string|null}], "reorders": [{"sku": string, "name": string, "suggested": number, "link": string}]}
Rules: use ONLY the provided data (never invent figures or links — actionLink values must be copied from the data); at most 10 findings, most urgent first; headline under 200 characters.`;

export async function generateBrief(scope: BriefScope): Promise<{ briefId: string; mode: "ai" | "rules"; tokens: number }> {
  const store = scope.client ?? db;
  const ctx: ToolCtx = { orgId: scope.orgId, userId: scope.userId ?? "system", permissions: scope.permissions, client: scope.client };
  const data = await gatherBriefData(ctx);
  let doc: BriefDoc;
  let mode: "ai" | "rules" = "rules";
  let tokens = 0;
  if (hasLLM()) {
    try {
      const r = await chatJson(BRIEF_SYSTEM, `Business data for ${data.date as string}:\n${JSON.stringify(data).slice(0, 12000)}`);
      tokens = r.tokens;
      doc = BriefDocSchema.parse(r.data);
      mode = "ai";
    } catch {
      doc = ruleComposeBrief(data);
    }
  } else {
    doc = ruleComposeBrief(data);
  }

  const brief = await store.aIRecommendation.create({
    data: {
      orgId: scope.orgId,
      kind: "DAILY_BRIEF",
      title: doc.headline,
      reason: `Morning brief for ${data.date as string} (${mode === "ai" ? "AI-composed" : "rule-composed"}).`,
      evidence: { kpis: doc.kpis, mode, date: data.date as string },
      status: "OPEN",
    },
  });
  for (const f of doc.findings) {
    await store.aIRecommendation.create({
      data: {
        orgId: scope.orgId,
        kind: f.kind,
        title: f.title,
        reason: f.reason,
        evidence: { briefId: brief.id, ...(f.evidence as Record<string, unknown>) },
        actionLink: f.actionLink ?? null,
        status: "OPEN",
      },
    });
  }
  try {
    await store.aIAction.create({
      data: {
        orgId: scope.orgId,
        level: "B_DRAFT",
        tool: "brief.generate",
        input: { date: data.date as string },
        result: { mode, tokens, findings: doc.findings.length },
        userId: scope.userId,
        status: "DONE",
      },
    });
  } catch {
    /* observability never breaks the path */
  }
  return { briefId: brief.id, mode, tokens };
}

export async function generateBriefAs(session: Pick<SessionUser, "id" | "orgId" | "name" | "permissions">) {
  await assertPermission("intelligence.manage");
  return generateBrief({
    orgId: session.orgId,
    userId: session.id,
    actorName: session.name,
    permissions: session.permissions,
  });
}

/** Cron/server path: full-visibility system scope, no interactive user. */
export async function generateBriefSystem(orgId: string) {
  return generateBrief({
    orgId,
    userId: null,
    actorName: "scheduled brief",
    permissions: [...PERMISSIONS],
  });
}

export async function latestBrief(orgId: string) {
  await assertPermission("intelligence.view");
  const brief = await db.aIRecommendation.findFirst({
    where: { orgId, kind: "DAILY_BRIEF" },
    orderBy: { createdAt: "desc" },
  });
  if (!brief) return null;
  const candidates = await db.aIRecommendation.findMany({
    where: { orgId, createdAt: { gte: brief.createdAt }, NOT: { id: brief.id } },
    orderBy: { createdAt: "asc" },
    take: 60,
  });
  const findings = candidates.filter((c) => (c.evidence as { briefId?: string } | null)?.briefId === brief.id);
  return { brief, findings };
}

export async function triageFinding(
  actor: Pick<SessionUser, "id" | "name" | "orgId">,
  id: string,
  status: "ACCEPTED" | "DISMISSED",
) {
  const me = await assertPermission("intelligence.manage");
  const row = await db.aIRecommendation.findFirst({ where: { id, orgId: actor.orgId } });
  if (!row) throw new Error("This recommendation was not found.");
  if (row.status !== "OPEN") throw new Error("This recommendation was already triaged.");
  await db.aIRecommendation.update({ where: { id }, data: { status } });
  await audit({
    orgId: actor.orgId,
    action: status === "ACCEPTED" ? "AI_ACCEPT" : "AI_DISMISS",
    entityType: "AI_RECOMMENDATION",
    entityId: id,
    actor: me,
  });
}

/**
 * Execute a recommendation's proposed action (recommendation engine). Only
 * Level B actions are offered on findings — they run now, then the finding is
 * accepted with a link to the result. Level C always routes via the inbox.
 */
export async function executeRecommendationCore(
  client: PrismaClient,
  orgId: string,
  actor: Pick<SessionUser, "id" | "name" | "orgId">,
  id: string,
): Promise<{ link?: string }> {
  const row = await client.aIRecommendation.findFirst({ where: { id, orgId } });
  if (!row) throw new Error("This recommendation was not found.");
  if (row.status !== "OPEN") throw new Error("This recommendation was already triaged.");
  const proposed = (row.evidence as { proposedAction?: { tool: string; args: Record<string, unknown> } } | null)?.proposedAction;
  if (!proposed) throw new Error("This recommendation has no executable action.");
  const tool = findWriteTool(proposed.tool);
  if (!tool) throw new Error(`Unknown AI tool: ${proposed.tool}.`);
  if (tool.level !== "B_DRAFT") throw new Error("This action needs human approval — use the approvals inbox.");
  const result = await tool.execute(client, orgId, actor, proposed.args);
  await logWriteAction(orgId, actor, tool.name, "B_DRAFT", proposed.args, { summary: result.summary, findingId: id }, client);
  await client.aIRecommendation.update({ where: { id }, data: { status: "ACCEPTED" } });
  await audit({
    orgId, action: "AI_ACCEPT", entityType: "AI_RECOMMENDATION", entityId: id,
    newValue: { executed: result.summary }, actor, source: "AI", client,
  });
  return { link: result.link };
}

export async function executeRecommendation(
  actor: Pick<SessionUser, "id" | "name" | "orgId" | "permissions">,
  id: string,
): Promise<{ link?: string }> {
  const row = await db.aIRecommendation.findFirst({ where: { id, orgId: actor.orgId } });
  if (!row) throw new Error("This recommendation was not found.");
  const proposed = (row.evidence as { proposedAction?: { tool: string } } | null)?.proposedAction;
  const tool = proposed ? findWriteTool(proposed.tool) : undefined;
  const me = await assertAnyPermission(tool ? [...tool.requires] : ["intelligence.manage"]);
  return executeRecommendationCore(db, actor.orgId, me, id);
}

export async function recentAIActivity(orgId: string, take = 20) {
  await assertPermission("intelligence.view");
  return db.aIAction.findMany({ where: { orgId }, orderBy: { createdAt: "desc" }, take });
}
