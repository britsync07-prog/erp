/**
 * Phase 8 flow test: delivered order → draft invoice (snapshotted totals) →
 * issue flips the order → partial then full payment walks invoice/order to PAID
 * → return + issued credit note reduces receivables. Overpayment refused.
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
import {
  createInvoiceFromOrderCore,
  issueInvoiceCore,
  recordPaymentCore,
  voidInvoiceCore,
  createCreditNoteFromReturnCore,
  issueCreditNoteCore,
  financeStats,
} from "@/server/services/finance";

const TEST_DB = path.resolve(process.cwd(), "prisma", "test-finance.db");
const ORG = "fin-org";
const ACTOR = { id: "fin-user", name: "Accountant", orgId: ORG };

let client: PrismaClient;
let productId: string;
let orderId: string;
let invoiceId: string;

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

  await client.organisation.create({ data: { id: ORG, name: "Fin Org", currency: "EUR", locale: "en" } });
  const warehouse = await client.warehouse.create({
    data: { organisationId: ORG, code: "FN-01", name: "Fin Warehouse", isDefault: true },
  });
  const customer = await client.customer.create({
    data: { organisationId: ORG, code: "CUS-FN", company: "Fin Customer", paymentTerms: "30_DAYS" },
  });
  const product = await client.product.create({
    data: {
      organisationId: ORG, sku: "FIN-1", name: "Fin Item",
      salesUnit: "PCS", purchaseUnit: "PCS", conversionFactor: 1,
      costCents: 100, standardPriceCents: 200, vatRate: 22,
    },
  });
  productId = product.id;
  await client.inventoryMovement.create({
    data: { productId, warehouseId: warehouse.id, quantity: 10, type: "ADJUSTMENT_IN", reference: "TEST-OPENING" },
  });

  const order = await client.salesOrder.create({
    data: { number: "ORD-FIN-1", customerId: customer.id, status: "DRAFT" },
  });
  await client.salesOrderLine.create({
    data: { orderId: order.id, productId, quantity: 4, unitPriceCents: 0, discountPct: 0, taxRate: 22 },
  });
  orderId = order.id;

  // Walk the order to DELIVERED through the real fulfilment cores.
  await confirmOrderCore(client, ORG, ACTOR, orderId);
  const fulfilmentId = (await client.fulfilment.findFirstOrThrow({ where: { orderId } })).id;
  await startPickingCore(client, ORG, ACTOR, fulfilmentId);
  await confirmPickCore(client, ORG, ACTOR, fulfilmentId, { picks: [{ productId, pickedQty: 4 }] });
  await dispatchCore(client, ORG, ACTOR, fulfilmentId, {});
  await markDeliveredCore(client, ORG, ACTOR, fulfilmentId);
}, 120000);

afterAll(async () => {
  await client?.$disconnect();
  try {
    await unlink(TEST_DB);
  } catch {
    /* best effort */
  }
});

describe("order-to-cash", () => {
  it("invoices snapshotted totals exactly once", async () => {
    invoiceId = await createInvoiceFromOrderCore(client, ORG, ACTOR, orderId);
    const inv = await client.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { lines: true } });
    // 4 × €2.00 = €8.00 + 22% = €9.76 → 976 cents
    expect(inv.totalCents).toBe(976);
    expect(inv.status).toBe("DRAFT");
    expect(inv.lines).toHaveLength(1);
    await expect(createInvoiceFromOrderCore(client, ORG, ACTOR, orderId)).rejects.toThrow("already has invoice");
  });

  it("walks invoice and order to PAID through partial payment", async () => {
    await issueInvoiceCore(client, ORG, ACTOR, invoiceId);
    const order = await client.salesOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("INVOICED");
    expect(order.paymentStatus).toBe("UNPAID");

    await recordPaymentCore(client, ORG, ACTOR, { invoiceId, amountCents: 400, method: "BANK_TRANSFER" });
    const partial = await client.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(partial.status).toBe("PARTIAL");
    expect(partial.paidCents).toBe(400);

    await expect(
      recordPaymentCore(client, ORG, ACTOR, { invoiceId, amountCents: 9999, method: "CASH" }),
    ).rejects.toThrow();

    await recordPaymentCore(client, ORG, ACTOR, { invoiceId, amountCents: 576, method: "BANK_TRANSFER" });
    const paid = await client.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(paid.status).toBe("PAID");
    const paidOrder = await client.salesOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(paidOrder.status).toBe("PAID");
    expect(paidOrder.paymentStatus).toBe("PAID");

    await expect(voidInvoiceCore(client, ORG, ACTOR, invoiceId)).rejects.toThrow();
  });

  it("credits returns against receivables", async () => {
    const returnId = await createReturnCore(client, ORG, ACTOR, {
      orderId,
      reason: "1 damaged on arrival",
      lines: [{ productId, quantity: 1, condition: "DAMAGED" }],
    });
    expect(typeof returnId).toBe("string");
    const ret = await client.salesReturn.findFirstOrThrow({ where: { order: { id: orderId } } });
    const noteId = await createCreditNoteFromReturnCore(client, ORG, ACTOR, ret.id);
    const note = await client.creditNote.findUniqueOrThrow({ where: { id: noteId } });
    expect(note.totalCents).toBe(200);
    await issueCreditNoteCore(client, ORG, ACTOR, noteId);

    const stats = await financeStats(ORG, client);
    // Fully paid invoice, one €2.00 issued credit → net −200 (we owe the customer).
    expect(stats.outstanding).toBe(-200);
  });
});
