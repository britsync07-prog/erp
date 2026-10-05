/**
 * §42 critical workflow test: two orders race for the final 20 units.
 * The system must never reserve more than physically exists.
 *
 * Runs against an isolated SQLite file (never the dev database) and drives the
 * REAL confirm transaction (confirmOrderCore) concurrently.
 */
import { execSync } from "node:child_process";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { confirmOrderCore, StockConflictError } from "@/server/services/orders";

const TEST_DB = path.resolve(process.cwd(), "prisma", "test-race.db");
const ACTOR = { id: "race-tester", name: "Race Tester", orgId: "race-org" };

let client: PrismaClient;

async function confirmWithRetry(orderId: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await confirmOrderCore(client, ACTOR.orgId, ACTOR, orderId);
    } catch (e) {
      if (e instanceof StockConflictError && attempt < 2) continue;
      throw e;
    }
  }
  throw new Error("unreachable");
}

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

  const org = await client.organisation.create({
    data: { id: ACTOR.orgId, name: "Race Org", currency: "EUR", locale: "en" },
  });
  const warehouse = await client.warehouse.create({
    data: { organisationId: org.id, code: "T-01", name: "Race Warehouse", isDefault: true },
  });
  const customer = await client.customer.create({
    data: { organisationId: org.id, code: "CUS-R1", company: "Race Customer" },
  });
  const product = await client.product.create({
    data: {
      organisationId: org.id, sku: "RACE-001", name: "Race Product",
      salesUnit: "PCS", purchaseUnit: "PCS", conversionFactor: 1,
      costCents: 100, standardPriceCents: 200, reorderPoint: 5,
    },
  });
  // Exactly 20 units physically in stock.
  await client.inventoryMovement.create({
    data: { productId: product.id, warehouseId: warehouse.id, quantity: 20, type: "ADJUSTMENT_IN", reference: "TEST-OPENING" },
  });

  for (const n of ["ORD-RACE-A", "ORD-RACE-B"]) {
    const order = await client.salesOrder.create({
      data: { number: n, customerId: customer.id, status: "DRAFT" },
    });
    await client.salesOrderLine.create({
      data: { orderId: order.id, productId: product.id, quantity: 20, unitPriceCents: 0, discountPct: 0, taxRate: 22 },
    });
  }
}, 120000);

afterAll(async () => {
  await client?.$disconnect();
  try {
    await unlink(TEST_DB);
  } catch {
    /* best effort */
  }
});

describe("concurrent reservation race", () => {
  it("never reserves more than the 20 units on hand", async () => {
    const [a, b] = await client.salesOrder.findMany({ orderBy: { number: "asc" } });
    const [ra, rb] = await Promise.all([confirmWithRetry(a.id), confirmWithRetry(b.id)]);

    const totalReserved = await client.inventoryReservation.aggregate({
      where: { product: { sku: "RACE-001" } },
      _sum: { quantity: true },
    });
    expect(totalReserved._sum.quantity ?? 0).toBeLessThanOrEqual(20);

    // One order wins fully; the other waits with a recorded shortage.
    const statuses = [ra.status, rb.status].sort();
    expect(statuses).toEqual(["READY", "WAITING_FOR_STOCK"]);

    const winner = ra.status === "READY" ? ra : rb;
    const loser = ra.status === "READY" ? rb : ra;
    expect(winner.allocated).toBe(20);
    expect(loser.shortage).toBe(20);

    const reqs = await client.purchaseRequirement.findMany({ where: { status: "OPEN" } });
    expect(reqs.length).toBe(1);
    expect(reqs[0].requiredQty).toBe(20);
  }, 60000);
});
