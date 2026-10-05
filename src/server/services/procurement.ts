import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { assertPermission } from "@/server/auth/permissions";
import { audit, activity, notify } from "@/server/platform";
import { assertTransitionPO, toPurchaseQty } from "@/domain/procurement";
import { PAGE_SIZE, pageOf, paged, type Actor } from "./util";
import { findDefaultWarehouse } from "./warehouses";

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyDb = any;

// ─── Requirements ───────────────────────────────────────────────────────────

export async function listRequirements(orgId: string, sp?: { status?: string; page?: string | string[] }) {
  await assertPermission("procurement.view");
  const status = Array.isArray(sp?.status) ? sp?.status[0] : sp?.status;
  const page = pageOf(sp as { page?: string });
  const where = {
    product: { organisationId: orgId },
    ...(status && status !== "ALL" ? { status } : {}),
  };
  const [total, items] = await Promise.all([
    db.purchaseRequirement.count({ where }),
    db.purchaseRequirement.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { product: { select: { sku: true, name: true, salesUnit: true, conversionFactor: true } } },
    }),
  ]);
  const orderIds = [...new Set(items.map((r) => r.orderId).filter(Boolean))] as string[];
  const orders = orderIds.length > 0
    ? await db.salesOrder.findMany({ where: { id: { in: orderIds } }, select: { id: true, number: true } })
    : [];
  const numbers = new Map(orders.map((o) => [o.id, o.number]));
  return paged(items.map((r) => ({ ...r, orderNumber: r.orderId ? (numbers.get(r.orderId) ?? r.orderId) : null })), total, page);
}

export async function cancelRequirementCore(client: AnyDb, orgId: string, actor: Actor, id: string) {
  const req = await client.purchaseRequirement.findFirst({
    where: { id, product: { organisationId: orgId } },
  });
  if (!req) throw new Error("This requirement was not found.");
  if (req.status !== "OPEN") throw new Error("Only open requirements can be cancelled.");
  await client.purchaseRequirement.update({ where: { id }, data: { status: "CANCELLED" } });
  await audit({ orgId, action: "CANCEL", entityType: "PURCHASE_REQUIREMENT", entityId: id, actor, client });
}

export async function cancelRequirement(actor: Actor, id: string) {
  const me = await assertPermission("procurement.manage");
  await cancelRequirementCore(db, actor.orgId, me, id);
}

/**
 * Convert open requirements into draft purchase orders, grouped by preferred
 * supplier. Base-unit requirements become purchase-unit PO lines (rounded up,
 * MOQ enforced). Requirements flip to ORDERED with a poId link.
 */
export async function convertRequirementsCore(
  client: AnyDb,
  orgId: string,
  actor: Actor,
  ids: string[],
): Promise<string[]> {
  if (ids.length === 0) throw new Error("Select at least one requirement.");
  if (ids.length > 100) throw new Error("Convert at most 100 requirements at once.");
  const reqs = await client.purchaseRequirement.findMany({
    where: { id: { in: ids }, product: { organisationId: orgId } },
    include: {
      product: {
        include: {
          supplierLinks: { include: { supplier: true }, orderBy: { isPreferred: "desc" } },
        },
      },
    },
  });
  if (reqs.length !== new Set(ids).size) throw new Error("One or more requirements were not found.");
  const notOpen = reqs.filter((r: { status: string }) => r.status !== "OPEN");
  if (notOpen.length > 0) throw new Error("Only open requirements can be converted.");

  const unassigned = reqs.filter(
    (r: { product: { supplierLinks: unknown[] } }) => r.product.supplierLinks.length === 0,
  );
  if (unassigned.length > 0) {
    throw new Error(
      `No supplier linked for: ${unassigned.map((r: { product: { sku: string } }) => r.product.sku).join(", ")}. Link a supplier on the product first.`,
    );
  }

  const bySupplier = new Map<string, typeof reqs>();
  for (const r of reqs) {
    const link = r.product.supplierLinks.find((l: { isPreferred: boolean }) => l.isPreferred) ?? r.product.supplierLinks[0];
    const sid = link.supplierId as string;
    if (!bySupplier.has(sid)) bySupplier.set(sid, []);
    bySupplier.get(sid)!.push({ ...r, _link: link });
  }

  const poIds: string[] = [];
  for (const [supplierId, group] of bySupplier) {
    const supplier = group[0]._link.supplier as { leadTimeDays: number; company: string };
    const warehouseId =
      (group.find((r: { warehouseId: string | null }) => r.warehouseId)?.warehouseId as string | undefined) ??
      (await findDefaultWarehouse(orgId, client))?.id;
    if (!warehouseId) throw new Error("Create a warehouse before purchasing.");
    const expected = new Date();
    expected.setDate(expected.getDate() + (supplier.leadTimeDays ?? 7));

    let number = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      const n = await client.purchaseOrder.count({ where: { supplier: { organisationId: orgId } } });
      const candidate = `PO-${String(n + 1 + attempt).padStart(4, "0")}`;
      try {
        const po = await client.purchaseOrder.create({
          data: {
            number: candidate,
            supplierId,
            warehouseId,
            status: "DRAFT",
            expectedDate: expected,
            notes: `From requirements: ${group.map((r: { id: string }) => r.id.slice(-6)).join(", ")}`,
            createdById: actor.id,
          },
        });
        number = po.number;
        const poId = po.id as string;
        let subtotal = 0;
        let tax = 0;
        for (const r of group) {
          const link = r._link as { costCents: number; minOrderQty: number };
          const qty = toPurchaseQty(r.requiredQty as number, r.product.conversionFactor as number, link.minOrderQty);
          const baseQty = qty * (r.product.conversionFactor as number);
          const lineTotal = Math.round(baseQty * link.costCents);
          const vatRate = (r.product as { vatRate?: number }).vatRate ?? 22;
          subtotal += lineTotal;
          tax += Math.round(lineTotal * (vatRate / 100));
          await client.purchaseOrderLine.create({
            data: { poId, productId: r.productId, quantity: qty, unitCostCents: link.costCents },
          });
          await client.purchaseRequirement.update({
            where: { id: r.id },
            data: { status: "ORDERED", poId },
          });
        }
        await client.purchaseOrder.update({
          where: { id: poId },
          data: { subtotalCents: subtotal, taxCents: tax, totalCents: subtotal + tax },
        });
        await audit({ orgId, action: "CREATE", entityType: "PURCHASE_ORDER", entityId: poId, newValue: { number, lines: group.length }, actor, client });
        await activity({
          orgId, entityType: "SUPPLIER", entityId: supplierId,
          message: `Draft ${number} created from ${group.length} requirement${group.length === 1 ? "" : "s"}.`, actor, client,
        });
        poIds.push(poId);
        break;
      } catch (e) {
        if (e instanceof Error && e.message.includes("P2002")) continue;
        throw e;
      }
    }
    if (!number) throw new Error("Could not assign a purchase order number. Please try again.");
  }
  return poIds;
}

export async function convertRequirements(actor: Actor, ids: string[]): Promise<string[]> {
  const me = await assertPermission("procurement.manage");
  return convertRequirementsCore(db, actor.orgId, me, ids);
}

// ─── Purchase orders ────────────────────────────────────────────────────────

const POHeaderSchema = z.object({
  supplierId: z.string().min(1, "Supplier is required."),
  warehouseId: z.string().optional(),
  expectedDate: z.string().optional(),
  notes: z.string().trim().max(2000).nullish(),
});

const POLinesSchema = z.object({
  lines: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.coerce.number().positive("Quantities must be positive."),
        unitCostCents: z.coerce.number().int().min(0).optional(),
      }),
    )
    .min(1, "Add at least one PO line.")
    .max(200, "Too many lines on one purchase order."),
});

async function totalsFor(
  client: AnyDb,
  lines: { productId: string; quantity: number; unitCostCents?: number }[],
) {
  const products = await client.product.findMany({ where: { id: { in: lines.map((l) => l.productId) } } });
  if (products.length !== new Set(lines.map((l) => l.productId)).size) {
    throw new Error("One or more selected products were not found.");
  }
  let subtotal = 0;
  let tax = 0;
  const resolved = [];
  for (const l of lines) {
    const p = products.find((x: { id: string }) => x.id === l.productId);
    const link = await client.productSupplier.findFirst({
      where: { productId: l.productId },
      orderBy: { isPreferred: "desc" },
    });
    const unitCost = l.unitCostCents ?? link?.costCents ?? p.costCents;
    const lineTotal = Math.round(l.quantity * p.conversionFactor * unitCost);
    subtotal += lineTotal;
    tax += Math.round(lineTotal * (p.vatRate / 100));
    resolved.push({ productId: l.productId, quantity: l.quantity, unitCostCents: unitCost });
  }
  return { resolved, subtotalCents: subtotal, taxCents: tax, totalCents: subtotal + tax };
}

export async function listPOs(orgId: string, sp?: { q?: string; status?: string; supplier?: string; page?: string | string[] }) {
  await assertPermission("procurement.view");
  const q = (Array.isArray(sp?.q) ? sp?.q[0] : sp?.q)?.trim() ?? "";
  const status = Array.isArray(sp?.status) ? sp?.status[0] : sp?.status;
  const supplierId = Array.isArray(sp?.supplier) ? sp?.supplier[0] : sp?.supplier;
  const page = pageOf(sp as { page?: string });
  const where = {
    supplier: { organisationId: orgId },
    ...(q ? { number: { contains: q } } : {}),
    ...(status ? { status } : {}),
    ...(supplierId ? { supplierId } : {}),
  };
  const [total, items] = await Promise.all([
    db.purchaseOrder.count({ where }),
    db.purchaseOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { supplier: { select: { company: true, code: true } }, _count: { select: { lines: true } } },
    }),
  ]);
  return paged(items, total, page);
}

export async function getPO(orgId: string, id: string) {
  await assertPermission("procurement.view");
  const po = await db.purchaseOrder.findFirst({
    where: { id, supplier: { organisationId: orgId } },
    include: {
      supplier: true,
      warehouse: true,
      lines: { include: { product: true } },
      receipts: { orderBy: { receivedAt: "desc" } },
    },
  });
  if (!po) throw new Error("This purchase order was not found.");
  const [requirements, events, approval] = await Promise.all([
    db.purchaseRequirement.findMany({
      where: { poId: id },
      include: { product: { select: { sku: true, name: true } } },
    }),
    db.activityEvent.findMany({ where: { orgId, entityType: "PURCHASE_ORDER", entityId: id }, orderBy: { createdAt: "desc" }, take: 30 }),
    db.approvalRequest.findFirst({ where: { orgId, kind: "PO_APPROVAL", entityId: id }, orderBy: { createdAt: "desc" } }),
  ]);
  return { po, requirements, events, approval };
}

export async function createDraftCore(client: AnyDb, orgId: string, actor: Actor, raw: unknown): Promise<string> {
  const data = POHeaderSchema.parse(raw);
  const supplier = await client.supplier.findFirst({ where: { id: data.supplierId, organisationId: orgId } });
  if (!supplier) throw new Error("The selected supplier was not found.");
  if (supplier.status !== "ACTIVE") throw new Error("This supplier is not active.");
  const warehouse = data.warehouseId
    ? await client.warehouse.findFirst({ where: { id: data.warehouseId, organisationId: orgId } })
    : await findDefaultWarehouse(orgId, client);
  if (!warehouse) throw new Error("Select a warehouse for this purchase order.");

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const n = await client.purchaseOrder.count({ where: { supplier: { organisationId: orgId } } });
      const po = await client.purchaseOrder.create({
        data: {
          number: `PO-${String(n + 1 + attempt).padStart(4, "0")}`,
          supplierId: supplier.id,
          warehouseId: warehouse.id,
          status: "DRAFT",
          expectedDate: data.expectedDate ? new Date(data.expectedDate) : null,
          notes: data.notes?.trim() || null,
          createdById: actor.id,
        },
      });
      await audit({ orgId, action: "CREATE", entityType: "PURCHASE_ORDER", entityId: po.id, newValue: { number: po.number }, actor, client });
      await activity({ orgId, entityType: "PURCHASE_ORDER", entityId: po.id, message: `Draft ${po.number} created for ${supplier.company}.`, actor, client });
      return po.id as string;
    } catch (e) {
      if (e instanceof Error && e.message.includes("P2002")) continue;
      throw e;
    }
  }
  throw new Error("Could not assign a purchase order number. Please try again.");
}

export async function createDraft(actor: Actor, raw: unknown) {
  const me = await assertPermission("procurement.manage");
  return createDraftCore(db, actor.orgId, me, raw);
}

async function loadDraft(client: AnyDb, orgId: string, poId: string) {
  const po = await client.purchaseOrder.findFirst({
    where: { id: poId, supplier: { organisationId: orgId } },
  });
  if (!po) throw new Error("This purchase order was not found.");
  if (po.status !== "DRAFT") throw new Error("Only draft purchase orders can be edited.");
  return po;
}

export async function setPOLinesCore(client: AnyDb, orgId: string, actor: Actor, poId: string, raw: unknown) {
  const { lines } = POLinesSchema.parse(raw);
  await loadDraft(client, orgId, poId);
  const t = await totalsFor(client, lines);
  await client.purchaseOrderLine.deleteMany({ where: { poId } });
  await client.purchaseOrderLine.createMany({ data: t.resolved.map((l) => ({ poId, ...l })) });
  await client.purchaseOrder.update({
    where: { id: poId },
    data: { subtotalCents: t.subtotalCents, taxCents: t.taxCents, totalCents: t.totalCents },
  });
  await audit({ orgId, action: "LINES_SET", entityType: "PURCHASE_ORDER", entityId: poId, newValue: { lines: lines.length, totalCents: t.totalCents }, actor, client });
}

export async function setPOLines(actor: Actor, poId: string, raw: unknown) {
  const me = await assertPermission("procurement.manage");
  await setPOLinesCore(db, actor.orgId, me, poId, raw);
}

export async function updateDraftCore(client: AnyDb, orgId: string, actor: Actor, poId: string, raw: unknown) {
  const data = POHeaderSchema.partial().parse(raw);
  const po = await loadDraft(client, orgId, poId);
  if (data.supplierId && data.supplierId !== po.supplierId) {
    const supplier = await client.supplier.findFirst({ where: { id: data.supplierId, organisationId: orgId } });
    if (!supplier) throw new Error("The selected supplier was not found.");
  }
  if (data.warehouseId) {
    const warehouse = await client.warehouse.findFirst({ where: { id: data.warehouseId, organisationId: orgId } });
    if (!warehouse) throw new Error("The selected warehouse was not found.");
  }
  await client.purchaseOrder.update({
    where: { id: poId },
    data: {
      supplierId: data.supplierId,
      warehouseId: data.warehouseId,
      expectedDate: data.expectedDate === "" ? null : data.expectedDate ? new Date(data.expectedDate) : undefined,
      notes: data.notes !== undefined ? data.notes?.trim() || null : undefined,
    },
  });
  await audit({ orgId, action: "UPDATE", entityType: "PURCHASE_ORDER", entityId: poId, actor, client });
}

export async function updateDraft(actor: Actor, poId: string, raw: unknown) {
  const me = await assertPermission("procurement.manage");
  await updateDraftCore(db, actor.orgId, me, poId, raw);
}

export async function deleteDraftCore(client: AnyDb, orgId: string, actor: Actor, poId: string) {
  const po = await client.purchaseOrder.findFirst({ where: { id: poId, supplier: { organisationId: orgId } } });
  if (!po) throw new Error("This purchase order was not found.");
  if (po.status !== "DRAFT") throw new Error("Only draft purchase orders can be deleted.");
  await client.purchaseOrderLine.deleteMany({ where: { poId } });
  await client.purchaseRequirement.updateMany({ where: { poId, status: "ORDERED" }, data: { status: "OPEN", poId: null } });
  await client.purchaseOrder.delete({ where: { id: poId } });
  await audit({ orgId, action: "DELETE", entityType: "PURCHASE_ORDER", entityId: poId, oldValue: { number: po.number }, actor, client });
}

export async function deleteDraft(actor: Actor, poId: string) {
  const me = await assertPermission("procurement.manage");
  await deleteDraftCore(db, actor.orgId, me, poId);
}

export async function submitForApprovalCore(client: AnyDb, orgId: string, actor: Actor, poId: string) {
  const po = await client.purchaseOrder.findFirst({
    where: { id: poId, supplier: { organisationId: orgId } },
    include: { supplier: true, _count: { select: { lines: true } } },
  });
  if (!po) throw new Error("This purchase order was not found.");
  assertTransitionPO(po.status, "PENDING_APPROVAL");
  if (po._count.lines === 0) throw new Error("Add at least one line before submitting for approval.");
  await client.purchaseOrder.update({ where: { id: poId }, data: { status: "PENDING_APPROVAL" } });
  await client.approvalRequest.create({
    data: {
      orgId,
      kind: "PO_APPROVAL",
      entityId: poId,
      payload: { poId, totalCents: po.totalCents },
      requestedBy: actor.id,
      reason: `${po.number} · ${po.supplier.company} · €${(po.totalCents / 100).toFixed(2)} · ${po._count.lines} lines`,
    },
  });
  await audit({ orgId, action: "SUBMIT", entityType: "PURCHASE_ORDER", entityId: poId, oldValue: { status: "DRAFT" }, newValue: { status: "PENDING_APPROVAL" }, actor, client });
  await activity({ orgId, entityType: "PURCHASE_ORDER", entityId: poId, message: `${po.number} submitted for approval.`, actor, client });
  await notify({
    orgId, severity: "ACTION_REQUIRED", roleCode: "OPS_MANAGER",
    title: `Purchase order needs approval (${po.number})`,
    body: `${po.supplier.company} · €${(po.totalCents / 100).toFixed(2)}`, link: "/approvals", client,
  });
}

export async function submitForApproval(actor: Actor, poId: string) {
  const me = await assertPermission("procurement.manage");
  await submitForApprovalCore(db, actor.orgId, me, poId);
}

/** Applied by the approvals service when a PO_APPROVAL is approved. */
export async function applyPOApprovalCore(client: AnyDb, orgId: string, actor: Actor, poId: string) {
  const po = await client.purchaseOrder.findFirst({ where: { id: poId, supplier: { organisationId: orgId } } });
  if (!po) throw new Error("This purchase order was not found.");
  assertTransitionPO(po.status, "APPROVED");
  await client.purchaseOrder.update({ where: { id: poId }, data: { status: "APPROVED", approvedById: actor.id, approvedAt: new Date() } });
  await audit({ orgId, action: "APPROVE", entityType: "PURCHASE_ORDER", entityId: poId, oldValue: { status: "PENDING_APPROVAL" }, newValue: { status: "APPROVED" }, actor, client });
  await activity({ orgId, entityType: "PURCHASE_ORDER", entityId: poId, message: `${po.number} approved.`, actor, client });
}

/** Applied by the approvals service when a PO_APPROVAL is rejected. */
export async function revertPOToDraftCore(client: AnyDb, orgId: string, actor: Actor, poId: string) {
  const po = await client.purchaseOrder.findFirst({ where: { id: poId, supplier: { organisationId: orgId } } });
  if (!po) throw new Error("This purchase order was not found.");
  assertTransitionPO(po.status, "DRAFT");
  await client.purchaseOrder.update({ where: { id: poId }, data: { status: "DRAFT" } });
  await audit({ orgId, action: "REJECT", entityType: "PURCHASE_ORDER", entityId: poId, oldValue: { status: "PENDING_APPROVAL" }, newValue: { status: "DRAFT" }, actor, client });
}

/** Generic lifecycle step. Exported so goods receipt (Phase 6) and tests can drive it. */
export async function transitionCore(client: AnyDb, orgId: string, actor: Actor, poId: string, to: string, verb: string) {
  const po = await client.purchaseOrder.findFirst({
    where: { id: poId, supplier: { organisationId: orgId } },
    include: { supplier: true },
  });
  if (!po) throw new Error("This purchase order was not found.");
  assertTransitionPO(po.status, to);
  const data: Record<string, unknown> = { status: to };
  if (to === "CANCELLED") {
    await client.purchaseRequirement.updateMany({ where: { poId, status: "ORDERED" }, data: { status: "OPEN", poId: null } });
  }
  await client.purchaseOrder.update({ where: { id: poId }, data });
  await audit({ orgId, action: verb, entityType: "PURCHASE_ORDER", entityId: poId, oldValue: { status: po.status }, newValue: { status: to }, actor, client });
  await activity({ orgId, entityType: "PURCHASE_ORDER", entityId: poId, message: `${po.number}: ${po.status} → ${to.replace(/_/g, " ")}.`, actor, client });
  return po;
}

export async function sendPO(actor: Actor, poId: string) {
  const me = await assertPermission("procurement.manage");
  const po = await transitionCore(db, actor.orgId, me, poId, "SENT", "SEND");
  await notify({ orgId: actor.orgId, severity: "INFO", roleCode: "PROCUREMENT", title: `Purchase order ${po.number} sent to supplier`, link: `/procurement/${poId}` });
}

export async function confirmSupplierPO(actor: Actor, poId: string) {
  const me = await assertPermission("procurement.manage");
  await transitionCore(db, actor.orgId, me, poId, "SUPPLIER_CONFIRMED", "SUPPLIER_CONFIRM");
}

export async function closePO(actor: Actor, poId: string) {
  const me = await assertPermission("procurement.manage");
  await transitionCore(db, actor.orgId, me, poId, "CLOSED", "CLOSE");
}

export async function cancelPO(actor: Actor, poId: string) {
  const me = await assertPermission("procurement.manage");
  const po = await transitionCore(db, actor.orgId, me, poId, "CANCELLED", "CANCEL");
  await notify({ orgId: actor.orgId, severity: "WARNING", roleCode: "PROCUREMENT", title: `Purchase order ${po.number} cancelled`, link: "/procurement" });
}

export async function procurementStats(orgId: string) {
  const [openReqs, pendingPOs] = await Promise.all([
    db.purchaseRequirement.count({ where: { product: { organisationId: orgId }, status: "OPEN" } }),
    db.purchaseOrder.count({ where: { supplier: { organisationId: orgId }, status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT", "SUPPLIER_CONFIRMED"] } } }),
  ]);
  return { openReqs, pendingPOs };
}
