/**
 * Phase 6 flow test: partial receipt with damage → ledger gets GOOD stock only,
 * PO goes partial → full receipt unblocks the waiting order (READY + reservation
 * + sales notification), overdelivery is recorded, not blocked.
 */
import { execSync } from "node:child_process";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { confirmOrderCore } from "@/server/services/orders";
import { receiveGoodsCore } from "@/server/services/receiving";

const TEST_DB = path.resolve(process.cwd(), "prisma", "test-receive.db");
const ORG = "recv-org";
const ACTOR = { id: "recv-user", name: "Receiver", orgId: ORG };

let client: PrismaClient;
let productId: string;
let poId: string;
let orderId: string;

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

  await client.organisation.create({ data: { id: ORG, name: "Recv Org", currency: "EUR", locale: "en" } });
  const warehouse = await client.warehouse.create({
    data: { organisationId: ORG, code: "R-01", name: "Recv Warehouse", isDefault: true },
  });
  const supplier = await client.supplier.create({
    data: { organisationId: ORG, code: "SUP-R", company: "Recv Supplier", leadTimeDays: 3 },
  });
  const customer = await client.customer.create({
    data: { organisationId: ORG, code: "CUS-R", company: "Recv Customer" },
  });
  const product = await client.product.create({
    data: {
      organisationId: ORG, sku: "RECV-1", name: "Recv Item",
      salesUnit: "PCS", purchaseUnit: "PCS", conversionFactor: 1,
      costCents: 100, standardPriceCents: 200,
    },
  });
  productId = product.id;
  await client.productSupplier.create({
    data: { productId, supplierId: supplier.id, costCents: 100, isPreferred: true },
  });

  // Customer order for 10 units with zero stock → WAITING_FOR_STOCK.
  const order = await client.salesOrder.create({
    data: { number: "ORD-RECV-1", customerId: customer.id, status: "DRAFT" },
  });
  await client.salesOrderLine.create({
    data: { orderId: order.id, productId, quantity: 10, unitPriceCents: 0, discountPct: 0, taxRate: 22 },
  });
  orderId = order.id;
  const confirmed = await confirmOrderCore(client, ORG, ACTOR, orderId);
  expect(confirmed.status).toBe("WAITING_FOR_STOCK");

  // Supplier PO for 10 units, already sent.
  const po = await client.purchaseOrder.create({
    data: {
      number: "PO-RECV-1", supplierId: supplier.id, warehouseId: warehouse.id,
      status: "SENT", subtotalCents: 1000, taxCents: 220, totalCents: 1220,
    },
  });
  await client.purchaseOrderLine.create({
    data: { poId: po.id, productId, quantity: 10, unitCostCents: 100 },
  });
  poId = po.id;
}, 120000);

afterAll(async () => {
  await client?.$disconnect();
  try {
    await unlink(TEST_DB);
  } catch {
    /* best effort */
  }
});

describe("goods receiving flow", () => {
  it("posts partial receipts with damaged stock excluded from inventory", async () => {
    const r = await receiveGoodsCore(client, ORG, ACTOR, {
      poId,
      lines: [{ productId, receivedQty: 6, damagedQty: 1 }],
    });
    expect(r.readyOrders).toHaveLength(0);

    const receipt = await client.goodsReceipt.findUniqueOrThrow({
      where: { id: r.receiptId },
      include: { lines: true },
    });
    expect(receipt.lines[0]).toMatchObject({ receivedQty: 6, damagedQty: 1 });

    // Only the 5 GOOD units hit the ledger.
    const moves = await client.inventoryMovement.findMany({ where: { reference: receipt.code } });
    expect(moves).toHaveLength(1);
    expect(moves[0].quantity).toBe(5);
    expect(moves[0].type).toBe("PURCHASE_RECEIPT");

    const po = await client.purchaseOrder.findUniqueOrThrow({ where: { id: poId } });
    expect(po.status).toBe("PARTIALLY_RECEIVED");
    const order = await client.salesOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("WAITING_FOR_STOCK");
  });

  it("unblocks the waiting order when the balance arrives, flagging overdelivery", async () => {
    const r = await receiveGoodsCore(client, ORG, ACTOR, {
      poId,
      lines: [{ productId, receivedQty: 6, damagedQty: 0 }],
    });
    // 5 already in + 6 now = 11 against 10 ordered → over by 1, accepted.
    expect(r.overdelivered).toContain("RECV-1");

    const po = await client.purchaseOrder.findUniqueOrThrow({ where: { id: poId } });
    expect(po.status).toBe("RECEIVED");

    const order = await client.salesOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("READY");
    expect(r.readyOrders).toContain("ORD-RECV-1");

    const reserved = await client.inventoryReservation.aggregate({
      where: { orderId },
      _sum: { quantity: true },
    });
    expect(reserved._sum.quantity).toBe(10);

    const salesNote = await client.notification.findFirst({
      where: { roleCode: "SALES", title: { contains: "ORD-RECV-1" } },
    });
    expect(salesNote).not.toBeNull();
  });
});
