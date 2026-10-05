/**
 * Phase 10 orchestration tests (isolated DB):
 *  - Level B tools execute immediately through the copilot loop (logged).
 *  - Level C tools only file approvals; a second human's approval executes.
 *  - Rejection closes both the approval and the AI action.
 *  - Recommendation findings execute one-click (B only).
 *  - The automation monitor raises requirements/alerts exactly once.
 *  - Agents are focused views: finance sees no stock tools.
 */
import { execSync } from "node:child_process";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PERMISSIONS } from "@/domain/constants";
import { askCopilot } from "@/server/ai/copilot";
import { AGENTS } from "@/server/ai/agents";
import { toolsFor } from "@/server/ai/tools";
import { executeRecommendationCore } from "@/server/ai/brief";
import { approveRequestCore, rejectRequestCore } from "@/server/services/approvals";
import { runMonitor } from "@/server/ai/automation";

const TEST_DB = path.resolve(process.cwd(), "prisma", "test-orch.db");
const ORG = "orch-org";
const REQUESTER = {
  id: "orch-asker", name: "Asker", orgId: ORG,
  permissions: ["procurement.manage", "inventory.manage", "orders.view"] as const,
};
const MANAGER = {
  id: "orch-manager", name: "Manager", orgId: ORG,
  permissions: [...PERMISSIONS],
};

let client: PrismaClient;
let productId: string;
let supplierId: string;

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

  await client.organisation.create({ data: { id: ORG, name: "Orch Org", currency: "EUR", locale: "en" } });
  const warehouse = await client.warehouse.create({
    data: { organisationId: ORG, code: "O-01", name: "Orch Warehouse", isDefault: true },
  });
  const supplier = await client.supplier.create({
    data: { organisationId: ORG, code: "SUP-O", company: "Orch Supplier", leadTimeDays: 3 },
  });
  supplierId = supplier.id;
  const customer = await client.customer.create({
    data: { organisationId: ORG, code: "CUS-O", company: "Orch Customer", paymentTerms: "30_DAYS" },
  });
  const product = await client.product.create({
    data: {
      organisationId: ORG, sku: "ORCH-1", name: "Orch Item",
      salesUnit: "PCS", purchaseUnit: "PCS", conversionFactor: 1,
      costCents: 100, standardPriceCents: 200, reorderPoint: 20, safetyStock: 15,
    },
  });
  productId = product.id;
  await client.productSupplier.create({
    data: { productId, supplierId: supplier.id, costCents: 100, isPreferred: true },
  });
  await client.inventoryMovement.create({
    data: { productId, warehouseId: warehouse.id, quantity: 2, type: "ADJUSTMENT_IN", reference: "TEST-OPENING" },
  });

  // Overdue invoice (for the monitor).
  const inv = await client.invoice.create({
    data: {
      number: "INV-O-1", customerId: customer.id, status: "ISSUED",
      issueDate: new Date("2020-01-01"), dueDate: new Date("2020-02-01"),
      subtotalCents: 1000, taxCents: 220, totalCents: 1220, paidCents: 0,
    },
  });
  await client.invoiceLine.create({
    data: { invoiceId: inv.id, productId, description: "x", quantity: 5, unitPriceCents: 200, taxRate: 22 },
  });

  // Late purchase order (expected long past, still receivable).
  const po = await client.purchaseOrder.create({
    data: {
      number: "PO-O-1", supplierId: supplier.id, warehouseId: warehouse.id,
      status: "SENT", expectedDate: new Date("2020-03-01"),
      subtotalCents: 1000, taxCents: 220, totalCents: 1220,
    },
  });
  await client.purchaseOrderLine.create({
    data: { poId: po.id, productId, quantity: 10, unitCostCents: 100 },
  });

  // Stale waiting order (created 5 days ago).
  const order = await client.salesOrder.create({
    data: { number: "ORD-O-1", customerId: customer.id, status: "WAITING_FOR_STOCK", createdAt: new Date(Date.now() - 5 * 86400000) },
  });
  await client.salesOrderLine.create({
    data: { orderId: order.id, productId, quantity: 10, unitPriceCents: 200, discountPct: 0, taxRate: 22 },
  });
}, 120000);

afterAll(async () => {
  await client?.$disconnect();
  try {
    await unlink(TEST_DB);
  } catch {
    /* best effort */
  }
});

describe("write-tool levels", () => {
  it("executes Level B immediately through the copilot loop", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const answer = await askCopilot(
      { ...REQUESTER, permissions: [...REQUESTER.permissions] },
      "Raise a requirement for more stock",
      [],
      (async () => ({
        content: null,
        toolCalls: [{ id: "w1", name: "create_requirement", args: { productId, qty: 9, reason: "orchestration test" } }],
        tokens: 40,
      })) as never,
      client,
    );
    delete process.env.OPENAI_API_KEY;
    expect(answer.mode).toBe("ai");
    expect(answer.toolsUsed).toContain("create_requirement");
    const req = await client.purchaseRequirement.findFirst({ where: { productId, status: "OPEN" } });
    expect(req).not.toBeNull();
    expect(req!.requiredQty).toBe(9);
    expect(req!.createdBy).toBe("AI");
    const logged = await client.aIAction.findFirst({
      where: { tool: "create_requirement", status: "DONE" },
      orderBy: { createdAt: "desc" },
    });
    expect(logged).not.toBeNull();
    expect(logged!.level).toBe("B_DRAFT");
  });

  it("files Level C for approval and only executes on a second human's approval", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    // Approved PO ready to send.
    const po = await client.purchaseOrder.create({
      data: {
        number: "PO-O-SEND", supplierId, warehouseId: (await client.warehouse.findFirstOrThrow({ where: { organisationId: ORG } })).id,
        status: "APPROVED", subtotalCents: 100, taxCents: 22, totalCents: 122,
      },
    });
    await askCopilot(
      { ...REQUESTER, permissions: [...REQUESTER.permissions, "intelligence.manage"] },
      "Send the approved PO",
      [],
      (async () => ({
        content: null,
        toolCalls: [{ id: "w2", name: "send_purchase_order", args: { poId: po.id } }],
        tokens: 40,
      })) as never,
      client,
    );
    delete process.env.OPENAI_API_KEY;

    // Proposed, NOT executed.
    const still = await client.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } });
    expect(still.status).toBe("APPROVED");
    const pending = await client.aIAction.findFirst({ where: { tool: "send_purchase_order", status: "PENDING_APPROVAL" } });
    expect(pending).not.toBeNull();
    const approval = await client.approvalRequest.findFirstOrThrow({ where: { kind: "AI_ACTION", status: "PENDING" } });
    expect((approval.payload as { tool?: string }).tool).toBe("send_purchase_order");

    // A different human approves → executes.
    await approveRequestCore(client, ORG, MANAGER, approval.id);
    const sent = await client.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } });
    expect(sent.status).toBe("SENT");
    const done = await client.aIAction.findUniqueOrThrow({ where: { id: pending!.id } });
    expect(done.status).toBe("DONE");
  });

  it("rejection closes the approval and the AI action without side effects", async () => {
    const action = await client.aIAction.create({
      data: {
        orgId: ORG, level: "C_APPROVAL_REQUIRED", tool: "send_purchase_order",
        input: { poId: "missing" }, userId: REQUESTER.id, status: "PENDING_APPROVAL",
      },
    });
    const approval = await client.approvalRequest.create({
      data: {
        orgId: ORG, kind: "AI_ACTION", entityId: action.id,
        payload: { actionId: action.id, tool: "send_purchase_order", args: { poId: "missing" } },
        requestedBy: REQUESTER.id, reason: "test rejection",
      },
    });
    await rejectRequestCore(client, ORG, MANAGER, approval.id, "not yet");
    const closed = await client.aIAction.findUniqueOrThrow({ where: { id: action.id } });
    expect(closed.status).toBe("REJECTED");
  });
});

describe("recommendation engine", () => {
  it("executes one-click Level B actions and accepts the finding", async () => {
    const finding = await client.aIRecommendation.create({
      data: {
        orgId: ORG, kind: "STOCK_RISK", title: "ORCH-1 low",
        reason: "test", status: "OPEN",
        evidence: { proposedAction: { tool: "create_requirement", args: { productId, qty: 5, reason: "one-click test" } } },
      },
    });
    const r = await executeRecommendationCore(client, ORG, REQUESTER, finding.id);
    expect(r.link).toBe("/procurement/requirements");
    const done = await client.aIRecommendation.findUniqueOrThrow({ where: { id: finding.id } });
    expect(done.status).toBe("ACCEPTED");
  });
});

describe("automation monitor", () => {
  it("raises requirements and digests exactly once", async () => {
    // A fresh low product with no open requirement (earlier tests opened one
    // for ORCH-1, which the monitor must NOT duplicate).
    const warehouse = await client.warehouse.findFirstOrThrow({ where: { organisationId: ORG } });
    const fresh = await client.product.create({
      data: {
        organisationId: ORG, sku: "ORCH-2", name: "Orch Item 2",
        salesUnit: "PCS", purchaseUnit: "PCS", conversionFactor: 1,
        costCents: 50, standardPriceCents: 90, reorderPoint: 10, safetyStock: 8,
      },
    });
    await client.inventoryMovement.create({
      data: { productId: fresh.id, warehouseId: warehouse.id, quantity: 1, type: "ADJUSTMENT_IN", reference: "TEST-OPENING" },
    });

    const first = await runMonitor(ORG, client, "test");
    expect(first.requirements).toBeGreaterThanOrEqual(1);
    expect(first.notifications.length).toBeGreaterThanOrEqual(3);
    const titles = first.notifications.join(" | ");
    expect(titles).toContain("Overdue invoices");
    expect(titles).toContain("Late supplier");
    expect(titles).toContain("Stale waiting");

    const openReqs = await client.purchaseRequirement.count({ where: { product: { organisationId: ORG }, status: "OPEN" } });
    const second = await runMonitor(ORG, client, "test");
    expect(second.requirements).toBe(0);
    expect(second.notifications).toHaveLength(0);
    expect(await client.purchaseRequirement.count({ where: { product: { organisationId: ORG }, status: "OPEN" } })).toBe(openReqs);
  });
});

describe("specialised agents", () => {
  it("scopes the finance agent away from stock tools", () => {
    const finance = AGENTS.find((a) => a.code === "FINANCE")!;
    const names = toolsFor([...PERMISSIONS]).filter((t) => finance.tools.includes(t.name)).map((t) => t.name);
    expect(names).toContain("receivables_snapshot");
    expect(names).not.toContain("stock_risks");
  });
});
