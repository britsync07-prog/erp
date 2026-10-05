import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { assertPermission } from "@/server/auth/permissions";
import { audit, activity } from "@/server/platform";
import { PAGE_SIZE, pageOf, paged, suggestCode, type Actor } from "./util";

const SupplierSchema = z.object({
  code: z.string().trim().min(1, "Code is required.").max(32),
  company: z.string().trim().min(1, "Company name is required.").max(160),
  vatNumber: z.string().trim().max(32).nullish(),
  email: z.string().trim().max(160).nullish(),
  phone: z.string().trim().max(40).nullish(),
  paymentTerms: z.enum(["IMMEDIATE", "30_DAYS", "60_DAYS", "90_DAYS", "CUSTOM"]).default("30_DAYS"),
  leadTimeDays: z.coerce.number().int().min(0).max(365).default(7),
  notes: z.string().trim().max(2000).nullish(),
});

const ContactSchema = z.object({
  name: z.string().trim().min(1, "Contact name is required.").max(120),
  role: z.string().trim().max(80).nullish(),
  phone: z.string().trim().max(40).nullish(),
  email: z.string().trim().max(160).nullish(),
});

/** Lightweight options for selects in operational forms. */
export async function supplierOptions(orgId: string) {
  await assertPermission("suppliers.view");
  return db.supplier.findMany({
    where: { organisationId: orgId, status: "ACTIVE" },
    orderBy: { company: "asc" },
    select: { id: true, company: true, code: true },
  });
}

export async function suggestSupplierCode(orgId: string) {
  await assertPermission("suppliers.view");
  return suggestCode(() => db.supplier.count({ where: { organisationId: orgId } }), "SUP");
}

export async function listSuppliers(orgId: string, sp?: { q?: string; page?: string | string[] }) {
  await assertPermission("suppliers.view");
  const q = (Array.isArray(sp?.q) ? sp?.q[0] : sp?.q)?.trim() ?? "";
  const page = pageOf(sp as { page?: string });
  const where = {
    organisationId: orgId,
    ...(q ? { OR: [{ company: { contains: q } }, { code: { contains: q } }] } : {}),
  };
  const [total, items] = await Promise.all([
    db.supplier.count({ where }),
    db.supplier.findMany({
      where,
      orderBy: { company: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { _count: { select: { purchaseOrders: true, productLinks: true } } },
    }),
  ]);
  return paged(items, total, page);
}

export async function getSupplier(orgId: string, id: string) {
  await assertPermission("suppliers.view");
  const supplier = await db.supplier.findFirst({
    where: { id, organisationId: orgId },
    include: {
      contacts: true,
      productLinks: { include: { product: true } },
      purchaseOrders: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  });
  if (!supplier) throw new Error("This supplier was not found.");
  const events = await db.activityEvent.findMany({
    where: { orgId, entityType: "SUPPLIER", entityId: id },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  return { supplier, events };
}

export async function createSupplier(actor: Actor, raw: unknown) {
  const me = await assertPermission("suppliers.manage");
  const data = SupplierSchema.parse(raw);
  const supplier = await db.supplier.create({
    data: { organisationId: actor.orgId, ...emptyToNull(data) },
  });
  await audit({ orgId: actor.orgId, action: "CREATE", entityType: "SUPPLIER", entityId: supplier.id, newValue: supplier, actor: me });
  await activity({ orgId: actor.orgId, entityType: "SUPPLIER", entityId: supplier.id, message: `Supplier ${supplier.company} created.`, actor: me });
  return supplier.id;
}

export async function updateSupplier(actor: Actor, id: string, raw: unknown) {
  const me = await assertPermission("suppliers.manage");
  const data = SupplierSchema.partial().parse(raw);
  const before = await db.supplier.findFirst({ where: { id, organisationId: actor.orgId } });
  if (!before) throw new Error("This supplier was not found.");
  const supplier = await db.supplier.update({ where: { id }, data: emptyToNull(data) });
  await audit({ orgId: actor.orgId, action: "UPDATE", entityType: "SUPPLIER", entityId: id, oldValue: before, newValue: supplier, actor: me });
  return supplier.id;
}

export async function archiveSupplier(actor: Actor, id: string, archived: boolean) {
  const me = await assertPermission("suppliers.manage");
  const before = await db.supplier.findFirst({ where: { id, organisationId: actor.orgId } });
  if (!before) throw new Error("This supplier was not found.");
  await db.supplier.update({ where: { id }, data: { status: archived ? "ARCHIVED" : "ACTIVE" } });
  await audit({ orgId: actor.orgId, action: archived ? "ARCHIVE" : "RESTORE", entityType: "SUPPLIER", entityId: id, oldValue: before.status, newValue: archived ? "ARCHIVED" : "ACTIVE", actor: me });
}

export async function deleteSupplier(actor: Actor, id: string) {
  const me = await assertPermission("suppliers.manage");
  const supplier = await db.supplier.findFirst({
    where: { id, organisationId: actor.orgId },
    include: { _count: { select: { purchaseOrders: true, productLinks: true } } },
  });
  if (!supplier) throw new Error("This supplier was not found.");
  if (supplier._count.purchaseOrders > 0 || supplier._count.productLinks > 0) {
    throw new Error("This supplier is linked to products or purchase orders. Archive it instead of deleting.");
  }
  await db.supplier.delete({ where: { id } });
  await audit({ orgId: actor.orgId, action: "DELETE", entityType: "SUPPLIER", entityId: id, oldValue: { code: supplier.code }, actor: me });
}

export async function addSupplierContact(actor: Actor, supplierId: string, raw: unknown) {
  const me = await assertPermission("suppliers.manage");
  const supplier = await db.supplier.findFirst({ where: { id: supplierId, organisationId: actor.orgId } });
  if (!supplier) throw new Error("This supplier was not found.");
  const data = ContactSchema.parse(raw);
  const contact = await db.supplierContact.create({ data: { supplierId, ...emptyToNull(data) } });
  await audit({ orgId: actor.orgId, action: "CREATE", entityType: "SUPPLIER_CONTACT", entityId: contact.id, newValue: contact, actor: me });
  return contact.id;
}

function emptyToNull<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = v === "" ? null : v;
  return out as T;
}
