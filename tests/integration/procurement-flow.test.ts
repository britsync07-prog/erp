/**
 * Phase 5 flow test: requirement → grouped draft PO → approval (second person)
 * → send → supplier confirm → close, plus cancel-reopens-requirements and the
 * missing-supplier guard. Drives the REAL service cores against an isolated DB.
 */
import { execSync } from "node:child_process";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PERMISSIONS } from "@/domain/constants";
import {
  convertRequirementsCore,
  submitForApprovalCore,
  transitionCore,
} from "@/server/services/procurement";
import { approveRequestCore } from "@/server/services/approvals";

const TEST_DB = path.resolve(process.cwd(), "prisma", "test-po.db");
const ORG = "po-org";
const BUYER = { id: "po-buyer", name: "PO Buyer", orgId: ORG, permissions: [...PERMISSIONS] };
const MANAGER = { id: "po-manager", name: "PO Manager", orgId: ORG, permissions: [...PERMISSIONS] };

let client: PrismaClient;
let productId: string;
let requirementId: string;

beforeAll(async () => {
  try {
    await unlink(TEST_DB);
  } catch {
    /* fresh start */
  }
  execSync("npx prisma db push --accept-data-loss --skip-generate", {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: `file:${TEST_DB}` },
    stdio: "pipe",
  });
  client = new PrismaClient({ datasourceUrl: `file:${TEST_DB}` });

  await client.organisation.create({ data: { id: ORG, name: "PO Org", currency: "EUR", locale: "en" } });
  const warehouse = await client.warehouse.create({
    data: { organisationId: ORG, code: "P-01", name: "PO Warehouse", isDefault: true },
  });
  const supplier = await client.supplier.create({
    data: { organisationId: ORG, code: "SUP-PO", company: "PO Supplier", leadTimeDays: 5 },
  });
  const product = await client.product.create({
    data: {
      organisationId: ORG, sku: "PO-ITEM", name: "PO Item",
      salesUnit: "PCS", purchaseUnit: "CTN", conversionFactor: 24,
      costCents: 120, standardPriceCents: 190,
    },
  });
  productId = product.id;
  await client.productSupplier.create({
    data: { productId, supplierId: supplier.id, costCents: 115, minOrderQty: 2, packSize: 24, isPreferred: true },
  });
  const req = await client.purchaseRequirement.create({
    data: {
      productId, warehouseId: warehouse.id, requiredQty: 50,
      reason: "test demand", status: "OPEN", createdBy: "USER",
    },
  });
  requirementId = req.id;
}, 120000);

afterAll(async () => {
  await client?.$disconnect();
  try {
    await unlink(TEST_DB);
  } catch {
    /* best effort */
  }
});

describe("procurement flow", () => {
  it("converts requirements into supplier-grouped drafts with converted quantities", async () => {
    const poIds = await convertRequirementsCore(client, ORG, BUYER, [requirementId]);
    expect(poIds).toHaveLength(1);
    const po = await client.purchaseOrder.findUniqueOrThrow({
      where: { id: poIds[0] },
      include: { lines: true },
    });
    expect(po.status).toBe("DRAFT");
    expect(po.lines).toHaveLength(1);
    // 50 pcs / 24 per carton → 2.09 cartons (rounded up), supplier cost applies.
    expect(po.lines[0].quantity).toBe(2.09);
    expect(po.lines[0].unitCostCents).toBe(115);
    const req = await client.purchaseRequirement.findUniqueOrThrow({ where: { id: requirementId } });
    expect(req.status).toBe("ORDERED");
    expect(req.poId).toBe(po.id);
  });

  it("runs submit → approve → send → confirm → close with a second person", async () => {
    const po = await client.purchaseOrder.findFirstOrThrow({ where: { supplier: { organisationId: ORG } } });
    await submitForApprovalCore(client, ORG, BUYER, po.id);
    const pending = await client.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } });
    expect(pending.status).toBe("PENDING_APPROVAL");
    const approval = await client.approvalRequest.findFirstOrThrow({ where: { kind: "PO_APPROVAL", entityId: po.id } });
    expect(approval.status).toBe("PENDING");

    await approveRequestCore(client, ORG, MANAGER, approval.id);
    const approved = await client.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } });
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedById).toBe(MANAGER.id);

    await transitionCore(client, ORG, BUYER, po.id, "SENT", "SEND");
    await transitionCore(client, ORG, BUYER, po.id, "SUPPLIER_CONFIRMED", "SUPPLIER_CONFIRM");
    // Phase 6 will set RECEIVED via goods receipt; simulate it here.
    await client.purchaseOrder.update({ where: { id: po.id }, data: { status: "RECEIVED" } });
    await transitionCore(client, ORG, BUYER, po.id, "CLOSED", "CLOSE");
    const closed = await client.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } });
    expect(closed.status).toBe("CLOSED");
  });

  it("refuses self-approval", async () => {
    const req = await client.purchaseRequirement.create({
      data: { productId, requiredQty: 24, reason: "self-approval check", status: "OPEN", createdBy: "USER" },
    });
    const [poId] = await convertRequirementsCore(client, ORG, MANAGER, [req.id]);
    await submitForApprovalCore(client, ORG, MANAGER, poId);
    const approval = await client.approvalRequest.findFirstOrThrow({ where: { kind: "PO_APPROVAL", entityId: poId } });
    await expect(approveRequestCore(client, ORG, MANAGER, approval.id)).rejects.toThrow("second person");
  });

  it("reopens requirements when the PO is cancelled", async () => {
    const req = await client.purchaseRequirement.create({
      data: { productId, requiredQty: 24, reason: "cancel check", status: "OPEN", createdBy: "USER" },
    });
    const [poId] = await convertRequirementsCore(client, ORG, BUYER, [req.id]);
    await transitionCore(client, ORG, BUYER, poId, "CANCELLED", "CANCEL");
    const reopened = await client.purchaseRequirement.findUniqueOrThrow({ where: { id: req.id } });
    expect(reopened.status).toBe("OPEN");
    expect(reopened.poId).toBeNull();
  });

  it("refuses to convert products without a supplier, naming the SKU", async () => {
    const orphan = await client.product.create({
      data: { organisationId: ORG, sku: "ORPHAN-1", name: "Orphan", salesUnit: "PCS", purchaseUnit: "PCS", conversionFactor: 1 },
    });
    const req = await client.purchaseRequirement.create({
      data: { productId: orphan.id, requiredQty: 5, reason: "orphan check", status: "OPEN", createdBy: "USER" },
    });
    await expect(convertRequirementsCore(client, ORG, BUYER, [req.id])).rejects.toThrow("ORPHAN-1");
  });
});
