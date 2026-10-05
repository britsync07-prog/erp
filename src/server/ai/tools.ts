import "server-only";
import type { PrismaClient } from "@prisma/client";
import { db } from "@/server/db";
import type { Permission } from "@/domain/constants";
import { financeStats } from "@/server/services/finance";
import { levelsFromAggregates } from "@/domain/stock";
import { calculateReorderRequirement } from "@/domain/procurement";

// Governed read-only tools (§21). Every tool is org-scoped and declares the
// permissions a caller must hold; the runner hides tools the user may not see
// (§38: what the UI hides, the AI must not reveal either). Tools return small
// JSON evidence blobs — aggregates and links, never credentials or secrets.

export interface ToolCtx {
  orgId: string;
  userId: string;
  permissions: readonly string[];
  /** Isolated client for tests; production callers omit it (shared db). */
  client?: PrismaClient;
}

function dbFor(ctx: ToolCtx): PrismaClient {
  return ctx.client ?? db;
}

export interface AITool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  requires: Permission[];
  run: (ctx: ToolCtx, args: Record<string, unknown>) => Promise<unknown>;
}

const NO_ARGS = { type: "object", properties: {}, additionalProperties: false };

function truncate(value: unknown, maxChars = 6000): unknown {
  const text = JSON.stringify(value);
  if (text.length <= maxChars) return value;
  return { truncated: true, preview: text.slice(0, maxChars) };
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

export const AI_TOOLS: AITool[] = [
  {
    name: "operations_attention",
    description: "Counts of what needs attention: orders today/waiting/ready, pending approvals, overdue purchase orders.",
    parameters: NO_ARGS,
    requires: ["orders.view"],
    run: async (ctx) => {
      const c = dbFor(ctx);
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const scope = { customer: { organisationId: ctx.orgId } };
      const [today, waiting, ready] = await Promise.all([
        c.salesOrder.count({ where: { ...scope, createdAt: { gte: start } } }),
        c.salesOrder.count({ where: { ...scope, status: "WAITING_FOR_STOCK" } }),
        c.salesOrder.count({ where: { ...scope, status: "READY" } }),
      ]);
      const [approvals, receiving] = await Promise.all([
        c.approvalRequest.count({ where: { orgId: ctx.orgId, status: "PENDING" } }),
        c.purchaseOrder.count({
          where: {
            supplier: { organisationId: ctx.orgId },
            status: { in: ["SENT", "SUPPLIER_CONFIRMED", "PARTIALLY_RECEIVED"] },
          },
        }),
      ]);
      const overduePOs = await c.purchaseOrder.count({
        where: {
          supplier: { organisationId: ctx.orgId },
          status: { in: ["SENT", "SUPPLIER_CONFIRMED", "PARTIALLY_RECEIVED"] },
          expectedDate: { lt: new Date() },
        },
      });
      return {
        orders: { today, waiting, ready },
        pendingApprovals: approvals,
        overduePurchaseOrders: overduePOs,
        incomingPurchaseOrders: receiving,
      };
    },
  },
  {
    name: "stock_risks",
    description: "Products below reorder point with available stock and suggested top-up quantities.",
    parameters: NO_ARGS,
    requires: ["inventory.view"],
    run: async (ctx) => {
      const c = dbFor(ctx);
      const products = await c.product.findMany({
        where: { organisationId: ctx.orgId, status: "ACTIVE" },
        orderBy: { name: "asc" },
      });
      const ids = products.map((p) => p.id);
      const [movements, reservations, openReqs] = await Promise.all([
        c.inventoryMovement.groupBy({ by: ["productId"], where: { productId: { in: ids } }, _sum: { quantity: true } }),
        c.inventoryReservation.groupBy({ by: ["productId"], where: { productId: { in: ids } }, _sum: { quantity: true } }),
        c.purchaseRequirement.findMany({ where: { productId: { in: ids }, status: "OPEN" }, select: { productId: true } }),
      ]);
      const openSet = new Set(openReqs.map((r) => r.productId));
      const out = [];
      for (const p of products) {
        const stock = levelsFromAggregates(
          movements.find((m) => m.productId === p.id)?._sum.quantity ?? 0,
          reservations.find((r) => r.productId === p.id)?._sum.quantity ?? 0,
          0,
        );
        if (stock.available >= p.reorderPoint) continue;
        const calc = calculateReorderRequirement({
          available: stock.available, incoming: 0, outstandingDemand: stock.reserved,
          safetyStock: p.safetyStock, forecastDemand: 0, minOrderQtyBase: 0, packSizeBase: 1,
        });
        out.push({
          sku: p.sku,
          name: p.name,
          productId: p.id,
          available: stock.available,
          reorderPoint: p.reorderPoint,
          suggestedTopUp: calc.recommendedQty,
          hasOpenRequirement: openSet.has(p.id),
          link: `/products/${p.id}`,
        });
        if (out.length >= 12) break;
      }
      return out;
    },
  },
  {
    name: "product_demand",
    description: "Top products by ordered quantity and revenue over the last 30 days (excludes drafts and cancelled orders).",
    parameters: NO_ARGS,
    requires: ["orders.view"],
    run: async (ctx) => {
      const lines = await dbFor(ctx).salesOrderLine.findMany({
        where: {
          order: { customer: { organisationId: ctx.orgId }, createdAt: { gte: daysAgo(30) }, status: { notIn: ["DRAFT", "CANCELLED"] } },
        },
        include: { product: { select: { sku: true, name: true } } },
        take: 2000,
      });
      const byProduct = new Map<string, { sku: string; name: string; qty: number; revenueCents: number }>();
      for (const l of lines) {
        const cur = byProduct.get(l.productId) ?? { sku: l.product.sku, name: l.product.name, qty: 0, revenueCents: 0 };
        cur.qty += l.quantity;
        cur.revenueCents += Math.round(l.quantity * l.unitPriceCents);
        byProduct.set(l.productId, cur);
      }
      const top = [...byProduct.entries()]
        .map(([productId, v]) => ({ productId, ...v, qty: Math.round(v.qty * 1000) / 1000, link: `/products/${productId}` }))
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 10);
      return { top, totalRevenueCents: top.reduce((s, t) => s + t.revenueCents, 0) };
    },
  },
  {
    name: "receivables_snapshot",
    description: "Outstanding receivables, overdue count, and the top 5 debtor customers.",
    parameters: NO_ARGS,
    requires: ["finance.view"],
    run: async (ctx) => {
      const c = dbFor(ctx);
      const stats = await financeStats(ctx.orgId, c);
      const open = await c.invoice.findMany({
        where: { customer: { organisationId: ctx.orgId }, status: { in: ["ISSUED", "PARTIAL"] } },
        include: { customer: { select: { id: true, company: true } } },
        take: 500,
      });
      const byCustomer = new Map<string, { company: string; balance: number; link: string }>();
      for (const i of open) {
        const cur = byCustomer.get(i.customerId) ?? { company: i.customer.company, balance: 0, link: `/customers/${i.customerId}` };
        cur.balance += i.totalCents - i.paidCents;
        byCustomer.set(i.customerId, cur);
      }
      const top = [...byCustomer.values()].sort((a, b) => b.balance - a.balance).slice(0, 5);
      return { outstandingCents: stats.outstanding, overdueCount: stats.overdueCount, topDebtors: top, receivablesLink: "/finance/receivables" };
    },
  },
  {
    name: "supplier_performance",
    description: "Supplier reliability: order volumes, spend, late deliveries and average delay days.",
    parameters: NO_ARGS,
    requires: ["procurement.view"],
    run: async (ctx) => {
      const suppliers = await dbFor(ctx).supplier.findMany({
        where: { organisationId: ctx.orgId, status: "ACTIVE" },
        include: {
          purchaseOrders: {
            orderBy: { createdAt: "desc" },
            take: 50,
            include: { receipts: { select: { receivedAt: true } } },
          },
        },
        take: 20,
      });
      return suppliers
        .filter((s) => s.purchaseOrders.length > 0)
        .map((s) => {
          let late = 0;
          let delaySum = 0;
          for (const po of s.purchaseOrders) {
            const firstReceipt = po.receipts.map((r) => r.receivedAt.getTime()).sort()[0];
            if (firstReceipt && po.expectedDate && firstReceipt > po.expectedDate.getTime()) {
              late++;
              delaySum += Math.round((firstReceipt - po.expectedDate.getTime()) / 86400000);
            }
          }
          return {
            company: s.company,
            purchaseOrders: s.purchaseOrders.length,
            spendCents: s.purchaseOrders.reduce((sum, po) => sum + po.totalCents, 0),
            lateDeliveries: late,
            avgDelayDays: late > 0 ? Math.round((delaySum / late) * 10) / 10 : 0,
            link: `/suppliers/${s.id}`,
          };
        })
        .sort((a, b) => b.spendCents - a.spendCents)
        .slice(0, 10);
    },
  },
  {
    name: "margin_snapshot",
    description: "Overall gross margin plus the weakest-margin products.",
    parameters: NO_ARGS,
    requires: ["finance.view"],
    run: async (ctx) => {
      const c = dbFor(ctx);
      const [orders, products] = await Promise.all([
        c.salesOrder.findMany({
          where: { customer: { organisationId: ctx.orgId }, status: { in: ["DELIVERED", "INVOICED", "PAID"] } },
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
        c.product.findMany({
          where: { organisationId: ctx.orgId, status: "ACTIVE" },
          select: { id: true, sku: true, costCents: true, standardPriceCents: true },
        }),
      ]);
      const revenue = orders.reduce((s, o) => s + (o.totalCents - o.taxCents), 0);
      const cost = orders.reduce((s, o) => s + o.costCents, 0);
      const weakest = products
        .map((p) => ({
          sku: p.sku,
          marginPct: p.standardPriceCents > 0 ? Math.round(((p.standardPriceCents - p.costCents) / p.standardPriceCents) * 1000) / 10 : 0,
          link: `/products/${p.id}`,
        }))
        .sort((a, b) => a.marginPct - b.marginPct)
        .slice(0, 5);
      return {
        revenueCents: revenue,
        costCents: cost,
        marginCents: revenue - cost,
        marginPct: revenue > 0 ? Math.round(((revenue - cost) / revenue) * 1000) / 10 : 0,
        weakestProducts: weakest,
        marginsLink: "/finance/margins",
      };
    },
  },
  {
    name: "customer_highlights",
    description: "New customers in the last 30 days and top customers by recent order revenue.",
    parameters: NO_ARGS,
    requires: ["customers.view"],
    run: async (ctx) => {
      const c = dbFor(ctx);
      const [recent, orders] = await Promise.all([
        db.customer.findMany({
          where: { organisationId: ctx.orgId, createdAt: { gte: daysAgo(30) } },
          select: { company: true },
          take: 20,
        }),
        c.salesOrder.findMany({
          where: {
            customer: { organisationId: ctx.orgId },
            createdAt: { gte: daysAgo(30) },
            status: { notIn: ["DRAFT", "CANCELLED"] },
          },
          include: { customer: { select: { id: true, company: true } } },
          take: 1000,
        }),
      ]);
      const byCustomer = new Map<string, { company: string; revenueCents: number; orders: number; link: string }>();
      for (const o of orders) {
        const cur = byCustomer.get(o.customerId) ?? { company: o.customer.company, revenueCents: 0, orders: 0, link: `/customers/${o.customerId}` };
        cur.revenueCents += o.totalCents;
        cur.orders++;
        byCustomer.set(o.customerId, cur);
      }
      return {
        newCustomers30d: recent.length,
        topCustomers: [...byCustomer.values()].sort((a, b) => b.revenueCents - a.revenueCents).slice(0, 5),
      };
    },
  },
];

/** Tools visible to this caller. Unknown names never reach the model. */
export function toolsFor(permissions: readonly string[]): AITool[] {
  return AI_TOOLS.filter((t) => t.requires.some((p) => permissions.includes(p)));
}

export async function runTool(ctx: ToolCtx, name: string, args: Record<string, unknown>): Promise<unknown> {
  const tool = AI_TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}.`);
  if (!tool.requires.some((p) => ctx.permissions.includes(p))) {
    throw new Error("You do not have permission to use this data.");
  }
  return truncate(await tool.run(ctx, args));
}
