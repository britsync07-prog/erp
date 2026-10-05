/**
 * Phase 7 flow test: pick (partial then complete) → dispatch posts ledger +
 * releases reservations → deliver → restock return re-enters stock, damaged
 * does not → order walks READY → DELIVERED → PARTIALLY_RETURNED → RETURNED.
 */
import { execSync } from "node:child_process";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { confirmOrderCore } from "@/server/services/orders";
import {
  startPickingCore,
  confirmPickCore,
  dispatchCore,
  markDeliveredCore,
  createReturnCore,
} from "@/server/services/fulfilment";

const TEST_DB = path.resolve(process.cwd(), "prisma", "test-fulfil.db");
const ORG = "fulfil-org";
const ACTOR = { id: "fulfil-user", name: "Picker", orgId: ORG };

let client: PrismaClient;
let productId: string;
let orderId: string;
let fulfilmentId: string;

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

  await client.organisation.create({ data: { id: ORG, name: "Fulfil Org", currency: "EUR", locale: "en" } });
  const warehouse = await client.warehouse.create({
    data: { organisationId: ORG, code: "F-01", name: "Fulfil Warehouse", isDefault: true },
  });
  const customer = await client.customer.create({
    data: { organisationId: ORG, code: "CUS-F", company: "Fulfil Customer" },
  });
  const product = await client.product.create({
    data: {
      organisationId: ORG, sku: "FUL-1", name: "Fulfil Item",
      salesUnit: "PCS", purchaseUnit: "PCS", conversionFactor: 1,
      costCents: 100, standardPriceCents: 200,
    },
  });
  productId = product.id;
  await client.inventoryMovement.create({
    data: { productId, warehouseId: warehouse.id, quantity: 10, type: "ADJUSTMENT_IN", reference: "TEST-OPENING" },
  });

  const order = await client.salesOrder.create({
    data: { number: "ORD-FUL-1", customerId: customer.id, status: "DRAFT" },
  });
  await client.salesOrderLine.create({
    data: { orderId: order.id, productId, quantity: 6, unitPriceCents: 0, discountPct: 0, taxRate: 22 },
  });
  orderId = order.id;
  const confirmed = await confirmOrderCore(client, ORG, ACTOR, orderId);
  expect(confirmed.status).toBe("READY");
  fulfilmentId = (await client.fulfilment.findFirstOrThrow({ where: { orderId } })).id;
}, 120000);

afterAll(async () => {
  await client?.$disconnect();
  try {
    await unlink(TEST_DB);
  } catch {
    /* best effort */
  }
});

describe("fulfilment flow", () => {
  it("picks partially, then completes", async () => {
    await startPickingCore(client, ORG, ACTOR, fulfilmentId);
    const partial = await confirmPickCore(client, ORG, ACTOR, fulfilmentId, {
      picks: [{ productId, pickedQty: 4 }],
    });
    expect(partial).toBe(false);
    await expect(
      confirmPickCore(client, ORG, ACTOR, fulfilmentId, { picks: [{ productId, pickedQty: 99 }] }),
    ).rejects.toThrow();
    const done = await confirmPickCore(client, ORG, ACTOR, fulfilmentId, {
      picks: [{ productId, pickedQty: 6 }],
    });
    expect(done).toBe(true);
    const f = await client.fulfilment.findUniqueOrThrow({ where: { id: fulfilmentId } });
    expect(f.status).toBe("READY_TO_DISPATCH");
  });

  it("dispatches exactly once, posting ledger and releasing reservations", async () => {
    await dispatchCore(client, ORG, ACTOR, fulfilmentId, { carrier: "DHL", tracking: "TRK-1" });
    const moves = await client.inventoryMovement.findMany({ where: { type: "SALE_DISPATCH" } });
    expect(moves).toHaveLength(1);
    expect(moves[0].quantity).toBe(-6);
    const res = await client.inventoryReservation.count({ where: { orderId } });
    expect(res).toBe(0);
    const order = await client.salesOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
    expect(order.status).toBe("DISPATCHED");
    expect(order.lines[0].fulfilledQty).toBe(6);
    const shipment = await client.shipment.findFirstOrThrow({ where: { fulfilmentId } });
    expect(shipment.tracking).toBe("TRK-1");
    await expect(dispatchCore(client, ORG, ACTOR, fulfilmentId, {})).rejects.toThrow();
  });

  it("delivers, then processes restock and damaged returns correctly", async () => {
    await markDeliveredCore(client, ORG, ACTOR, fulfilmentId);
    const delivered = await client.salesOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(delivered.status).toBe("DELIVERED");

    await createReturnCore(client, ORG, ACTOR, {
      orderId,
      reason: "2 cartons refused",
      lines: [{ productId, quantity: 2, condition: "RESTOCK" }],
    });
    const restock = await client.inventoryMovement.findMany({ where: { type: "CUSTOMER_RETURN" } });
    expect(restock).toHaveLength(1);
    expect(restock[0].quantity).toBe(2);
    const partial = await client.salesOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(partial.status).toBe("PARTIALLY_RETURNED");

    await createReturnCore(client, ORG, ACTOR, {
      orderId,
      reason: "4 spoiled in transit",
      lines: [{ productId, quantity: 4, condition: "DAMAGED" }],
    });
    const damagedMoves = await client.inventoryMovement.count({ where: { type: "DAMAGED" } });
    expect(damagedMoves).toBe(0);
    const returned = await client.salesOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(returned.status).toBe("RETURNED");

    // Nothing left to return.
    await expect(
      createReturnCore(client, ORG, ACTOR, {
        orderId,
        lines: [{ productId, quantity: 1, condition: "RESTOCK" }],
      }),
    ).rejects.toThrow();

    const financeNote = await client.notification.findFirst({
      where: { roleCode: "FINANCE", title: { contains: "credit note" } },
    });
    expect(financeNote).not.toBeNull();
  });
});
