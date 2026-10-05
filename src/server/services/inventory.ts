import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { assertPermission, assertAnyPermission } from "@/server/auth/permissions";
import { audit, activity, notify } from "@/server/platform";
import { levelsFromAggregates } from "@/domain/stock";
import {
  requiresAdjustmentApproval,
  adjustmentTypeFor,
  validateTransfer,
  countCorrections,
} from "@/domain/inventory";
import { calculateReorderRequirement } from "@/domain/procurement";
import { PAGE_SIZE, pageOf, paged, type Actor } from "./util";
import { defaultWarehouse } from "./warehouses";

// ─── Stock overview ─────────────────────────────────────────────────────────
// Product master lists stay small in distribution MVP (hundreds), so levels are
// computed in memory after a bounded fetch. Revisit with SQL-side aggregation
// past ~10k products (see §41 performance).

export async function stockOverview(
  orgId: string,
  sp?: { q?: string; warehouse?: string; low?: string; page?: string | string[] },
) {
  await assertPermission("inventory.view");
  const q = (Array.isArray(sp?.q) ? sp?.q[0] : sp?.q)?.trim() ?? "";
  const warehouseId = Array.isArray(sp?.warehouse) ? sp?.warehouse[0] : sp?.warehouse;
  const lowOnly = sp?.low === "1";
  const page = pageOf(sp as { page?: string });

  if (warehouseId) {
    const wh = await db.warehouse.findFirst({ where: { id: warehouseId, organisationId: orgId } });
    if (!wh) throw new Error("The selected warehouse was not found.");
  }
  const products = await db.product.findMany({
    where: {
      organisationId: orgId,
      status: "ACTIVE",
      ...(q ? { OR: [{ name: { contains: q } }, { sku: { contains: q } }, { barcode: { contains: q } }] } : {}),
    },
    orderBy: { name: "asc" },
    include: { category: true },
  });
  const ids = products.map((p) => p.id);
  const [movements, reservations] = await Promise.all([
    db.inventoryMovement.groupBy({
      by: ["productId"],
      where: { productId: { in: ids }, ...(warehouseId ? { warehouseId } : {}) },
      _sum: { quantity: true },
    }),
    db.inventoryReservation.groupBy({
      by: ["productId"],
      where: { productId: { in: ids }, ...(warehouseId ? { warehouseId } : {}) },
      _sum: { quantity: true },
    }),
  ]);
  let rows = products.map((p) => ({
    product: p,
    stock: levelsFromAggregates(
      movements.find((m) => m.productId === p.id)?._sum.quantity ?? 0,
      reservations.find((r) => r.productId === p.id)?._sum.quantity ?? 0,
      0, // incoming wires up in Phase 5 (open purchase orders)
    ),
  }));
  if (lowOnly) rows = rows.filter((r) => r.stock.available < r.product.reorderPoint);
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, pages);
  return { ...paged(rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE), total, safePage), lowOnly, warehouseId: warehouseId ?? "" };
}

// ─── Ledger ─────────────────────────────────────────────────────────────────

export async function listMovements(
  orgId: string,
  sp?: { q?: string; warehouse?: string; type?: string; product?: string; page?: string | string[] },
) {
  await assertPermission("inventory.view");
  const q = (Array.isArray(sp?.q) ? sp?.q[0] : sp?.q)?.trim() ?? "";
  const warehouseId = Array.isArray(sp?.warehouse) ? sp?.warehouse[0] : sp?.warehouse;
  const type = Array.isArray(sp?.type) ? sp?.type[0] : sp?.type;
  const productId = Array.isArray(sp?.product) ? sp?.product[0] : sp?.product;
  const page = pageOf(sp as { page?: string });
  const where = {
    product: { organisationId: orgId },
    ...(warehouseId ? { warehouseId } : {}),
    ...(type ? { type } : {}),
    ...(productId ? { productId } : {}),
    ...(q ? { OR: [{ reference: { contains: q } }, { note: { contains: q } }] } : {}),
  };
  const [total, items] = await Promise.all([
    db.inventoryMovement.count({ where }),
    db.inventoryMovement.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { product: { select: { sku: true, name: true } }, warehouse: { select: { name: true } } },
    }),
  ]);
  return paged(items, total, page);
}

export async function listReservations(orgId: string, sp?: { product?: string; page?: string | string[] }) {
  await assertPermission("inventory.view");
  const productId = Array.isArray(sp?.product) ? sp?.product[0] : sp?.product;
  const page = pageOf(sp as { page?: string });
  const where = { product: { organisationId: orgId }, ...(productId ? { productId } : {}) };
  const [total, items] = await Promise.all([
    db.inventoryReservation.count({ where }),
    db.inventoryReservation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { product: { select: { sku: true, name: true } } },
    }),
  ]);
  return paged(items, total, page);
}

// ─── Adjustments (small = direct, significant = approval-gated) ─────────────

const AdjustmentSchema = z.object({
  productId: z.string().min(1, "Product is required."),
  warehouseId: z.string().optional(),
  qty: z.coerce.number().refine((n) => Number.isFinite(n) && n !== 0, "Quantity cannot be zero."),
  reason: z.string().trim().min(3, "A reason is required for every adjustment."),
});

export interface AdjustmentOutcome {
  applied: boolean;
  approvalId?: string;
  movementId?: string;
}

export async function createAdjustment(actor: Actor, raw: unknown): Promise<AdjustmentOutcome> {
  const me = await assertAnyPermission(["inventory.manage"]);
  const data = AdjustmentSchema.parse(raw);
  const product = await db.product.findFirst({ where: { id: data.productId, organisationId: actor.orgId } });
  if (!product) throw new Error("This product was not found.");
  const warehouse = data.warehouseId
    ? await db.warehouse.findFirst({ where: { id: data.warehouseId, organisationId: actor.orgId } })
    : await defaultWarehouse(actor.orgId);
  if (!warehouse) throw new Error("Select a warehouse for this adjustment.");

  if (requiresAdjustmentApproval(data.qty)) {
    const approval = await db.approvalRequest.create({
      data: {
        orgId: actor.orgId,
        kind: "STOCK_ADJUSTMENT",
        entityId: "PENDING",
        payload: { productId: product.id, warehouseId: warehouse.id, qty: data.qty, reason: data.reason },
        requestedBy: me.id,
        reason: `${data.qty > 0 ? "+" : ""}${data.qty} ${product.salesUnit} of ${product.sku}: ${data.reason}`,
      },
    });
    await audit({ orgId: actor.orgId, action: "APPROVAL_REQUEST", entityType: "STOCK_ADJUSTMENT", entityId: approval.id, newValue: { qty: data.qty }, actor: me });
    await notify({
      orgId: actor.orgId, severity: "ACTION_REQUIRED", roleCode: "OPS_MANAGER",
      title: `Stock adjustment needs approval (${product.sku}, ${data.qty})`,
      body: data.reason, link: "/approvals",
    });
    return { applied: false, approvalId: approval.id };
  }

  const movement = await applyAdjustment(actor.orgId, me, {
    productId: product.id, warehouseId: warehouse.id, qty: data.qty, reason: data.reason,
  });
  return { applied: true, movementId: movement.id };
}

/** Applies an approved (or small) adjustment. Exported for the approvals service. */
export async function applyAdjustment(
  orgId: string,
  actor: Actor,
  input: { productId: string; warehouseId: string; qty: number; reason: string; reference?: string },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any = db,
) {
  const movement = await client.inventoryMovement.create({
    data: {
      productId: input.productId,
      warehouseId: input.warehouseId,
      quantity: input.qty,
      type: adjustmentTypeFor(input.qty),
      reference: input.reference ?? "ADJ",
      note: input.reason,
      actorId: actor.id,
      actorName: actor.name,
    },
  });
  await audit({ orgId, action: "CREATE", entityType: "INVENTORY_MOVEMENT", entityId: movement.id, newValue: movement, actor, client });
  await activity({
    orgId, entityType: "PRODUCT", entityId: input.productId,
    message: `Stock ${input.qty > 0 ? "+" : ""}${input.qty} (${input.reference ?? "adjustment"}): ${input.reason}.`,
    actor, source: actor.id === "system" ? "SYSTEM" : "USER", client,
  });
  return movement;
}

// ─── Transfers ──────────────────────────────────────────────────────────────

const TransferSchema = z.object({
  productId: z.string().min(1, "Product is required."),
  fromWarehouseId: z.string().min(1, "Source warehouse is required."),
  toWarehouseId: z.string().min(1, "Destination warehouse is required."),
  qty: z.coerce.number().positive("Quantity must be positive."),
});

export async function createTransfer(actor: Actor, raw: unknown) {
  const me = await assertAnyPermission(["inventory.manage"]);
  const data = TransferSchema.parse(raw);
  validateTransfer({ fromWarehouseId: data.fromWarehouseId, toWarehouseId: data.toWarehouseId, qty: data.qty });
  const [product, from, to] = await Promise.all([
    db.product.findFirst({ where: { id: data.productId, organisationId: actor.orgId } }),
    db.warehouse.findFirst({ where: { id: data.fromWarehouseId, organisationId: actor.orgId } }),
    db.warehouse.findFirst({ where: { id: data.toWarehouseId, organisationId: actor.orgId } }),
  ]);
  if (!product) throw new Error("This product was not found.");
  if (!from || !to) throw new Error("Both warehouses must belong to your organisation.");

  const [movedOut, reserved] = await Promise.all([
    db.inventoryMovement.aggregate({ _sum: { quantity: true }, where: { productId: product.id, warehouseId: from.id } }),
    db.inventoryReservation.aggregate({ _sum: { quantity: true }, where: { productId: product.id, warehouseId: from.id } }),
  ]);
  const available = (movedOut._sum.quantity ?? 0) - (reserved._sum.quantity ?? 0);
  if (data.qty > available + 1e-9) {
    throw new Error(`Insufficient available stock in ${from.name} (available ${available}).`);
  }

  const reference = `TRF-${Date.now().toString(36).toUpperCase()}`;
  await db.$transaction([
    db.inventoryMovement.create({
      data: {
        productId: product.id, warehouseId: from.id, quantity: -data.qty,
        type: "TRANSFER_OUT", reference, note: `Transfer to ${to.name}`,
        actorId: me.id, actorName: me.name,
      },
    }),
    db.inventoryMovement.create({
      data: {
        productId: product.id, warehouseId: to.id, quantity: data.qty,
        type: "TRANSFER_IN", reference, note: `Transfer from ${from.name}`,
        actorId: me.id, actorName: me.name,
      },
    }),
  ]);
  await audit({ orgId: actor.orgId, action: "TRANSFER", entityType: "PRODUCT", entityId: product.id, newValue: { from: from.id, to: to.id, qty: data.qty, reference }, actor: me });
  await activity({
    orgId: actor.orgId, entityType: "PRODUCT", entityId: product.id,
    message: `Transferred ${data.qty} from ${from.name} to ${to.name} (${reference}).`, actor: me,
  });
  return reference;
}

// ─── Stock counts ───────────────────────────────────────────────────────────

export async function listCounts(orgId: string, page = 1) {
  await assertPermission("inventory.view");
  const where = { warehouse: { organisationId: orgId } };
  const [total, items] = await Promise.all([
    db.stockCount.count({ where }),
    db.stockCount.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { warehouse: true, _count: { select: { lines: true } } },
    }),
  ]);
  return paged(items, total, page);
}

export async function getCount(orgId: string, id: string) {
  await assertPermission("inventory.view");
  const count = await db.stockCount.findFirst({
    where: { id, warehouse: { organisationId: orgId } },
    include: { warehouse: true, lines: { include: { product: true }, orderBy: { product: { name: "asc" } } } },
  });
  if (!count) throw new Error("This stock count was not found.");
  return count;
}

export async function createCount(actor: Actor, warehouseId: string) {
  const me = await assertAnyPermission(["inventory.manage"]);
  const warehouse = await db.warehouse.findFirst({ where: { id: warehouseId, organisationId: actor.orgId } });
  if (!warehouse) throw new Error("The selected warehouse was not found.");
  const products = await db.product.findMany({ where: { organisationId: actor.orgId, status: "ACTIVE" }, orderBy: { name: "asc" } });
  const sums = await db.inventoryMovement.groupBy({
    by: ["productId"], where: { warehouseId, productId: { in: products.map((p) => p.id) } }, _sum: { quantity: true },
  });
  const n = await db.stockCount.count({ where: { warehouseId } });
  const code = `COUNT-${String(n + 1).padStart(4, "0")}`;
  const count = await db.stockCount.create({
    data: {
      warehouseId,
      code,
      status: "OPEN",
      createdById: me.id,
      lines: {
        create: products.map((p) => ({
          productId: p.id,
          expectedQty: sums.find((s) => s.productId === p.id)?._sum.quantity ?? 0,
        })),
      },
    },
  });
  await audit({ orgId: actor.orgId, action: "CREATE", entityType: "STOCK_COUNT", entityId: count.id, newValue: { code }, actor: me });
  return count.id;
}

export async function submitCounted(actor: Actor, countId: string, entries: Record<string, number>) {
  const me = await assertAnyPermission(["inventory.manage"]);
  const count = await db.stockCount.findFirst({
    where: { id: countId, warehouse: { organisationId: actor.orgId } },
    include: { lines: true },
  });
  if (!count) throw new Error("This stock count was not found.");
  if (count.status !== "OPEN") throw new Error("This count is already closed.");
  const lineIds = new Set(count.lines.map((l) => l.productId));
  const ops = Object.entries(entries)
    .filter(([productId, qty]) => lineIds.has(productId) && Number.isFinite(qty) && qty >= 0)
    .map(([productId, qty]) =>
      db.stockCountLine.updateMany({ where: { countId, productId }, data: { countedQty: qty } }),
    );
  await db.$transaction(ops);
  await audit({ orgId: actor.orgId, action: "COUNT_ENTRY", entityType: "STOCK_COUNT", entityId: countId, newValue: { entered: ops.length }, actor: me });
}

export async function postCount(actor: Actor, countId: string) {
  const me = await assertAnyPermission(["inventory.manage"]);
  const count = await db.stockCount.findFirst({
    where: { id: countId, warehouse: { organisationId: actor.orgId } },
    include: { lines: true },
  });
  if (!count) throw new Error("This stock count was not found.");
  if (count.status !== "OPEN") throw new Error("This count is already closed.");
  const corrections = countCorrections(
    count.lines.map((l) => ({ productId: l.productId, expectedQty: l.expectedQty, countedQty: l.countedQty })),
  );
  await db.$transaction([
    ...corrections.map((c) =>
      db.inventoryMovement.create({
        data: {
          productId: c.productId, warehouseId: count.warehouseId, quantity: c.diff,
          type: "STOCK_COUNT_CORRECTION", reference: count.code,
          note: `Count ${count.code}: correction ${c.diff > 0 ? "+" : ""}${c.diff}`,
          actorId: me.id, actorName: me.name,
        },
      }),
    ),
    db.stockCount.update({ where: { id: countId }, data: { status: "POSTED" } }),
  ]);
  await audit({ orgId: actor.orgId, action: "COUNT_POST", entityType: "STOCK_COUNT", entityId: countId, newValue: { corrections: corrections.length }, actor: me });
  await activity({
    orgId: actor.orgId, entityType: "STOCK_COUNT", entityId: countId,
    message: `Count ${count.code} posted with ${corrections.length} correction${corrections.length === 1 ? "" : "s"}.`, actor: me,
  });
  return corrections.length;
}

export async function cancelCount(actor: Actor, countId: string) {
  const me = await assertAnyPermission(["inventory.manage"]);
  const count = await db.stockCount.findFirst({ where: { id: countId, warehouse: { organisationId: actor.orgId } } });
  if (!count) throw new Error("This stock count was not found.");
  if (count.status !== "OPEN") throw new Error("Only open counts can be cancelled.");
  await db.stockCount.update({ where: { id: countId }, data: { status: "CANCELLED" } });
  await audit({ orgId: actor.orgId, action: "COUNT_CANCEL", entityType: "STOCK_COUNT", entityId: countId, actor: me });
}

// ─── Low stock + requirements (feeds Phase 5 procurement) ───────────────────

export async function lowStockBoard(orgId: string) {
  await assertPermission("inventory.view");
  const products = await db.product.findMany({ where: { organisationId: orgId, status: "ACTIVE" }, orderBy: { name: "asc" } });
  const ids = products.map((p) => p.id);
  const [movements, reservations, openReqs] = await Promise.all([
    db.inventoryMovement.groupBy({ by: ["productId"], where: { productId: { in: ids } }, _sum: { quantity: true } }),
    db.inventoryReservation.groupBy({ by: ["productId"], where: { productId: { in: ids } }, _sum: { quantity: true } }),
    db.purchaseRequirement.findMany({ where: { productId: { in: ids }, status: "OPEN" } }),
  ]);
  return products
    .map((p) => {
      const stock = levelsFromAggregates(
        movements.find((m) => m.productId === p.id)?._sum.quantity ?? 0,
        reservations.find((r) => r.productId === p.id)?._sum.quantity ?? 0,
        0,
      );
      const calc = calculateReorderRequirement({
        available: stock.available,
        incoming: 0,
        outstandingDemand: stock.reserved,
        safetyStock: p.safetyStock,
        forecastDemand: 0,
        minOrderQtyBase: 0,
        packSizeBase: 1,
      });
      return {
        product: p,
        stock,
        suggestion: calc.recommendedQty,
        reason: calc.reason,
        openRequirement: openReqs.find((r) => r.productId === p.id) ?? null,
      };
    })
    .filter((r) => r.stock.available < r.product.reorderPoint);
}

export async function createRequirement(actor: Actor, raw: { productId: string; qty: number; reason: string }) {
  const me = await assertAnyPermission(["inventory.manage", "procurement.manage"]);
  const product = await db.product.findFirst({ where: { id: raw.productId, organisationId: actor.orgId } });
  if (!product) throw new Error("This product was not found.");
  if (!(raw.qty > 0)) throw new Error("Required quantity must be positive.");
  if (!raw.reason.trim()) throw new Error("A reason is required.");
  const existing = await db.purchaseRequirement.findFirst({
    where: { productId: product.id, status: "OPEN" },
  });
  if (existing) throw new Error("An open requirement already exists for this product.");
  const req = await db.purchaseRequirement.create({
    data: { productId: product.id, requiredQty: raw.qty, reason: raw.reason.trim(), status: "OPEN", createdBy: "USER" },
  });
  await audit({ orgId: actor.orgId, action: "CREATE", entityType: "PURCHASE_REQUIREMENT", entityId: req.id, newValue: req, actor: me });
  await notify({
    orgId: actor.orgId, severity: "INFO", roleCode: "PROCUREMENT",
    title: `Purchase requirement: ${product.sku} × ${raw.qty}`,
    body: raw.reason.trim(), link: "/inventory/low-stock",
  });
  return req.id;
}
