import "server-only";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { db } from "@/server/db";
import { assertPermission } from "@/server/auth/permissions";
import { audit, activity, notify } from "@/server/platform";
import { allocateLines, computeOrderTotals, assertTransition } from "@/domain/orders";
import { resolvePrice, type PriceCandidate } from "@/domain/pricing";
import { PAGE_SIZE, pageOf, paged, type Actor } from "./util";
import { findDefaultWarehouse } from "./warehouses";

export class StockConflictError extends Error {
  constructor() {
    super("STOCK_CONFLICT");
    this.name = "StockConflictError";
  }
}

// Cores accept the shared PrismaClient (prod) or an isolated one (tests).
// Inside transactions we use the typed `tx` handle directly.

// ─── Listing & detail ───────────────────────────────────────────────────────

export async function listOrders(orgId: string, sp?: { q?: string; status?: string; customer?: string; page?: string | string[] }) {
  await assertPermission("orders.view");
  const q = (Array.isArray(sp?.q) ? sp?.q[0] : sp?.q)?.trim() ?? "";
  const status = Array.isArray(sp?.status) ? sp?.status[0] : sp?.status;
  const customerId = Array.isArray(sp?.customer) ? sp?.customer[0] : sp?.customer;
  const page = pageOf(sp as { page?: string });
  const where = {
    customer: { organisationId: orgId },
    ...(q ? { number: { contains: q } } : {}),
    ...(status ? { status } : {}),
    ...(customerId ? { customerId } : {}),
  };
  const [total, items] = await Promise.all([
    db.salesOrder.count({ where }),
    db.salesOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { customer: { select: { company: true, code: true } }, _count: { select: { lines: true } } },
    }),
  ]);
  return paged(items, total, page);
}

export async function getOrder(orgId: string, id: string) {
  await assertPermission("orders.view");
  const order = await db.salesOrder.findFirst({
    where: { id, customer: { organisationId: orgId } },
    include: {
      customer: true,
      lines: { include: { product: true } },
      fulfilments: { include: { lines: true } },
      invoices: { select: { id: true, number: true, status: true, totalCents: true }, orderBy: { createdAt: "desc" }, take: 5 },
    },
  });
  if (!order) throw new Error("This order was not found.");
  const [reservations, requirements, events] = await Promise.all([
    db.inventoryReservation.findMany({ where: { orderId: id } }),
    db.purchaseRequirement.findMany({ where: { orderId: id }, include: { product: { select: { sku: true, name: true } } } }),
    db.activityEvent.findMany({ where: { orgId, entityType: "ORDER", entityId: id }, orderBy: { createdAt: "desc" }, take: 40 }),
  ]);
  // Drafts show a live estimate (resolved now, not stored). Confirmed orders
  // show only their snapshotted prices — history is never re-resolved.
  let estimate: { unitPriceCents: number; source: string }[] | null = null;
  if (order.status === "DRAFT") {
    estimate = await Promise.all(
      order.lines.map((l) => resolveLinePrice(db as never, l.product, order.customer, l.quantity)),
    );
  }
  return { order, reservations, requirements, events, estimate };
}

export async function orderStats(orgId: string) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const where = { customer: { organisationId: orgId } };
  const [today, waiting, ready] = await Promise.all([
    db.salesOrder.count({ where: { ...where, createdAt: { gte: start } } }),
    db.salesOrder.count({ where: { ...where, status: "WAITING_FOR_STOCK" } }),
    db.salesOrder.count({ where: { ...where, status: "READY" } }),
  ]);
  return { today, waiting, ready };
}

// ─── Drafts ─────────────────────────────────────────────────────────────────

const DraftSchema = z.object({
  customerId: z.string().min(1, "Customer is required."),
  orderDate: z.string().optional(),
  requestedDate: z.string().optional(),
  deliveryAddress: z.string().trim().max(400).nullish(),
  paymentTerms: z.enum(["IMMEDIATE", "30_DAYS", "60_DAYS", "90_DAYS", "CUSTOM"]).optional(),
  internalNotes: z.string().trim().max(2000).nullish(),
  customerNotes: z.string().trim().max(2000).nullish(),
});

const LinesSchema = z.object({
  lines: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.coerce.number().positive("Quantities must be positive."),
        discountPct: z.coerce.number().min(0).max(100).default(0),
      }),
    )
    .min(1, "Add at least one order line.")
    .max(200, "Too many lines on one order."),
});

async function nextOrderNumber(client: PrismaClient, orgId: string): Promise<string> {
  const n = await client.salesOrder.count({ where: { customer: { organisationId: orgId } } } as never);
  return `ORD-${String((n as number) + 1).padStart(4, "0")}`;
}

function formatAddress(a: { street: string; postal: string | null; city: string; province: string | null; country: string } | null): string | null {
  if (!a) return null;
  return `${a.street}, ${a.postal ? a.postal + " " : ""}${a.city}${a.province ? ` (${a.province})` : ""}, ${a.country}`;
}

export async function createDraft(actor: Actor, raw: unknown) {
  const me = await assertPermission("orders.manage");
  const data = DraftSchema.parse(raw);
  const customer = await db.customer.findFirst({
    where: { id: data.customerId, organisationId: actor.orgId },
    include: { addresses: { where: { kind: "DELIVERY" }, orderBy: { isDefault: "desc" } } },
  });
  if (!customer) throw new Error("The selected customer was not found.");
  if (customer.status !== "ACTIVE") throw new Error("This customer is not active.");

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const order = await db.salesOrder.create({
        data: {
          number: await nextOrderNumber(db as never, actor.orgId),
          customerId: customer.id,
          status: "DRAFT",
          orderDate: data.orderDate ? new Date(data.orderDate) : new Date(),
          requestedDate: data.requestedDate ? new Date(data.requestedDate) : null,
          deliveryAddress: data.deliveryAddress?.trim() || formatAddress(customer.addresses[0] ?? null),
          paymentTerms: data.paymentTerms ?? customer.paymentTerms,
          internalNotes: data.internalNotes?.trim() || null,
          customerNotes: data.customerNotes?.trim() || null,
          createdById: me.id,
        },
      });
      await audit({ orgId: actor.orgId, action: "CREATE", entityType: "ORDER", entityId: order.id, newValue: { number: order.number }, actor: me });
      await activity({ orgId: actor.orgId, entityType: "ORDER", entityId: order.id, message: `Draft order ${order.number} created for ${customer.company}.`, actor: me });
      return order.id;
    } catch (e) {
      if (e instanceof Error && e.message.includes("P2002") && attempt < 4) continue;
      throw e;
    }
  }
  throw new Error("Could not assign an order number. Please try again.");
}

export async function setDraftLines(actor: Actor, orderId: string, raw: unknown) {
  const me = await assertPermission("orders.manage");
  const { lines } = LinesSchema.parse(raw);
  const order = await db.salesOrder.findFirst({
    where: { id: orderId, customer: { organisationId: actor.orgId } },
    include: { lines: true },
  });
  if (!order) throw new Error("This order was not found.");
  if (order.status !== "DRAFT") throw new Error("Only draft orders can be edited.");
  const products = await db.product.findMany({
    where: { id: { in: lines.map((l) => l.productId) }, organisationId: actor.orgId },
  });
  if (products.length !== new Set(lines.map((l) => l.productId)).size) {
    throw new Error("One or more selected products were not found.");
  }
  for (const p of products) {
    if (p.status !== "ACTIVE") throw new Error(`Product ${p.sku} is not active.`);
  }
  await db.$transaction([
    db.salesOrderLine.deleteMany({ where: { orderId } }),
    db.salesOrderLine.createMany({
      data: lines.map((l) => ({
        orderId,
        productId: l.productId,
        quantity: l.quantity,
        unitPriceCents: 0, // priced (snapshotted) at confirm; drafts show live estimates
        discountPct: l.discountPct,
        taxRate: products.find((p) => p.id === l.productId)?.vatRate ?? 22,
      })),
    }),
  ]);
  await audit({ orgId: actor.orgId, action: "LINES_SET", entityType: "ORDER", entityId: orderId, newValue: { lines: lines.length }, actor: me });
}

export async function updateDraft(actor: Actor, orderId: string, raw: unknown) {
  const me = await assertPermission("orders.manage");
  const data = DraftSchema.partial().omit({ customerId: true }).parse(raw);
  const order = await db.salesOrder.findFirst({ where: { id: orderId, customer: { organisationId: actor.orgId } } });
  if (!order) throw new Error("This order was not found.");
  if (order.status !== "DRAFT") throw new Error("Only draft orders can be edited.");
  await db.salesOrder.update({
    where: { id: orderId },
    data: {
      orderDate: data.orderDate ? new Date(data.orderDate) : undefined,
      requestedDate: data.requestedDate === "" ? null : data.requestedDate ? new Date(data.requestedDate) : undefined,
      deliveryAddress: data.deliveryAddress !== undefined ? data.deliveryAddress?.trim() || null : undefined,
      paymentTerms: data.paymentTerms,
      internalNotes: data.internalNotes !== undefined ? data.internalNotes?.trim() || null : undefined,
      customerNotes: data.customerNotes !== undefined ? data.customerNotes?.trim() || null : undefined,
    },
  });
  await audit({ orgId: actor.orgId, action: "UPDATE", entityType: "ORDER", entityId: orderId, actor: me });
}

export async function deleteDraft(actor: Actor, orderId: string) {
  const me = await assertPermission("orders.manage");
  const order = await db.salesOrder.findFirst({ where: { id: orderId, customer: { organisationId: actor.orgId } } });
  if (!order) throw new Error("This order was not found.");
  if (order.status !== "DRAFT") throw new Error("Only draft orders can be deleted.");
  await db.salesOrder.delete({ where: { id: orderId } });
  await audit({ orgId: actor.orgId, action: "DELETE", entityType: "ORDER", entityId: orderId, oldValue: { number: order.number }, actor: me });
}

// ─── Pricing (resolved live for drafts, snapshotted at confirm) ─────────────

async function resolveLinePrice(
  client: Pick<PrismaClient, "productPrice" | "customerPrice">,
  product: { id: string; standardPriceCents: number },
  customer: { id: string; priceGroup: string | null },
  quantity: number,
): Promise<{ unitPriceCents: number; source: string }> {
  const now = new Date();
  const [rules, customs] = await Promise.all([
    client.productPrice.findMany({
      where: { productId: product.id, validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gte: now } }] },
    }) as Promise<{ kind: string; priceCents: number; minQty: number; priceGroup: string | null; validFrom: Date; validTo: Date | null }[]>,
    client.customerPrice.findMany({
      where: { productId: product.id, customerId: customer.id, validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gte: now } }] },
    }) as Promise<{ priceCents: number; minQty: number; validFrom: Date; validTo: Date | null }[]>,
  ]);
  const candidates: PriceCandidate[] = [
    ...rules
      .filter((r) => ["GROUP", "PROMO", "CONTRACT"].includes(r.kind))
      .map((r) => ({
        kind: r.kind as PriceCandidate["kind"],
        priceCents: r.priceCents,
        minQty: r.minQty,
        priceGroup: r.priceGroup,
        validFrom: r.validFrom,
        validTo: r.validTo,
      })),
    ...customs.map((c) => ({
      kind: "CUSTOMER" as const,
      priceCents: c.priceCents,
      minQty: c.minQty,
      validFrom: c.validFrom,
      validTo: c.validTo,
      customerId: customer.id,
    })),
  ];
  const r = resolvePrice(product.standardPriceCents, candidates, {
    customerId: customer.id,
    customerPriceGroup: customer.priceGroup,
    quantity,
    at: now,
  });
  return { unitPriceCents: r.priceCents, source: r.source };
}

// ─── Confirm (the guarded transaction) ──────────────────────────────────────

export interface ConfirmResult {
  status: string;
  allocated: number;
  shortage: number;
}

/**
 * Core confirm transaction WITHOUT auth — the permission-checked wrapper and
 * the concurrency integration test both call this. Everything affecting stock
 * happens inside ONE transaction guarded by StockGuard versions: any
 * interleaved confirm touching the same product+warehouse aborts with
 * StockConflictError and the caller retries.
 */
export async function confirmOrderCore(
  client: PrismaClient,
  orgId: string,
  actor: Actor,
  orderId: string,
): Promise<ConfirmResult> {
  return client.$transaction(
    async (tx) => {
      const t = tx;
      const order = (await t.salesOrder.findFirst({
        where: { id: orderId, customer: { organisationId: orgId } },
        include: { customer: true, lines: { include: { product: true } } },
      } as never)) as unknown as {
        id: string; number: string; status: string; deliveryAddress: string | null;
        customer: { id: string; priceGroup: string | null; company: string; paymentTerms: string };
        lines: { id: string; productId: string; quantity: number; discountPct: number; product: { id: string; sku: string; name: string; salesUnit: string; standardPriceCents: number; costCents: number; vatRate: number; safetyStock: number } }[];
      } | null;
      if (!order) throw new Error("This order was not found.");
      if (order.lines.length === 0) throw new Error("Add at least one order line before confirming.");
      assertTransition(order.status, "CONFIRMED");

      const warehouse = await findDefaultWarehouse(orgId, client);
      if (!warehouse) throw new Error("Create a warehouse before confirming orders.");

      // 1. Claim guards (upsert is atomic; version read decides conflicts later).
      const productIds = [...new Set(order.lines.map((l) => l.productId))];
      const guards = new Map<string, number>();
      for (const pid of productIds) {
        const g = (await t.stockGuard.upsert({
          where: { productId_warehouseId: { productId: pid, warehouseId: warehouse.id } },
          update: {},
          create: { productId: pid, warehouseId: warehouse.id, version: 0 },
        } as never)) as unknown as { version: number };
        guards.set(pid, g.version);
      }

      // 2. Availability inside the same transaction.
      const [movements, reservations] = await Promise.all([
        t.inventoryMovement.groupBy({ by: ["productId"], where: { productId: { in: productIds }, warehouseId: warehouse.id }, _sum: { quantity: true } } as never) as Promise<{ productId: string; _sum: { quantity: number | null } }[]>,
        t.inventoryReservation.groupBy({ by: ["productId"], where: { productId: { in: productIds }, warehouseId: warehouse.id }, _sum: { quantity: true } } as never) as Promise<{ productId: string; _sum: { quantity: number | null } }[]>,
      ]);
      const availability = new Map(
        productIds.map((pid) => [
          pid,
          (movements.find((m) => m.productId === pid)?._sum.quantity ?? 0) -
            (reservations.find((r) => r.productId === pid)?._sum.quantity ?? 0),
        ]),
      );

      // 3. Allocate + price every line.
      const allocations = allocateLines(
        order.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
        availability,
      );
      let shortageTotal = 0;
      let costCents = 0;
      for (let i = 0; i < order.lines.length; i++) {
        const line = order.lines[i];
        const alloc = allocations[i];
        shortageTotal += alloc.shortage;
        costCents += Math.round(line.quantity * line.product.costCents);
        const price = await resolveLinePrice(t, line.product, order.customer, line.quantity);
        await t.salesOrderLine.update({
          where: { id: line.id },
          data: { unitPriceCents: price.unitPriceCents, taxRate: line.product.vatRate },
        } as never);
        if (alloc.allocated > 0) {
          await t.inventoryReservation.create({
            data: {
              productId: line.productId,
              warehouseId: warehouse.id,
              quantity: alloc.allocated,
              orderId: order.id,
              orderLineId: line.id,
            },
          } as never);
        }
      }

      // 4. Totals from snapshotted prices.
      const refreshed = (await t.salesOrderLine.findMany({ where: { orderId: order.id } } as never)) as unknown as { quantity: number; unitPriceCents: number; discountPct: number; taxRate: number }[];
      const totals = computeOrderTotals(refreshed);

      // 5. Guard check: abort when someone else reserved first (rolls everything back).
      for (const pid of productIds) {
        const bumped = (await t.stockGuard.updateMany({
          where: { productId: pid, warehouseId: warehouse.id, version: guards.get(pid) },
          data: { version: { increment: 1 } },
        } as never)) as unknown as { count: number };
        if (bumped.count === 0) throw new StockConflictError();
      }

      // 6. Shortages → purchase requirements (dedupe per order+product).
      const finalStatus = shortageTotal > 0 ? "WAITING_FOR_STOCK" : "READY";
      for (const alloc of allocations) {
        if (alloc.shortage <= 0) continue;
        const line = order.lines.find((l) => l.productId === alloc.productId);
        const existing = (await t.purchaseRequirement.findFirst({
          where: { productId: alloc.productId, orderId: order.id, status: "OPEN" },
        } as never)) as unknown as { id: string } | null;
        if (!existing) {
          await t.purchaseRequirement.create({
            data: {
              productId: alloc.productId,
              orderId: order.id,
              requiredQty: alloc.shortage,
              reason: `Order ${order.number} needs ${alloc.shortage} ${line?.product.salesUnit ?? "units"} more (only ${alloc.allocated} of ${alloc.requested} available in ${warehouse.name}).`,
              status: "OPEN",
              createdBy: "USER",
            },
          } as never);
        }
      }

      // 7. Status, fulfilment shell (Phase 7 picks it up), timeline.
      let deliveryAddress = order.deliveryAddress as string | null;
      if (!deliveryAddress) {
        const addr = await t.customerAddress.findFirst({
          where: { customerId: order.customer.id, kind: "DELIVERY" },
          orderBy: { isDefault: "desc" },
        });
        deliveryAddress = addr ? formatAddress(addr) : null;
      }
      await t.salesOrder.update({
        where: { id: order.id },
        data: {
          status: finalStatus,
          deliveryAddress,
          subtotalCents: totals.subtotalCents,
          discountCents: totals.discountCents,
          taxCents: totals.taxCents,
          totalCents: totals.totalCents,
          costCents,
        },
      } as never);
      const fulfilment = (await t.fulfilment.create({
        data: { orderId: order.id, status: finalStatus === "READY" ? "READY_TO_PICK" : "WAITING_FOR_STOCK" },
      } as never)) as unknown as { id: string };
      await t.fulfilmentLine.createMany({
        data: order.lines.map((l) => ({ fulfilmentId: fulfilment.id, productId: l.productId, requiredQty: l.quantity })),
      } as never);

      return { status: finalStatus, allocations, totals, warehouseName: warehouse.name };
    },
    { timeout: 15000 },
  ).then(async (r: { status: string; allocations: { allocated: number; shortage: number }[]; totals: { totalCents: number }; warehouseName: string }) => {
    const allocated = r.allocations.reduce((s, a) => s + a.allocated, 0);
    const shortage = r.allocations.reduce((s, a) => s + a.shortage, 0);
    await audit({ orgId, action: "CONFIRM", entityType: "ORDER", entityId: orderId, newValue: { status: r.status, totalCents: r.totals.totalCents }, actor, client });
    await activity({
      orgId, entityType: "ORDER", entityId: orderId,
      message: `Order confirmed → ${r.status.replace(/_/g, " ")}. Reserved ${allocated} units from ${r.warehouseName}${shortage > 0 ? `; shortage ${shortage} raised as purchase requirements` : ""}.`,
      actor, client,
    });
    return { status: r.status, allocated, shortage };
  });
}

export async function confirmOrder(actor: Actor, orderId: string): Promise<ConfirmResult> {
  const me = await assertPermission("orders.manage");
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await confirmOrderCore(db, actor.orgId, me, orderId);
    } catch (e) {
      if (e instanceof StockConflictError && attempt < 2) continue;
      if (e instanceof StockConflictError) break;
      throw e;
    }
  }
  throw new Error("Stock levels changed while confirming. Please review the order and retry.");
}

/**
 * Try to reserve the remaining shortage of a waiting order.
 * Auth-free core: the wrapper authenticates; goods receipt (Phase 6) drives
 * this directly for every affected order after posting stock.
 */
export async function recheckOrderCore(client: PrismaClient, orgId: string, actor: Actor, orderId: string): Promise<ConfirmResult> {
  const order = await client.salesOrder.findFirst({
    where: { id: orderId, customer: { organisationId: orgId } },
    include: { lines: true },
  });
  if (!order) throw new Error("This order was not found.");
  if (order.status !== "WAITING_FOR_STOCK") throw new Error("Only orders waiting for stock can be rechecked.");

  const warehouse = await findDefaultWarehouse(orgId, client);
  if (!warehouse) throw new Error("Create a warehouse first.");
  const productIds = [...new Set(order.lines.map((l) => l.productId))];

  const result = await client.$transaction(async (tx) => {
    for (const pid of productIds) {
      await tx.stockGuard.upsert({
        where: { productId_warehouseId: { productId: pid, warehouseId: warehouse.id } },
        update: {},
        create: { productId: pid, warehouseId: warehouse.id, version: 0 },
      });
    }
    const versions = new Map(
      (await tx.stockGuard.findMany({ where: { productId: { in: productIds }, warehouseId: warehouse.id } })).map((g) => [g.productId, g.version] as const),
    );
    const [movements, reservations, existing] = await Promise.all([
      tx.inventoryMovement.groupBy({ by: ["productId"], where: { productId: { in: productIds }, warehouseId: warehouse.id }, _sum: { quantity: true } }),
      tx.inventoryReservation.groupBy({ by: ["productId"], where: { productId: { in: productIds }, warehouseId: warehouse.id }, _sum: { quantity: true } }),
      tx.inventoryReservation.findMany({ where: { orderId } }),
    ]);
    const availability = new Map(
      productIds.map((pid) => [
        pid,
        (movements.find((m) => m.productId === pid)?._sum.quantity ?? 0) -
          (reservations.find((r) => r.productId === pid)?._sum.quantity ?? 0),
      ]),
    );
    const remainder = order.lines.map((l) => ({
      productId: l.productId,
      quantity: Math.max(0, l.quantity - existing.filter((r) => r.orderLineId === l.id).reduce((s, r) => s + r.quantity, 0)),
    }));
    const allocations = allocateLines(remainder.filter((l) => l.quantity > 0), availability);
    for (const a of allocations) {
      if (a.allocated <= 0) continue;
      const line = order.lines.find((l) => l.productId === a.productId);
      await tx.inventoryReservation.create({
        data: { productId: a.productId, warehouseId: warehouse.id, quantity: a.allocated, orderId, orderLineId: line?.id },
      });
    }
    for (const pid of productIds) {
      const bumped = await tx.stockGuard.updateMany({
        where: { productId: pid, warehouseId: warehouse.id, version: versions.get(pid) },
        data: { version: { increment: 1 } },
      });
      if (bumped.count === 0) throw new StockConflictError();
    }
    const stillShort = allocations.reduce((s, a) => s + a.shortage, 0);
    const newlyAllocated = allocations.reduce((s, a) => s + a.allocated, 0);
    const finalStatus = stillShort > 0 ? "WAITING_FOR_STOCK" : "READY";
    await tx.salesOrder.update({ where: { id: orderId }, data: { status: finalStatus } });
    if (finalStatus === "READY") {
      await tx.fulfilment.updateMany({ where: { orderId }, data: { status: "READY_TO_PICK" } });
      await tx.purchaseRequirement.updateMany({ where: { orderId, status: "OPEN" }, data: { status: "CANCELLED" } });
    }
    return { status: finalStatus, allocated: newlyAllocated, shortage: stillShort };
  }, { timeout: 15000 });

  await activity({
    orgId, entityType: "ORDER", entityId: orderId,
    message: `Availability rechecked → ${result.status.replace(/_/g, " ")} (reserved +${result.allocated}).`, actor, client,
  });
  return result;
}

export async function recheckOrder(actor: Actor, orderId: string): Promise<ConfirmResult> {
  const me = await assertPermission("orders.manage");
  return recheckOrderCore(db, actor.orgId, me, orderId);
}

export async function cancelOrder(actor: Actor, orderId: string) {
  const me = await assertPermission("orders.manage");
  const order = await db.salesOrder.findFirst({ where: { id: orderId, customer: { organisationId: actor.orgId } } });
  if (!order) throw new Error("This order was not found.");
  assertTransition(order.status, "CANCELLED");
  await db.$transaction([
    db.inventoryReservation.deleteMany({ where: { orderId } }),
    db.purchaseRequirement.updateMany({ where: { orderId, status: "OPEN" }, data: { status: "CANCELLED" } }),
    db.salesOrder.update({ where: { id: orderId }, data: { status: "CANCELLED" } }),
  ]);
  await audit({ orgId: actor.orgId, action: "CANCEL", entityType: "ORDER", entityId: orderId, oldValue: { status: order.status }, newValue: { status: "CANCELLED" }, actor: me });
  await activity({ orgId: actor.orgId, entityType: "ORDER", entityId: orderId, message: `Order ${order.number} cancelled. Reservations released.`, actor: me });
  await notify({
    orgId: actor.orgId, severity: "WARNING", roleCode: "SALES",
    title: `Order ${order.number} cancelled`, link: `/orders/${orderId}`,
  });
}
