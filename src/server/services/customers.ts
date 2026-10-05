import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { assertPermission } from "@/server/auth/permissions";
import { audit, activity } from "@/server/platform";
import { PAGE_SIZE, pageOf, paged, suggestCode, type Actor } from "./util";

const CustomerSchema = z.object({
  code: z.string().trim().min(1, "Code is required.").max(32),
  company: z.string().trim().min(1, "Company name is required.").max(160),
  vatNumber: z.string().trim().max(32).nullish(),
  fiscalCode: z.string().trim().max(32).nullish(),
  email: z.string().trim().max(160).nullish(),
  phone: z.string().trim().max(40).nullish(),
  paymentTerms: z.enum(["IMMEDIATE", "30_DAYS", "60_DAYS", "90_DAYS", "CUSTOM"]).default("30_DAYS"),
  creditLimitCents: z.coerce.number().int().min(0).default(0),
  priceGroup: z.string().trim().max(64).nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

const AddressSchema = z.object({
  kind: z.enum(["BILLING", "DELIVERY"]).default("DELIVERY"),
  label: z.string().trim().max(80).nullish(),
  street: z.string().trim().min(1, "Street is required.").max(200),
  city: z.string().trim().min(1, "City is required.").max(120),
  postal: z.string().trim().max(20).nullish(),
  province: z.string().trim().max(10).nullish(),
  country: z.string().trim().max(2).default("IT"),
  isDefault: z.coerce.boolean().default(false),
});

const ContactSchema = z.object({
  name: z.string().trim().min(1, "Contact name is required.").max(120),
  role: z.string().trim().max(80).nullish(),
  phone: z.string().trim().max(40).nullish(),
  email: z.string().trim().max(160).nullish(),
});

const CustomerPriceSchema = z.object({
  productId: z.string().min(1),
  priceCents: z.coerce.number().int().min(0, "Price cannot be negative."),
  minQty: z.coerce.number().positive().default(1),
  validTo: z.string().optional(),
});

/** Lightweight options for selects in operational forms. */
export async function customerOptions(orgId: string) {
  await assertPermission("customers.view");
  return db.customer.findMany({
    where: { organisationId: orgId, status: "ACTIVE" },
    orderBy: { company: "asc" },
    select: { id: true, company: true, code: true },
  });
}

export async function suggestCustomerCode(orgId: string) {
  await assertPermission("customers.view");
  return suggestCode(() => db.customer.count({ where: { organisationId: orgId } }), "CUS");
}

export async function listCustomers(orgId: string, sp?: { q?: string; page?: string | string[] }) {
  await assertPermission("customers.view");
  const q = (Array.isArray(sp?.q) ? sp?.q[0] : sp?.q)?.trim() ?? "";
  const page = pageOf(sp as { page?: string });
  const where = {
    organisationId: orgId,
    ...(q
      ? { OR: [{ company: { contains: q } }, { code: { contains: q } }, { email: { contains: q } }] }
      : {}),
  };
  const [total, items] = await Promise.all([
    db.customer.count({ where }),
    db.customer.findMany({
      where,
      orderBy: { company: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { _count: { select: { orders: true, invoices: true } } },
    }),
  ]);
  return paged(items, total, page);
}

export async function getCustomer(orgId: string, id: string) {
  await assertPermission("customers.view");
  const customer = await db.customer.findFirst({
    where: { id, organisationId: orgId },
    include: {
      addresses: { orderBy: [{ isDefault: "desc" }, { kind: "asc" }] },
      contacts: true,
      prices: { include: { product: true }, orderBy: { createdAt: "desc" }, take: 50 },
      _count: { select: { orders: true, invoices: true } },
    },
  });
  if (!customer) throw new Error("This customer was not found.");
  const [events, balanceAgg, creditAgg, recentOrders] = await Promise.all([
    db.activityEvent.findMany({
      where: { orgId, entityType: "CUSTOMER", entityId: id },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    db.invoice.aggregate({
      where: { customerId: id, status: { notIn: ["VOID", "PAID"] } },
      _sum: { totalCents: true, paidCents: true },
    }),
    db.creditNote.aggregate({
      where: { customerId: id, status: "ISSUED" },
      _sum: { totalCents: true },
    }),
    db.salesOrder.findMany({
      where: { customerId: id },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);
  // Outstanding = open invoice balances minus issued credit notes.
  const balanceCents =
    (balanceAgg._sum.totalCents ?? 0) - (balanceAgg._sum.paidCents ?? 0) - (creditAgg._sum.totalCents ?? 0);
  return { customer, events, balanceCents, recentOrders };
}

export async function createCustomer(actor: Actor, raw: unknown) {
  const me = await assertPermission("customers.manage");
  const data = CustomerSchema.parse(raw);
  const customer = await db.customer.create({
    data: { organisationId: actor.orgId, ...emptyToNull(data) },
  });
  await audit({ orgId: actor.orgId, action: "CREATE", entityType: "CUSTOMER", entityId: customer.id, newValue: customer, actor: me });
  await activity({ orgId: actor.orgId, entityType: "CUSTOMER", entityId: customer.id, message: `Customer ${customer.company} created.`, actor: me });
  return customer.id;
}

export async function updateCustomer(actor: Actor, id: string, raw: unknown) {
  const me = await assertPermission("customers.manage");
  const data = CustomerSchema.partial().parse(raw);
  const before = await db.customer.findFirst({ where: { id, organisationId: actor.orgId } });
  if (!before) throw new Error("This customer was not found.");
  const customer = await db.customer.update({ where: { id }, data: emptyToNull(data) });
  await audit({ orgId: actor.orgId, action: "UPDATE", entityType: "CUSTOMER", entityId: id, oldValue: before, newValue: customer, actor: me });
  await activity({ orgId: actor.orgId, entityType: "CUSTOMER", entityId: id, message: "Customer details updated.", actor: me });
  return customer.id;
}

export async function archiveCustomer(actor: Actor, id: string, archived: boolean) {
  const me = await assertPermission("customers.manage");
  const before = await db.customer.findFirst({ where: { id, organisationId: actor.orgId } });
  if (!before) throw new Error("This customer was not found.");
  await db.customer.update({ where: { id }, data: { status: archived ? "ARCHIVED" : "ACTIVE" } });
  await audit({ orgId: actor.orgId, action: archived ? "ARCHIVE" : "RESTORE", entityType: "CUSTOMER", entityId: id, oldValue: before.status, newValue: archived ? "ARCHIVED" : "ACTIVE", actor: me });
}

export async function deleteCustomer(actor: Actor, id: string) {
  const me = await assertPermission("customers.manage");
  const customer = await db.customer.findFirst({
    where: { id, organisationId: actor.orgId },
    include: { _count: { select: { orders: true, invoices: true } } },
  });
  if (!customer) throw new Error("This customer was not found.");
  if (customer._count.orders > 0 || customer._count.invoices > 0) {
    throw new Error("This customer has orders or invoices. Archive it instead of deleting.");
  }
  await db.customer.delete({ where: { id } });
  await audit({ orgId: actor.orgId, action: "DELETE", entityType: "CUSTOMER", entityId: id, oldValue: { code: customer.code }, actor: me });
}

export async function addCustomerAddress(actor: Actor, customerId: string, raw: unknown) {
  const me = await assertPermission("customers.manage");
  const customer = await db.customer.findFirst({ where: { id: customerId, organisationId: actor.orgId } });
  if (!customer) throw new Error("This customer was not found.");
  const data = AddressSchema.parse(raw);
  const address = await db.$transaction(async (tx) => {
    if (data.isDefault) {
      await tx.customerAddress.updateMany({ where: { customerId, kind: data.kind }, data: { isDefault: false } });
    }
    return tx.customerAddress.create({ data: { customerId, ...emptyToNull(data) } });
  });
  await audit({ orgId: actor.orgId, action: "CREATE", entityType: "CUSTOMER_ADDRESS", entityId: address.id, newValue: address, actor: me });
  return address.id;
}

export async function addCustomerContact(actor: Actor, customerId: string, raw: unknown) {
  const me = await assertPermission("customers.manage");
  const customer = await db.customer.findFirst({ where: { id: customerId, organisationId: actor.orgId } });
  if (!customer) throw new Error("This customer was not found.");
  const data = ContactSchema.parse(raw);
  const contact = await db.customerContact.create({ data: { customerId, ...emptyToNull(data) } });
  await audit({ orgId: actor.orgId, action: "CREATE", entityType: "CUSTOMER_CONTACT", entityId: contact.id, newValue: contact, actor: me });
  return contact.id;
}

export async function setCustomerPrice(actor: Actor, customerId: string, raw: unknown) {
  const me = await assertPermission("pricing.manage");
  const data = CustomerPriceSchema.parse(raw);
  const [customer, product] = await Promise.all([
    db.customer.findFirst({ where: { id: customerId, organisationId: actor.orgId } }),
    db.product.findFirst({ where: { id: data.productId, organisationId: actor.orgId } }),
  ]);
  if (!customer) throw new Error("This customer was not found.");
  if (!product) throw new Error("This product was not found.");
  const price = await db.customerPrice.create({
    data: {
      customerId,
      productId: data.productId,
      priceCents: data.priceCents,
      minQty: data.minQty,
      validTo: data.validTo ? new Date(data.validTo) : null,
      createdById: me.id,
    },
  });
  await audit({ orgId: actor.orgId, action: "PRICE_SET", entityType: "CUSTOMER", entityId: customerId, newValue: price, actor: me });
  await activity({ orgId: actor.orgId, entityType: "CUSTOMER", entityId: customerId, message: `Custom price set for ${product.name}.`, actor: me });
  return price.id;
}

function emptyToNull<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = v === "" ? null : v;
  return out as T;
}
