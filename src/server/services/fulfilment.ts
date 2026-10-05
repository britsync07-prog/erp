import "server-only";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { db } from "@/server/db";
import { assertPermission } from "@/server/auth/permissions";
import { audit, activity, notify } from "@/server/platform";
import { assertTransition } from "@/domain/orders";
import { validatePickQuantity, isFullyPicked, validateReturnQuantity, returnableQty } from "@/domain/fulfilment";
import { PAGE_SIZE, paged, type Actor } from "./util";

// Warehouse screens deliberately exclude money: pickers see what/where/how
// many — never prices, margins or customer balances (§16).

const ACTIVE_FULFILMENT = ["NEW", "WAITING_FOR_STOCK", "READY_TO_PICK", "PICKING", "READY_TO_DISPATCH", "DISPATCHED"] as const;

export async function fulfilmentBoard(orgId: string) {
  await assertPermission("orders.view");
  const items = await db.fulfilment.findMany({
    where: { order: { customer: { organisationId: orgId } }, status: { in: [...ACTIVE_FULFILMENT] } },
    orderBy: { createdAt: "asc" },
    include: {
      order: { select: { id: true, number: true, status: true, requestedDate: true, customer: { select: { company: true } } } },
      lines: { include: { product: { select: { sku: true, name: true, salesUnit: true } } } },
    },
  });
  const groups: Record<string, typeof items> = {
    WAITING_FOR_STOCK: [],
    READY_TO_PICK: [],
    PICKING: [],
    READY_TO_DISPATCH: [],
    DISPATCHED: [],
    NEW: [],
  };
  for (const f of items) (groups[f.status] ?? groups.NEW).push(f);
  return groups;
}

export async function getFulfilment(orgId: string, id: string) {
  await assertPermission("orders.view");
  const fulfilment = await db.fulfilment.findFirst({
    where: { id, order: { customer: { organisationId: orgId } } },
    include: {
      order: { include: { customer: true, lines: true } },
      lines: { include: { product: true } },
      shipments: { orderBy: { shippedAt: "desc" } },
    },
  });
  if (!fulfilment) throw new Error("This fulfilment was not found.");
  const returns = await db.salesReturn.findMany({
    where: { orderId: fulfilment.orderId },
    include: { lines: { include: { product: { select: { sku: true } } } } },
    orderBy: { createdAt: "desc" },
  });
  return { fulfilment, returns };
}

async function loadFulfilment(client: PrismaClient, orgId: string, id: string) {
  const f = await client.fulfilment.findFirst({
    where: { id, order: { customer: { organisationId: orgId } } },
    include: { order: { include: { lines: true } }, lines: { include: { product: true } } },
  });
  if (!f) throw new Error("This fulfilment was not found.");
  return f;
}

export async function startPickingCore(client: PrismaClient, orgId: string, actor: Actor, id: string) {
  const f = await loadFulfilment(client, orgId, id);
  if (f.status !== "READY_TO_PICK") throw new Error("Only orders ready to pick can start picking.");
  await client.fulfilment.update({ where: { id }, data: { status: "PICKING" } });
  await audit({ orgId, action: "PICK_START", entityType: "FULFILMENT", entityId: id, actor, client });
  await activity({ orgId, entityType: "ORDER", entityId: f.orderId, message: `Picking started for ${f.order.number}.`, actor, client });
}

export async function startPicking(actor: Actor, id: string) {
  const me = await assertPermission("inventory.manage");
  await startPickingCore(db, actor.orgId, me, id);
}

const PickSchema = z.object({
  picks: z.array(z.object({
    productId: z.string().min(1),
    pickedQty: z.coerce.number().min(0),
  })).min(1),
});

export async function confirmPickCore(client: PrismaClient, orgId: string, actor: Actor, id: string, raw: unknown) {
  const { picks } = PickSchema.parse(raw);
  const f = await loadFulfilment(client, orgId, id);
  if (f.status !== "PICKING") throw new Error("Start picking before confirming picked quantities.");
  const byProduct = new Map(f.lines.map((l) => [l.productId, l]));
  for (const p of picks) {
    const line = byProduct.get(p.productId);
    if (!line) throw new Error("Unknown product in pick confirmation.");
    validatePickQuantity(line.requiredQty, p.pickedQty);
  }
  for (const p of picks) {
    const line = byProduct.get(p.productId)!;
    await client.fulfilmentLine.update({ where: { id: line.id }, data: { pickedQty: p.pickedQty } });
  }
  const refreshed = await client.fulfilmentLine.findMany({ where: { fulfilmentId: id } });
  const complete = isFullyPicked(refreshed);
  if (complete) {
    await client.fulfilment.update({ where: { id }, data: { status: "READY_TO_DISPATCH" } });
  }
  await audit({ orgId, action: "PICK_CONFIRM", entityType: "FULFILMENT", entityId: id, newValue: { complete }, actor, client });
  await activity({
    orgId, entityType: "ORDER", entityId: f.orderId,
    message: complete ? `Picking complete for ${f.order.number} — ready to dispatch.` : `Pick progress saved for ${f.order.number}.`,
    actor, client,
  });
  return complete;
}

export async function confirmPick(actor: Actor, id: string, raw: unknown) {
  const me = await assertPermission("inventory.manage");
  return confirmPickCore(db, actor.orgId, me, id, raw);
}

export async function dispatchCore(
  client: PrismaClient,
  orgId: string,
  actor: Actor,
  id: string,
  opts: { carrier?: string; tracking?: string },
) {
  const f = await loadFulfilment(client, orgId, id);
  if (f.status !== "READY_TO_DISPATCH") throw new Error("Only fully picked orders can be dispatched.");
  if (f.order.status !== "READY") throw new Error(`Order ${f.order.number} is ${f.order.status}, not ready.`);
  if (!isFullyPicked(f.lines)) throw new Error("All lines must be fully picked before dispatch.");
  assertTransition(f.order.status, "DISPATCHED");

  const reservations = await client.inventoryReservation.findMany({ where: { orderId: f.orderId } });
  const warehouseByProduct = new Map<string, string>();
  for (const r of reservations) {
    if (!warehouseByProduct.has(r.productId)) warehouseByProduct.set(r.productId, r.warehouseId);
  }
  const fallback = warehouseByProduct.values().next().value as string | undefined;
  if (!fallback) throw new Error("No reservations found for this order.");

  await client.$transaction(async (tx) => {
    for (const line of f.lines) {
      await tx.inventoryMovement.create({
        data: {
          productId: line.productId,
          warehouseId: warehouseByProduct.get(line.productId) ?? fallback,
          quantity: -line.requiredQty,
          type: "SALE_DISPATCH",
          reference: f.order.number,
          note: `Dispatch ${f.order.number}${opts.carrier ? ` via ${opts.carrier}` : ""}`,
          actorId: actor.id,
          actorName: actor.name,
        },
      });
    }
    for (const ol of f.order.lines) {
      await tx.salesOrderLine.update({ where: { id: ol.id }, data: { fulfilledQty: ol.quantity } });
    }
    await tx.inventoryReservation.deleteMany({ where: { orderId: f.orderId } });
    await tx.salesOrder.update({ where: { id: f.orderId }, data: { status: "DISPATCHED" } });
    await tx.fulfilment.update({ where: { id }, data: { status: "DISPATCHED" } });
    await tx.shipment.create({
      data: {
        fulfilmentId: id,
        carrier: opts.carrier?.trim() || null,
        tracking: opts.tracking?.trim() || null,
        shippedAt: new Date(),
      },
    });
  }, { timeout: 15000 });

  await audit({ orgId, action: "DISPATCH", entityType: "FULFILMENT", entityId: id, actor, client });
  await activity({ orgId, entityType: "ORDER", entityId: f.orderId, message: `Order ${f.order.number} dispatched${opts.tracking ? ` (tracking ${opts.tracking})` : ""}.`, actor, client });
  await notify({ orgId, severity: "INFO", roleCode: "SALES", title: `Order ${f.order.number} dispatched`, link: `/orders/${f.orderId}`, client });
}

export async function dispatchOrder(actor: Actor, id: string, opts: { carrier?: string; tracking?: string }) {
  const me = await assertPermission("inventory.manage");
  await dispatchCore(db, actor.orgId, me, id, opts);
}

export async function markDeliveredCore(client: PrismaClient, orgId: string, actor: Actor, id: string) {
  const f = await loadFulfilment(client, orgId, id);
  if (f.status !== "DISPATCHED") throw new Error("Only dispatched orders can be marked delivered.");
  assertTransition(f.order.status, "DELIVERED");
  await client.$transaction([
    client.shipment.updateMany({ where: { fulfilmentId: id, deliveredAt: null }, data: { deliveredAt: new Date() } }),
    client.fulfilment.update({ where: { id }, data: { status: "DELIVERED" } }),
    client.salesOrder.update({ where: { id: f.orderId }, data: { status: "DELIVERED" } }),
  ]);
  await audit({ orgId, action: "DELIVER", entityType: "FULFILMENT", entityId: id, actor, client });
  await activity({ orgId, entityType: "ORDER", entityId: f.orderId, message: `Order ${f.order.number} delivered.`, actor, client });
  await notify({ orgId, severity: "INFO", roleCode: "SALES", title: `Order ${f.order.number} delivered`, link: `/orders/${f.orderId}`, client });
}

export async function markDelivered(actor: Actor, id: string) {
  const me = await assertPermission("inventory.manage");
  await markDeliveredCore(db, actor.orgId, me, id);
}

// ─── Returns ────────────────────────────────────────────────────────────────

export async function returnableForOrder(orgId: string, orderId: string) {
  await assertPermission("inventory.view");
  const order = await db.salesOrder.findFirst({
    where: { id: orderId, customer: { organisationId: orgId } },
    include: { customer: { select: { company: true, code: true } }, lines: { include: { product: true } } },
  });
  if (!order) throw new Error("This order was not found.");
  if (!["DELIVERED", "PARTIALLY_RETURNED", "INVOICED", "PAID"].includes(order.status)) {
    throw new Error("Only delivered (or invoiced/paid) orders can be returned.");
  }
  const returned = await db.salesReturnLine.groupBy({
    by: ["productId"],
    where: { ret: { orderId } },
    _sum: { quantity: true },
  });
  return {
    order,
    rows: order.lines.map((l) => {
      const alreadyReturnedQty = returned.find((r) => r.productId === l.productId)?._sum.quantity ?? 0;
      return {
        line: l,
        alreadyReturned: alreadyReturnedQty,
        returnable: returnableQty({ fulfilledQty: l.fulfilledQty, alreadyReturnedQty }),
      };
    }),
  };
}

const ReturnSchema = z.object({
  orderId: z.string().min(1),
  reason: z.string().trim().max(500).nullish(),
  lines: z.array(z.object({
    productId: z.string().min(1),
    quantity: z.coerce.number().positive("Return quantities must be positive."),
    condition: z.enum(["RESTOCK", "DAMAGED"]),
  })).min(1, "Add at least one return line."),
});

export async function createReturnCore(client: PrismaClient, orgId: string, actor: Actor, raw: unknown): Promise<string> {
  const data = ReturnSchema.parse(raw);
  const order = await client.salesOrder.findFirst({
    where: { id: data.orderId, customer: { organisationId: orgId } },
    include: { lines: true },
  });
  if (!order) throw new Error("This order was not found.");
  if (!["DELIVERED", "PARTIALLY_RETURNED", "INVOICED", "PAID"].includes(order.status)) {
    throw new Error("Only delivered (or invoiced/paid) orders can be returned.");
  }
  const returned = await client.salesReturnLine.groupBy({
    by: ["productId"],
    where: { ret: { orderId: order.id } },
    _sum: { quantity: true },
  });
  // Aggregate duplicate product rows before validating.
  const byProduct = new Map<string, { quantity: number; condition: string }>();
  for (const l of data.lines) {
    const cur = byProduct.get(l.productId) ?? { quantity: 0, condition: l.condition };
    if (cur.condition !== l.condition) throw new Error("Use one condition per product on a return.");
    cur.quantity += l.quantity;
    byProduct.set(l.productId, cur);
  }
  for (const [productId, agg] of byProduct) {
    const line = order.lines.find((l) => l.productId === productId);
    if (!line) throw new Error("All returned products must belong to this order.");
    validateReturnQuantity(
      {
        fulfilledQty: line.fulfilledQty,
        alreadyReturnedQty: returned.find((r) => r.productId === productId)?._sum.quantity ?? 0,
      },
      agg.quantity,
    );
  }

  const n = await client.salesReturn.count({ where: { order: { customer: { organisationId: orgId } } } });
  const code = `RET-${String(n + 1).padStart(4, "0")}`;
  const warehouse = await client.warehouse.findFirst({
    where: { organisationId: orgId, isDefault: true },
  }) ?? await client.warehouse.findFirst({ where: { organisationId: orgId }, orderBy: { code: "asc" } });
  if (!warehouse) throw new Error("Create a warehouse before processing returns.");

  const ret = await client.$transaction(async (tx) => {
    const created = await tx.salesReturn.create({
      data: { code, orderId: order.id, reason: data.reason?.trim() || null, status: "COMPLETED", createdById: actor.id },
    });
    for (const [productId, agg] of byProduct) {
      await tx.salesReturnLine.create({
        data: { returnId: created.id, productId, quantity: agg.quantity, condition: agg.condition },
      });
      if (agg.condition === "RESTOCK") {
        await tx.inventoryMovement.create({
          data: {
            productId, warehouseId: warehouse.id, quantity: agg.quantity,
            type: "CUSTOMER_RETURN", reference: code,
            note: `Customer return ${code} for order ${order.number}`,
            actorId: actor.id, actorName: actor.name,
          },
        });
      }
    }
    // Recompute: fully returned (any condition) → RETURNED, else partial.
    // Invoiced/paid orders keep their financial status — the credit note
    // carries the money, so we never rewrite INVOICED/PAID backwards.
    const statusOpen = order.status === "DELIVERED" || order.status === "PARTIALLY_RETURNED";
    const allReturned = await tx.salesReturnLine.groupBy({
      by: ["productId"], where: { ret: { orderId: order.id } }, _sum: { quantity: true },
    });
    const complete = order.lines.every((l) => {
      const back = allReturned.find((r) => r.productId === l.productId)?._sum.quantity ?? 0;
      return back + 1e-9 >= l.fulfilledQty;
    });
    if (statusOpen) {
      const next = complete ? "RETURNED" : "PARTIALLY_RETURNED";
      if (next !== order.status) {
        assertTransition(order.status, next);
        await tx.salesOrder.update({ where: { id: order.id }, data: { status: next } });
      }
    }
    return created;
  }, { timeout: 15000 });

  await audit({ orgId, action: "RETURN", entityType: "SALES_RETURN", entityId: ret.id, newValue: { code }, actor, client });
  await activity({ orgId, entityType: "ORDER", entityId: order.id, message: `Return ${code} completed (${data.reason?.trim() || "no reason given"}).`, actor, client });
  await notify({
    orgId, severity: "INFO", roleCode: "FINANCE",
    title: `Return ${code} may need a credit note`, body: `Order ${order.number}`, link: `/fulfilment/returns/${ret.id}`, client,
  });
  return ret.id;
}

export async function createReturn(actor: Actor, raw: unknown) {
  const me = await assertPermission("inventory.manage");
  return createReturnCore(db, actor.orgId, me, raw);
}

export async function listReturns(orgId: string, page = 1) {
  await assertPermission("orders.view");
  const where = { order: { customer: { organisationId: orgId } } };
  const [total, items] = await Promise.all([
    db.salesReturn.count({ where }),
    db.salesReturn.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { order: { select: { number: true, customer: { select: { company: true } } } }, _count: { select: { lines: true } } },
    }),
  ]);
  return paged(items, total, page);
}

export async function getReturn(orgId: string, id: string) {
  await assertPermission("orders.view");
  const ret = await db.salesReturn.findFirst({
    where: { id, order: { customer: { organisationId: orgId } } },
    include: { order: { include: { customer: true } }, lines: { include: { product: true } } },
  });
  if (!ret) throw new Error("This return was not found.");
  return ret;
}

export async function fulfilmentStats(orgId: string) {  const where = { order: { customer: { organisationId: orgId } } };
  const [toPick, toDispatch, inTransit] = await Promise.all([
    db.fulfilment.count({ where: { ...where, status: { in: ["READY_TO_PICK", "PICKING"] } } }),
    db.fulfilment.count({ where: { ...where, status: "READY_TO_DISPATCH" } }),
    db.fulfilment.count({ where: { ...where, status: "DISPATCHED" } }),
  ]);
  return { toPick, toDispatch, inTransit };
}

/** Delivered (or later) orders eligible for a new return. */
export async function deliveredOrderOptions(orgId: string) {
  await assertPermission("orders.view");
  return db.salesOrder.findMany({
    where: {
      customer: { organisationId: orgId },
      status: { in: ["DELIVERED", "PARTIALLY_RETURNED", "INVOICED", "PAID"] },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, number: true, customer: { select: { company: true } } },
  });
}
