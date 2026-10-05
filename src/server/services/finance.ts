import "server-only";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { db } from "@/server/db";
import { assertPermission } from "@/server/auth/permissions";
import { audit, activity, notify } from "@/server/platform";
import { assertTransition, computeOrderTotals } from "@/domain/orders";
import { dueDateFor, applyPayment, agingBucket, isOverdue, PAYMENT_METHODS } from "@/domain/finance";
import { PAGE_SIZE, pageOf, paged, type Actor } from "./util";

// Operational finance (§19): invoices from delivered work, partial payments,
// receivables aging, credit notes from returns, margins. Full fiscal accounting
// stays with the certified Italian accountant integration (Phase 11).

// ─── Invoices ───────────────────────────────────────────────────────────────

export async function listInvoices(
  orgId: string,
  sp?: { q?: string; status?: string; customer?: string; overdue?: string; page?: string | string[] },
) {
  await assertPermission("finance.view");
  const q = (Array.isArray(sp?.q) ? sp?.q[0] : sp?.q)?.trim() ?? "";
  const status = Array.isArray(sp?.status) ? sp?.status[0] : sp?.status;
  const customerId = Array.isArray(sp?.customer) ? sp?.customer[0] : sp?.customer;
  const overdueOnly = sp?.overdue === "1";
  const page = pageOf(sp as { page?: string });
  const where = {
    customer: { organisationId: orgId },
    ...(q ? { number: { contains: q } } : {}),
    ...(status ? { status } : {}),
    ...(customerId ? { customerId } : {}),
  };
  if (overdueOnly) {
    const all = await db.invoice.findMany({
      where: { ...where, status: { in: ["ISSUED", "PARTIAL"] } },
      orderBy: { dueDate: "asc" },
      take: 500,
      include: { customer: { select: { company: true, code: true } } },
    });
    const rows = all
      .map((i) => ({ ...i, balance: i.totalCents - i.paidCents }))
      .filter((i) => isOverdue(i.dueDate, i.balance));
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    const safe = Math.min(page, pages);
    return { ...paged(rows.slice((safe - 1) * PAGE_SIZE, safe * PAGE_SIZE), rows.length, safe), overdueOnly: true };
  }
  const [total, items] = await Promise.all([
    db.invoice.count({ where }),
    db.invoice.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { customer: { select: { company: true, code: true } } },
    }),
  ]);
  const rows = items.map((i) => ({
    ...i,
    balance: i.totalCents - i.paidCents,
    overdue: isOverdue(i.dueDate, i.totalCents - i.paidCents),
  }));
  return { ...paged(rows, total, page), overdueOnly: false };
}

export async function getInvoice(orgId: string, id: string) {
  await assertPermission("finance.view");
  const invoice = await db.invoice.findFirst({
    where: { id, customer: { organisationId: orgId } },
    include: {
      customer: true,
      order: { select: { id: true, number: true, status: true } },
      lines: { include: { product: { select: { sku: true } } } },
      payments: { orderBy: { paidAt: "desc" } },
    },
  });
  if (!invoice) throw new Error("This invoice was not found.");
  const events = await db.activityEvent.findMany({
    where: { orgId, entityType: "INVOICE", entityId: id },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  const balance = invoice.totalCents - invoice.paidCents;
  return { invoice, events, balance, overdue: isOverdue(invoice.dueDate, balance) };
}

/** Delivered orders with no live invoice — the invoicing work queue. */
export async function invoiceableOrders(orgId: string) {
  await assertPermission("finance.view");
  const orders = await db.salesOrder.findMany({
    where: { customer: { organisationId: orgId }, status: "DELIVERED" },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true, number: true, totalCents: true,
      customer: { select: { company: true } },
      invoices: { where: { status: { not: "VOID" } }, select: { id: true } },
    },
  });
  return orders.filter((o) => o.invoices.length === 0);
}

async function nextNumber(client: PrismaClient, orgId: string, prefix: "INV" | "CN"): Promise<string> {
  const n = prefix === "INV"
    ? await client.invoice.count({ where: { customer: { organisationId: orgId } } })
    : await client.creditNote.count({ where: { customer: { organisationId: orgId } } });
  return `${prefix}-${String(n + 1).padStart(4, "0")}`;
}

export async function createInvoiceFromOrderCore(client: PrismaClient, orgId: string, actor: Actor, orderId: string): Promise<string> {
  const order = await client.salesOrder.findFirst({
    where: { id: orderId, customer: { organisationId: orgId } },
    include: { customer: true, lines: { include: { product: true } } },
  });
  if (!order) throw new Error("This order was not found.");
  if (order.status !== "DELIVERED") throw new Error("Only delivered orders can be invoiced.");
  const existing = await client.invoice.findFirst({ where: { orderId, status: { not: "VOID" } } });
  if (existing) throw new Error(`Order already has invoice ${existing.number}.`);
  const billable = order.lines.filter((l) => l.fulfilledQty > 0);
  if (billable.length === 0) throw new Error("Nothing fulfilled on this order yet.");

  const totals = computeOrderTotals(
    billable.map((l) => ({ quantity: l.fulfilledQty, unitPriceCents: l.unitPriceCents, discountPct: l.discountPct, taxRate: l.taxRate })),
  );
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const invoice = await client.invoice.create({
        data: {
          number: await nextNumber(client, orgId, "INV"),
          customerId: order.customerId,
          orderId: order.id,
          status: "DRAFT",
          dueDate: dueDateFor(new Date(), order.customer.paymentTerms),
          subtotalCents: totals.subtotalCents,
          taxCents: totals.taxCents,
          totalCents: totals.totalCents,
          paidCents: 0,
          createdById: actor.id,
          lines: {
            create: billable.map((l) => ({
              productId: l.productId,
              description: `${l.product.sku} — ${l.product.name}`,
              quantity: l.fulfilledQty,
              unitPriceCents: l.unitPriceCents,
              taxRate: l.taxRate,
            })),
          },
        },
      });
      await audit({ orgId, action: "CREATE", entityType: "INVOICE", entityId: invoice.id, newValue: { number: invoice.number }, actor, client });
      await activity({ orgId, entityType: "ORDER", entityId: order.id, message: `Draft invoice ${invoice.number} created.`, actor, client });
      return invoice.id;
    } catch (e) {
      if (e instanceof Error && e.message.includes("P2002")) continue;
      throw e;
    }
  }
  throw new Error("Could not assign an invoice number. Please try again.");
}

export async function createInvoiceFromOrder(actor: Actor, orderId: string) {
  const me = await assertPermission("finance.manage");
  return createInvoiceFromOrderCore(db, actor.orgId, me, orderId);
}

export async function issueInvoiceCore(client: PrismaClient, orgId: string, actor: Actor, id: string) {
  const invoice = await client.invoice.findFirst({
    where: { id, customer: { organisationId: orgId } },
    include: { order: true },
  });
  if (!invoice) throw new Error("This invoice was not found.");
  if (invoice.status !== "DRAFT") throw new Error("Only draft invoices can be issued.");
  await client.invoice.update({ where: { id }, data: { status: "ISSUED", issueDate: new Date() } });
  if (invoice.orderId && invoice.order && invoice.order.status === "DELIVERED") {
    assertTransition("DELIVERED", "INVOICED");
    await client.salesOrder.update({ where: { id: invoice.orderId }, data: { status: "INVOICED", paymentStatus: "UNPAID" } });
  }
  await audit({ orgId, action: "ISSUE", entityType: "INVOICE", entityId: id, oldValue: { status: "DRAFT" }, newValue: { status: "ISSUED" }, actor, client });
  await activity({ orgId, entityType: "INVOICE", entityId: id, message: `Invoice ${invoice.number} issued.`, actor, client });
  if (invoice.orderId) {
    await activity({ orgId, entityType: "ORDER", entityId: invoice.orderId, message: `Order invoiced (${invoice.number}).`, actor, client });
  }
}

export async function issueInvoice(actor: Actor, id: string) {
  const me = await assertPermission("finance.manage");
  await issueInvoiceCore(db, actor.orgId, me, id);
}

export async function setInvoiceDueDate(actor: Actor, id: string, dueDate: string) {
  const me = await assertPermission("finance.manage");
  const invoice = await db.invoice.findFirst({ where: { id, customer: { organisationId: actor.orgId } } });
  if (!invoice) throw new Error("This invoice was not found.");
  if (invoice.status !== "DRAFT") throw new Error("Only draft invoices can be edited.");
  if (!dueDate) throw new Error("A due date is required.");
  await db.invoice.update({ where: { id }, data: { dueDate: new Date(dueDate) } });
  await audit({ orgId: actor.orgId, action: "UPDATE", entityType: "INVOICE", entityId: id, actor: me });
}

export async function deleteInvoice(actor: Actor, id: string) {
  const me = await assertPermission("finance.manage");
  const invoice = await db.invoice.findFirst({ where: { id, customer: { organisationId: actor.orgId } } });
  if (!invoice) throw new Error("This invoice was not found.");
  if (invoice.status !== "DRAFT") throw new Error("Only draft invoices can be deleted.");
  await db.invoiceLine.deleteMany({ where: { invoiceId: id } });
  await db.invoice.delete({ where: { id } });
  await audit({ orgId: actor.orgId, action: "DELETE", entityType: "INVOICE", entityId: id, oldValue: { number: invoice.number }, actor: me });
}

export async function voidInvoiceCore(client: PrismaClient, orgId: string, actor: Actor, id: string) {
  const invoice = await client.invoice.findFirst({
    where: { id, customer: { organisationId: orgId } },
    include: { order: true },
  });
  if (!invoice) throw new Error("This invoice was not found.");
  if (invoice.status !== "DRAFT" && invoice.status !== "ISSUED") {
    throw new Error("Only draft or issued invoices can be voided.");
  }
  if (invoice.paidCents > 0) throw new Error("Invoices with payments cannot be voided. Issue a credit note instead.");
  await client.invoice.update({ where: { id }, data: { status: "VOID" } });
  if (invoice.orderId && invoice.order && invoice.order.status === "INVOICED") {
    assertTransition("INVOICED", "DELIVERED");
    await client.salesOrder.update({ where: { id: invoice.orderId }, data: { status: "DELIVERED", paymentStatus: "UNPAID" } });
  }
  await audit({ orgId, action: "VOID", entityType: "INVOICE", entityId: id, actor, client });
  await activity({ orgId, entityType: "INVOICE", entityId: id, message: `Invoice ${invoice.number} voided.`, actor, client });
}

export async function voidInvoice(actor: Actor, id: string) {
  const me = await assertPermission("finance.manage");
  await voidInvoiceCore(db, actor.orgId, me, id);
}

// ─── Payments ───────────────────────────────────────────────────────────────

const PaymentSchema = z.object({
  invoiceId: z.string().min(1),
  amountCents: z.coerce.number().int().min(1, "Amount must be positive."),
  method: z.enum(PAYMENT_METHODS),
  paidAt: z.string().optional(),
  reference: z.string().trim().max(120).nullish(),
});

export async function recordPaymentCore(client: PrismaClient, orgId: string, actor: Actor, raw: unknown) {
  const data = PaymentSchema.parse(raw);
  const invoice = await client.invoice.findFirst({
    where: { id: data.invoiceId, customer: { organisationId: orgId } },
    include: { order: true },
  });
  if (!invoice) throw new Error("This invoice was not found.");
  if (invoice.status !== "ISSUED" && invoice.status !== "PARTIAL") {
    throw new Error("Payments can only be recorded against issued invoices.");
  }
  const applied = applyPayment(invoice.totalCents, invoice.paidCents, data.amountCents);
  await client.$transaction([
    client.payment.create({
      data: {
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        amountCents: data.amountCents,
        method: data.method,
        paidAt: data.paidAt ? new Date(data.paidAt) : new Date(),
        reference: data.reference?.trim() || null,
        createdById: actor.id,
      },
    }),
    client.invoice.update({ where: { id: invoice.id }, data: { paidCents: applied.newPaidCents, status: applied.invoiceStatus } }),
  ]);
  if (invoice.orderId && invoice.order) {
    const orderPaymentStatus = applied.invoiceStatus === "PAID" ? "PAID" : "PARTIAL";
    const updates: Record<string, string> = { paymentStatus: orderPaymentStatus };
    if (applied.invoiceStatus === "PAID" && invoice.order.status === "INVOICED") {
      assertTransition("INVOICED", "PAID");
      updates.status = "PAID";
    }
    await client.salesOrder.update({ where: { id: invoice.orderId }, data: updates });
  }
  await audit({ orgId, action: "PAYMENT", entityType: "INVOICE", entityId: invoice.id, newValue: { amountCents: data.amountCents, status: applied.invoiceStatus }, actor, client });
  await activity({
    orgId, entityType: "INVOICE", entityId: invoice.id,
    message: `Payment of €${(data.amountCents / 100).toFixed(2)} recorded (${data.method}).`, actor, client,
  });
  if (invoice.orderId) {
    await activity({ orgId, entityType: "ORDER", entityId: invoice.orderId, message: `Payment recorded against ${invoice.number}.`, actor, client });
  }
  return applied;
}

export async function recordPayment(actor: Actor, raw: unknown) {
  const me = await assertPermission("finance.manage");
  return recordPaymentCore(db, actor.orgId, me, raw);
}

// ─── Receivables ────────────────────────────────────────────────────────────

export async function receivablesBoard(orgId: string, client: PrismaClient = db) {
  await assertPermission("finance.view");
  const [open, credits] = await Promise.all([
    client.invoice.findMany({
      where: { customer: { organisationId: orgId }, status: { in: ["ISSUED", "PARTIAL"] } },
      orderBy: { dueDate: "asc" },
      take: 500,
      include: { customer: { select: { id: true, company: true, code: true } }, order: { select: { number: true } } },
    }),
    client.creditNote.groupBy({
      by: ["customerId"],
      where: { status: "ISSUED", customer: { organisationId: orgId } },
      _sum: { totalCents: true },
    }),
  ]);
  const creditByCustomer = new Map(credits.map((c) => [c.customerId, c._sum.totalCents ?? 0]));
  const rows = open.map((i) => {
    const balance = i.totalCents - i.paidCents;
    return { ...i, balance, overdue: isOverdue(i.dueDate, balance), bucket: agingBucket(i.dueDate) };
  });
  const totals = {
    open: rows.reduce((s, r) => s + r.balance, 0),
    overdue: rows.filter((r) => r.overdue).reduce((s, r) => s + r.balance, 0),
    buckets: {
      CURRENT: 0, D1_30: 0, D31_60: 0, D60_PLUS: 0,
    } as Record<string, number>,
  };
  for (const r of rows) {
    if (r.bucket) totals.buckets[r.bucket] += r.balance;
  }
  const byCustomer = new Map<string, { id: string; company: string; code: string; invoiced: number; credits: number; net: number }>();
  for (const r of rows) {
    const cur = byCustomer.get(r.customer.id) ?? { id: r.customer.id, company: r.customer.company, code: r.customer.code, invoiced: 0, credits: 0, net: 0 };
    cur.invoiced += r.balance;
    byCustomer.set(r.customer.id, cur);
  }
  for (const [customerId, amount] of creditByCustomer) {
    const cur = byCustomer.get(customerId);
    if (cur) cur.credits = amount;
    // Credits without open invoices still reduce what the customer owes overall.
  }
  for (const cur of byCustomer.values()) cur.net = cur.invoiced - cur.credits;
  return { rows, totals, byCustomer: [...byCustomer.values()].sort((a, b) => b.net - a.net) };
}

// ─── Credit notes ───────────────────────────────────────────────────────────

export async function eligibleReturnsForCredit(orgId: string) {
  await assertPermission("finance.view");
  const returns = await db.salesReturn.findMany({
    where: { order: { customer: { organisationId: orgId } }, status: "COMPLETED" },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, code: true, order: { select: { number: true, customer: { select: { company: true } } } } },
  });
  const credited = await db.creditNote.findMany({
    where: { returnId: { in: returns.map((r) => r.id) }, status: { not: "VOID" } },
    select: { returnId: true },
  });
  const used = new Set(credited.map((c) => c.returnId));
  return returns.filter((r) => !used.has(r.id));
}

export async function createCreditNoteFromReturnCore(client: PrismaClient, orgId: string, actor: Actor, returnId: string): Promise<string> {
  const ret = await client.salesReturn.findFirst({
    where: { id: returnId, order: { customer: { organisationId: orgId } } },
    include: { order: { include: { customer: true, lines: true } }, lines: { include: { product: true } } },
  });
  if (!ret) throw new Error("This return was not found.");
  const existing = await client.creditNote.findFirst({ where: { returnId, status: { not: "VOID" } } });
  if (existing) throw new Error(`Return already has credit note ${existing.number}.`);
  const priceByProduct = new Map(ret.order.lines.map((l) => [l.productId, l.unitPriceCents]));
  let total = 0;
  const lines = ret.lines.map((l) => {
    const unit = priceByProduct.get(l.productId) ?? 0;
    total += Math.round(l.quantity * unit);
    return {
      productId: l.productId,
      description: `${l.product.sku} × ${l.quantity} (${l.condition}, return ${ret.code})`,
      quantity: l.quantity,
      unitPriceCents: unit,
    };
  });
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const note = await client.creditNote.create({
        data: {
          number: await nextNumber(client, orgId, "CN"),
          customerId: ret.order.customerId,
          returnId: ret.id,
          totalCents: total,
          reason: `Return ${ret.code} for order ${ret.order.number}`,
          status: "DRAFT",
          createdById: actor.id,
          lines: { create: lines },
        },
      });
      await audit({ orgId, action: "CREATE", entityType: "CREDIT_NOTE", entityId: note.id, newValue: { number: note.number }, actor, client });
      await activity({ orgId, entityType: "ORDER", entityId: ret.orderId, message: `Draft credit note ${note.number} created from return ${ret.code}.`, actor, client });
      return note.id;
    } catch (e) {
      if (e instanceof Error && e.message.includes("P2002")) continue;
      throw e;
    }
  }
  throw new Error("Could not assign a credit note number. Please try again.");
}

export async function createCreditNoteFromReturn(actor: Actor, returnId: string) {
  const me = await assertPermission("finance.manage");
  return createCreditNoteFromReturnCore(db, actor.orgId, me, returnId);
}

export async function issueCreditNoteCore(client: PrismaClient, orgId: string, actor: Actor, id: string) {
  const note = await client.creditNote.findFirst({ where: { id, customer: { organisationId: orgId } } });
  if (!note) throw new Error("This credit note was not found.");
  if (note.status !== "DRAFT") throw new Error("Only draft credit notes can be issued.");
  await client.creditNote.update({ where: { id }, data: { status: "ISSUED" } });
  await audit({ orgId, action: "ISSUE", entityType: "CREDIT_NOTE", entityId: id, actor, client });
  await activity({ orgId, entityType: "CREDIT_NOTE", entityId: id, message: `Credit note ${note.number} issued.`, actor, client });
  await notify({ orgId, severity: "INFO", roleCode: "SALES", title: `Credit note ${note.number} issued`, link: `/finance/credit-notes/${id}`, client });
}

export async function issueCreditNote(actor: Actor, id: string) {
  const me = await assertPermission("finance.manage");
  await issueCreditNoteCore(db, actor.orgId, me, id);
}

export async function voidCreditNote(actor: Actor, id: string) {
  const me = await assertPermission("finance.manage");
  const note = await db.creditNote.findFirst({ where: { id, customer: { organisationId: actor.orgId } } });
  if (!note) throw new Error("This credit note was not found.");
  if (note.status !== "DRAFT") throw new Error("Only draft credit notes can be voided.");
  await db.creditNote.update({ where: { id }, data: { status: "VOID" } });
  await audit({ orgId: actor.orgId, action: "VOID", entityType: "CREDIT_NOTE", entityId: id, actor: me });
}

export async function listCreditNotes(orgId: string, page = 1) {
  await assertPermission("finance.view");
  const where = { customer: { organisationId: orgId } };
  const [total, items] = await Promise.all([
    db.creditNote.count({ where }),
    db.creditNote.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { customer: { select: { company: true, code: true } }, _count: { select: { lines: true } } },
    }),
  ]);
  return paged(items, total, page);
}

export async function getCreditNote(orgId: string, id: string) {
  await assertPermission("finance.view");
  const note = await db.creditNote.findFirst({
    where: { id, customer: { organisationId: orgId } },
    include: { customer: true, lines: { include: { product: { select: { sku: true } } } } },
  });
  if (!note) throw new Error("This credit note was not found.");
  const ret = note.returnId
    ? await db.salesReturn.findFirst({ where: { id: note.returnId }, select: { id: true, code: true, orderId: true } })
    : null;
  return { note, return: ret };
}

// ─── Margins ────────────────────────────────────────────────────────────────

export async function marginsBoard(orgId: string, client: PrismaClient = db) {
  await assertPermission("finance.view");
  const orders = await client.salesOrder.findMany({
    where: { customer: { organisationId: orgId }, status: { in: ["DELIVERED", "INVOICED", "PAID"] } },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { customer: { select: { company: true } } },
  });
  const products = await client.product.findMany({
    where: { organisationId: orgId, status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: { id: true, sku: true, name: true, costCents: true, standardPriceCents: true },
  });
  const orderRows = orders.map((o) => {
    const net = o.totalCents - o.taxCents;
    const margin = net - o.costCents;
    return { ...o, net, margin, pct: net > 0 ? (margin / net) * 100 : 0 };
  });
  const totals = orderRows.reduce(
    (s, r) => ({ revenue: s.revenue + r.net, cost: s.cost + r.costCents, margin: s.margin + r.margin }),
    { revenue: 0, cost: 0, margin: 0 },
  );
  const productRows = products.map((p) => ({
    ...p,
    margin: p.standardPriceCents - p.costCents,
    pct: p.standardPriceCents > 0 ? ((p.standardPriceCents - p.costCents) / p.standardPriceCents) * 100 : 0,
  }));
  return { orders: orderRows, products: productRows, totals, pct: totals.revenue > 0 ? (totals.margin / totals.revenue) * 100 : 0 };
}

export async function financeStats(orgId: string, client: PrismaClient = db) {
  const [open, credits, overdue] = await Promise.all([
    client.invoice.aggregate({
      where: { customer: { organisationId: orgId }, status: { in: ["ISSUED", "PARTIAL"] } },
      _sum: { totalCents: true, paidCents: true },
    }),
    client.creditNote.aggregate({
      where: { customer: { organisationId: orgId }, status: "ISSUED" },
      _sum: { totalCents: true },
    }),
    client.invoice.findMany({
      where: { customer: { organisationId: orgId }, status: { in: ["ISSUED", "PARTIAL"] } },
      select: { totalCents: true, paidCents: true, dueDate: true },
      take: 1000,
    }),
  ]);
  const outstanding = (open._sum.totalCents ?? 0) - (open._sum.paidCents ?? 0) - (credits._sum.totalCents ?? 0);
  const overdueCount = overdue.filter((i) => isOverdue(i.dueDate, i.totalCents - i.paidCents)).length;
  return { outstanding, overdueCount };
}
