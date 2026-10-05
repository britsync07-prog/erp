import "server-only";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { db } from "@/server/db";
import { assertPermission } from "@/server/auth/permissions";
import { audit, activity, notify } from "@/server/platform";
import { validateReceiptLine, receiptStatusFor } from "@/domain/receiving";
import { PAGE_SIZE, paged, type Actor } from "./util";
import { recheckOrderCore } from "./orders";

export const RECEIVABLE_PO = ["SENT", "SUPPLIER_CONFIRMED", "PARTIALLY_RECEIVED"] as const;

const ReceiptSchema = z.object({
  poId: z.string().min(1),
  lines: z
    .array(
      z.object({
        productId: z.string().min(1),
        receivedQty: z.coerce.number().min(0, "Received cannot be negative."),
        damagedQty: z.coerce.number().min(0, "Damaged cannot be negative.").default(0),
      }),
    )
    .min(1, "Enter at least one received line.")
    .max(200),
});

export interface ReceiveResult {
  receiptId: string;
  code: string;
  readyOrders: string[];
  overdelivered: string[];
}

/** POs awaiting (further) delivery, most overdue first — the warehouse work queue. */
export async function receivablePOs(orgId: string) {
  await assertPermission("inventory.view");
  const pos = await db.purchaseOrder.findMany({
    where: { supplier: { organisationId: orgId }, status: { in: [...RECEIVABLE_PO] } },
    include: { supplier: { select: { company: true } }, lines: true },
    orderBy: { expectedDate: "asc" },
  });
  const now = new Date();
  return pos
    .map((po) => {
      const remaining = po.lines.filter((l) => l.receivedQty + 1e-9 < l.quantity);
      return {
        po,
        remainingLines: remaining.length,
        remainingQty: remaining.reduce((s, l) => s + (l.quantity - l.receivedQty), 0),
        overdue: !!po.expectedDate && po.expectedDate < now,
      };
    })
    .filter((r) => r.remainingLines > 0)
    .sort((a, b) => Number(b.overdue) - Number(a.overdue));
}

export async function getReceivablePO(orgId: string, poId: string) {
  await assertPermission("inventory.view");
  const po = await db.purchaseOrder.findFirst({
    where: { id: poId, supplier: { organisationId: orgId } },
    include: { supplier: true, warehouse: true, lines: { include: { product: true } }, receipts: { orderBy: { receivedAt: "desc" } } },
  });
  if (!po) throw new Error("This purchase order was not found.");
  if (!(RECEIVABLE_PO as readonly string[]).includes(po.status)) {
    throw new Error(`This purchase order is ${po.status.replace(/_/g, " ")} and cannot be received.`);
  }
  return po;
}

export async function listReceipts(orgId: string, page = 1) {
  await assertPermission("inventory.view");
  const where = { po: { supplier: { organisationId: orgId } } };
  const [total, items] = await Promise.all([
    db.goodsReceipt.count({ where }),
    db.goodsReceipt.findMany({
      where,
      orderBy: { receivedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { po: { select: { number: true, supplier: { select: { company: true } } } }, warehouse: true, _count: { select: { lines: true } } },
    }),
  ]);
  return paged(items, total, page);
}

export async function getReceipt(orgId: string, id: string) {
  await assertPermission("inventory.view");
  const receipt = await db.goodsReceipt.findFirst({
    where: { id, po: { supplier: { organisationId: orgId } } },
    include: { po: { include: { supplier: true } }, warehouse: true, lines: { include: { product: true } } },
  });
  if (!receipt) throw new Error("This receipt was not found.");
  return receipt;
}

/**
 * Post a goods receipt. Auth-free core (wrapper authenticates; tests drive it).
 * One transaction: receipt rows → ledger movements (good stock only) → PO line
 * progress + status → waiting-order recalculation. Damaged goods are recorded
 * on the receipt but never enter sellable stock.
 */
export async function receiveGoodsCore(
  client: PrismaClient,
  orgId: string,
  actor: Actor,
  raw: unknown,
): Promise<ReceiveResult> {
  const data = ReceiptSchema.parse(raw);
  const outcome = await client.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findFirst({
      where: { id: data.poId, supplier: { organisationId: orgId } },
      include: { supplier: true, warehouse: true, lines: { include: { product: true } } },
    });
    if (!po) throw new Error("This purchase order was not found.");
    if (!(RECEIVABLE_PO as readonly string[]).includes(po.status)) {
      throw new Error(`This purchase order is ${po.status.replace(/_/g, " ")} and cannot be received.`);
    }
    if (!po.warehouse) throw new Error("This purchase order has no warehouse.");

    const byProduct = new Map(po.lines.map((l) => [l.productId, l]));
    if (data.lines.some((l) => !byProduct.has(l.productId))) {
      throw new Error("All received products must belong to this purchase order.");
    }
    const touched = data.lines.filter((l) => l.receivedQty > 0 || l.damagedQty > 0);
    if (touched.length === 0) throw new Error("Enter a received quantity for at least one line.");

    const n = await tx.goodsReceipt.count({ where: { poId: po.id } });
    const code = `GRF-${po.number.replace(/^PO-/, "")}-${n + 1}`;
    const receipt = await tx.goodsReceipt.create({
      data: {
        code,
        poId: po.id,
        warehouseId: po.warehouse.id,
        receivedById: actor.id,
      },
    });

    const overdelivered: string[] = [];
    for (const input of touched) {
      const line = byProduct.get(input.productId)!;
      const split = validateReceiptLine({
        orderedQty: line.quantity,
        alreadyReceivedQty: line.receivedQty,
        receivedQty: input.receivedQty,
        damagedQty: input.damagedQty,
      });
      await tx.goodsReceiptLine.create({
        data: {
          receiptId: receipt.id,
          productId: line.productId,
          expectedQty: Math.max(0, line.quantity - line.receivedQty),
          receivedQty: input.receivedQty,
          damagedQty: split.damagedQty,
        },
      });
      if (split.goodQty > 0) {
        const baseQty = Math.round(split.goodQty * line.product.conversionFactor * 1000) / 1000;
        await tx.inventoryMovement.create({
          data: {
            productId: line.productId,
            warehouseId: po.warehouse.id,
            quantity: baseQty,
            type: "PURCHASE_RECEIPT",
            reference: code,
            note: `Receipt ${code} for ${po.number}${split.overdeliveredBy > 0 ? ` (overdelivered by ${split.overdeliveredBy} ${line.product.purchaseUnit})` : ""}`,
            actorId: actor.id,
            actorName: actor.name,
          },
        });
      }
      await tx.purchaseOrderLine.update({
        where: { id: line.id },
        data: { receivedQty: Math.round((line.receivedQty + split.goodQty) * 100) / 100 },
      });
      if (split.overdeliveredBy > 0) overdelivered.push(line.product.sku);
    }

    const refreshed = await tx.purchaseOrderLine.findMany({ where: { poId: po.id } });
    const status = receiptStatusFor(refreshed.map((l) => ({ orderedQty: l.quantity, receivedQty: l.receivedQty })));
    await tx.purchaseOrder.update({ where: { id: po.id }, data: { status } });
    return { receiptId: receipt.id, code, overdelivered, productIds: touched.map((l) => l.productId) };
  }, { timeout: 15000 });

  await audit({ orgId, action: "RECEIVE", entityType: "GOODS_RECEIPT", entityId: outcome.receiptId, newValue: { code: outcome.code }, actor, client });
  await activity({
    orgId, entityType: "PURCHASE_ORDER", entityId: data.poId,
    message: `Goods received (${outcome.code})${outcome.overdelivered.length > 0 ? ` — overdelivery on ${outcome.overdelivered.join(", ")}` : ""}.`,
    actor, client,
  });

  // Recalculate every waiting order that needs the arrived products.
  const readyOrders: string[] = [];
  const waiting = await client.salesOrder.findMany({
    where: {
      customer: { organisationId: orgId },
      status: "WAITING_FOR_STOCK",
      lines: { some: { productId: { in: outcome.productIds } } },
    },
    select: { id: true, number: true },
  });
  for (const o of waiting) {
    try {
      const r = await recheckOrderCore(client, orgId, actor, o.id);
      if (r.status === "READY") {
        readyOrders.push(o.number);
        await notify({
          orgId, severity: "INFO", roleCode: "SALES",
          title: `Order ${o.number} is ready to pick`, body: `Stock arrived on ${outcome.code}.`, link: `/orders/${o.id}`, client,
        });
      }
    } catch {
      // One stuck order must never block the receipt or the other orders.
    }
  }
  await notify({
    orgId, severity: "INFO", roleCode: "PROCUREMENT",
    title: `Goods received (${outcome.code})`,
    body: readyOrders.length > 0 ? `${readyOrders.length} waiting order${readyOrders.length === 1 ? "" : "s"} now ready: ${readyOrders.join(", ")}` : "No waiting orders were unblocked.",
    link: `/procurement/${data.poId}`, client,
  });
  return { receiptId: outcome.receiptId, code: outcome.code, readyOrders, overdelivered: outcome.overdelivered };
}

export async function receiveGoods(actor: Actor, raw: unknown): Promise<ReceiveResult> {
  const me = await assertPermission("inventory.manage");
  return receiveGoodsCore(db, actor.orgId, me, raw);
}

export async function receivingStats(orgId: string) {
  const [incoming, overdue] = await Promise.all([
    db.purchaseOrder.count({ where: { supplier: { organisationId: orgId }, status: { in: [...RECEIVABLE_PO] } } }),
    db.purchaseOrder.count({
      where: {
        supplier: { organisationId: orgId },
        status: { in: [...RECEIVABLE_PO] },
        expectedDate: { lt: new Date() },
      },
    }),
  ]);
  return { incoming, overdue };
}
