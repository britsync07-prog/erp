import "server-only";
import type { PrismaClient } from "@prisma/client";
import { db } from "@/server/db";
import { assertPermission } from "@/server/auth/permissions";
import { audit, notify } from "@/server/platform";
import { PERMISSIONS } from "@/domain/constants";
import { runTool } from "./tools";

// Event-driven automation engine (§24). Rules are data (AutomationRule rows),
// evaluated by triggers. v1 ships four default monitors that create genuinely
// new value (nothing duplicates service side-effects):
//   stock.low      → open purchase requirement (deduplicated)
//   invoice.overdue → WARNING digest to FINANCE (deduped daily)
//   po.late        → WARNING digest to PROCUREMENT (deduped daily)
//   order.stale    → waiting >3d digest to SALES (deduped daily)
// Rules can be toggled in Admin → Automation; the builder UI follows later.

export const DEFAULT_RULES = [
  { name: "Low stock opens a purchase requirement", trigger: "stock.low", action: "create_requirement" },
  { name: "Overdue invoices alert finance", trigger: "invoice.overdue", action: "notify_finance" },
  { name: "Late supplier deliveries alert procurement", trigger: "po.late", action: "notify_procurement" },
  { name: "Stale waiting orders alert sales", trigger: "order.stale", action: "notify_sales" },
] as const;

export async function ensureDefaultRules(orgId: string, client: PrismaClient = db) {
  for (const r of DEFAULT_RULES) {
    const existing = await client.automationRule.findFirst({
      where: { orgId, name: r.name },
    });
    if (!existing) {
      await client.automationRule.create({
        data: { orgId, name: r.name, trigger: r.trigger, action: r.action, isEnabled: true },
      });
    }
  }
}

export async function listRules(orgId: string) {
  await assertPermission("intelligence.manage");
  await ensureDefaultRules(orgId);
  return db.automationRule.findMany({ where: { orgId }, orderBy: { name: "asc" } });
}

export async function setRuleEnabled(
  actor: { id: string; name: string; orgId: string },
  id: string,
  enabled: boolean,
) {
  const me = await assertPermission("intelligence.manage");
  const rule = await db.automationRule.findFirst({ where: { id, orgId: actor.orgId } });
  if (!rule) throw new Error("This automation rule was not found.");
  await db.automationRule.update({ where: { id }, data: { isEnabled: enabled } });
  await audit({
    orgId: actor.orgId,
    action: enabled ? "AUTOMATION_ENABLE" : "AUTOMATION_DISABLE",
    entityType: "AUTOMATION_RULE",
    entityId: id,
    actor: me,
    source: "USER",
  });
}

async function recentlyNotified(
  client: PrismaClient,
  orgId: string,
  titlePrefix: string,
  hours = 20,
): Promise<boolean> {
  const since = new Date(Date.now() - hours * 3600000);
  const existing = await client.notification.findFirst({
    where: { orgId, title: { startsWith: titlePrefix }, createdAt: { gte: since } },
  });
  return !!existing;
}

export interface MonitorResult {
  requirements: number;
  notifications: string[];
  skipped: string[];
}

/**
 * Run all enabled monitors. Safe to run on a schedule: every effect is
 * deduplicated (open requirements, 20h notification window).
 */
export async function runMonitor(
  orgId: string,
  client: PrismaClient = db,
  actorName = "automation",
): Promise<MonitorResult> {
  await ensureDefaultRules(orgId, client);
  const rules = await client.automationRule.findMany({ where: { orgId, isEnabled: true } });
  const enabled = new Set(rules.map((r) => r.trigger));
  const result: MonitorResult = { requirements: 0, notifications: [], skipped: [] };
  const actor = { id: "system", name: actorName, orgId };
  const ctx = { orgId, userId: "system", permissions: [...PERMISSIONS] as readonly string[], client };

  if (enabled.has("stock.low")) {
    try {
      const rows = (await runTool(ctx, "stock_risks", {})) as {
        productId?: string; sku: string; suggestedTopUp: number; reason?: string;
      }[];
      // stock_risks rows carry productId (added in Phase 10).
      for (const row of Array.isArray(rows) ? rows : []) {
        if (!row.productId || !(row.suggestedTopUp > 0)) continue;
        const existing = await client.purchaseRequirement.findFirst({
          where: { productId: row.productId, status: "OPEN" },
        });
        if (existing) continue;
        const product = await client.product.findUnique({ where: { id: row.productId } });
        if (!product) continue;
        await client.purchaseRequirement.create({
          data: {
            productId: product.id,
            requiredQty: row.suggestedTopUp,
            reason: `Automation (stock.low): ${product.sku} below reorder point.`,
            status: "OPEN",
            createdBy: "SYSTEM",
          },
        });
        result.requirements++;
      }
    } catch {
      result.skipped.push("stock.low");
    }
  }

  if (enabled.has("invoice.overdue")) {
    const overdue = await client.invoice.findMany({
      where: {
        customer: { organisationId: orgId },
        status: { in: ["ISSUED", "PARTIAL"] },
        dueDate: { lt: new Date() },
      },
      include: { customer: { select: { company: true } } },
      take: 200,
    });
    const open = overdue.filter((i) => i.totalCents - i.paidCents > 0);
    if (open.length > 0 && !(await recentlyNotified(client, orgId, "Overdue invoices"))) {
      const total = open.reduce((s, i) => s + (i.totalCents - i.paidCents), 0);
      const title = `Overdue invoices: ${open.length} open (€${(total / 100).toFixed(2)})`;
      await notify({
        orgId, severity: "WARNING", roleCode: "FINANCE", title,
        body: open.slice(0, 5).map((i) => `${i.number} · ${i.customer.company}`).join("; "),
        link: "/finance?overdue=1", client,
      });
      result.notifications.push(title);
    }
  }

  if (enabled.has("po.late")) {
    const late = await client.purchaseOrder.findMany({
      where: {
        supplier: { organisationId: orgId },
        status: { in: ["SENT", "SUPPLIER_CONFIRMED", "PARTIALLY_RECEIVED"] },
        expectedDate: { lt: new Date() },
      },
      include: { supplier: { select: { company: true } } },
      take: 100,
    });
    if (late.length > 0 && !(await recentlyNotified(client, orgId, "Late supplier deliveries"))) {
      const title = `Late supplier deliveries: ${late.length} purchase orders`;
      await notify({
        orgId, severity: "WARNING", roleCode: "PROCUREMENT", title,
        body: late.slice(0, 5).map((p) => `${p.number} · ${p.supplier.company}`).join("; "),
        link: "/inventory/receiving", client,
      });
      result.notifications.push(title);
    }
  }

  if (enabled.has("order.stale")) {
    const cutoff = new Date(Date.now() - 3 * 86400000);
    const stale = await client.salesOrder.findMany({
      where: {
        customer: { organisationId: orgId },
        status: "WAITING_FOR_STOCK",
        createdAt: { lt: cutoff },
      },
      take: 100,
    });
    if (stale.length > 0 && !(await recentlyNotified(client, orgId, "Stale waiting orders"))) {
      const title = `Stale waiting orders: ${stale.length} blocked over 3 days`;
      await notify({
        orgId, severity: "WARNING", roleCode: "SALES", title,
        body: stale.slice(0, 5).map((o) => o.number).join(", "),
        link: "/orders?status=WAITING_FOR_STOCK", client,
      });
      result.notifications.push(title);
    }
  }

  await audit({
    orgId,
    action: "AUTOMATION_RUN",
    entityType: "AUTOMATION",
    entityId: "monitor",
    newValue: { requirements: result.requirements, notifications: result.notifications.length, skipped: result.skipped },
    actor,
    source: "AUTOMATION",
    client,
  });
  return result;
}
