import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { assertPermission } from "@/server/auth/permissions";
import { audit, activity } from "@/server/platform";
import { levelsFromAggregates } from "@/domain/stock";
import { PAGE_SIZE, pageOf, paged, type Actor } from "./util";
import { defaultWarehouse } from "./warehouses";

// ─── Categories ─────────────────────────────────────────────────────────────

export async function listCategories(orgId: string) {
  await assertPermission("products.view");
  return db.productCategory.findMany({
    where: { organisationId: orgId },
    orderBy: { name: "asc" },
    include: { _count: { select: { products: true } } },
  });
}

export async function createCategory(actor: Actor, name: string, parentId?: string) {
  const me = await assertPermission("products.manage");
  const clean = name.trim();
  if (!clean) throw new Error("Category name is required.");
  if (parentId) {
    const parent = await db.productCategory.findFirst({ where: { id: parentId, organisationId: actor.orgId } });
    if (!parent) throw new Error("The parent category was not found.");
  }
  const category = await db.productCategory.create({
    data: { organisationId: actor.orgId, name: clean, parentId: parentId || null },
  });
  await audit({ orgId: actor.orgId, action: "CREATE", entityType: "CATEGORY", entityId: category.id, newValue: category, actor: me });
  return category.id;
}

export async function deleteCategory(actor: Actor, id: string) {
  const me = await assertPermission("products.manage");
  const category = await db.productCategory.findFirst({
    where: { id, organisationId: actor.orgId },
    include: { _count: { select: { products: true, children: true } } },
  });
  if (!category) throw new Error("This category was not found.");
  if (category._count.products > 0 || category._count.children > 0) {
    throw new Error("This category contains products or sub-categories. Move them first.");
  }
  await db.productCategory.delete({ where: { id } });
  await audit({ orgId: actor.orgId, action: "DELETE", entityType: "CATEGORY", entityId: id, oldValue: { name: category.name }, actor: me });
}

// ─── Products ───────────────────────────────────────────────────────────────

const ProductSchema = z.object({
  sku: z.string().trim().min(1, "SKU is required.").max(64),
  barcode: z.string().trim().max(64).nullish(),
  name: z.string().trim().min(1, "Product name is required.").max(200),
  description: z.string().trim().max(2000).nullish(),
  categoryId: z.string().nullish(),
  salesUnit: z.string().trim().min(1).max(16).default("PCS"),
  purchaseUnit: z.string().trim().min(1).max(16).default("CTN"),
  conversionFactor: z.coerce.number().positive("Conversion factor must be positive.").default(1),
  costCents: z.coerce.number().int().min(0).default(0),
  standardPriceCents: z.coerce.number().int().min(0).default(0),
  vatRate: z.coerce.number().min(0).max(100).default(22),
  minStock: z.coerce.number().min(0).default(0),
  reorderPoint: z.coerce.number().min(0).default(0),
  safetyStock: z.coerce.number().min(0).default(0),
  leadTimeDays: z.coerce.number().int().min(0).max(365).default(7),
  supplierId: z.string().nullish(),
  openingStock: z.coerce.number().min(0).default(0),
});

export interface ProductStock {
  physical: number;
  reserved: number;
  available: number;
  incoming: number;
  projected: number;
}

export async function stockForProducts(productIds: string[]): Promise<Record<string, ProductStock>> {
  if (productIds.length === 0) return {};
  const [movements, reservations] = await Promise.all([
    db.inventoryMovement.groupBy({ by: ["productId"], where: { productId: { in: productIds } }, _sum: { quantity: true } }),
    db.inventoryReservation.groupBy({ by: ["productId"], where: { productId: { in: productIds } }, _sum: { quantity: true } }),
  ]);
  const out: Record<string, ProductStock> = {};
  for (const id of productIds) {
    const physical = movements.find((m) => m.productId === id)?._sum.quantity ?? 0;
    const reserved = reservations.find((r) => r.productId === id)?._sum.quantity ?? 0;
    // Aggregates are already physical-only (reservations live in their own
    // table), so no per-movement ledger filtering applies here.
    out[id] = levelsFromAggregates(physical, reserved, 0);
  }
  return out;
}

export async function stockByWarehouse(productId: string) {
  const [movements, reservations] = await Promise.all([
    db.inventoryMovement.groupBy({ by: ["warehouseId"], where: { productId }, _sum: { quantity: true } }),
    db.inventoryReservation.groupBy({ by: ["warehouseId"], where: { productId }, _sum: { quantity: true } }),
  ]);
  const warehouseIds = [...new Set([...movements.map((m) => m.warehouseId), ...reservations.map((r) => r.warehouseId)])];
  const warehouses = await db.warehouse.findMany({ where: { id: { in: warehouseIds } } });
  return warehouses.map((w) => {
    const physical = movements.find((m) => m.warehouseId === w.id)?._sum.quantity ?? 0;
    const reserved = reservations.find((r) => r.warehouseId === w.id)?._sum.quantity ?? 0;
    return { warehouse: w, ...levelsFromAggregates(physical, reserved, 0) };
  });
}

export async function listProducts(orgId: string, sp?: { q?: string; category?: string; status?: string; page?: string | string[] }) {
  await assertPermission("products.view");
  const q = (Array.isArray(sp?.q) ? sp?.q[0] : sp?.q)?.trim() ?? "";
  const categoryId = Array.isArray(sp?.category) ? sp?.category[0] : sp?.category;
  const status = Array.isArray(sp?.status) ? sp?.status[0] : sp?.status;
  const page = pageOf(sp as { page?: string });
  const where = {
    organisationId: orgId,
    ...(q ? { OR: [{ name: { contains: q } }, { sku: { contains: q } }, { barcode: { contains: q } }] } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(status ? { status } : {}),
  };
  const [total, items] = await Promise.all([
    db.product.count({ where }),
    db.product.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { category: true },
    }),
  ]);
  const stock = await stockForProducts(items.map((p) => p.id));
  return paged(items.map((p) => ({ ...p, stock: stock[p.id] })), total, page);
}

export async function getProduct(orgId: string, id: string) {
  await assertPermission("products.view");
  const product = await db.product.findFirst({
    where: { id, organisationId: orgId },
    include: {
      category: true,
      supplierLinks: { include: { supplier: true } },
      prices: { orderBy: { createdAt: "desc" }, take: 30 },
      customerPrices: { include: { customer: true }, orderBy: { createdAt: "desc" }, take: 30 },
      movements: { orderBy: { createdAt: "desc" }, take: 20, include: { warehouse: true } },
    },
  });
  if (!product) throw new Error("This product was not found.");
  const [stock, perWarehouse, events] = await Promise.all([
    stockForProducts([id]).then((s) => s[id]),
    stockByWarehouse(id),
    db.activityEvent.findMany({ where: { orgId, entityType: "PRODUCT", entityId: id }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  return { product, stock, perWarehouse, events };
}

export async function createProduct(actor: Actor, raw: unknown) {
  const me = await assertPermission("products.manage");
  const data = ProductSchema.parse(raw);
  if (data.categoryId) {
    const cat = await db.productCategory.findFirst({ where: { id: data.categoryId, organisationId: actor.orgId } });
    if (!cat) throw new Error("The selected category was not found.");
  }
  let supplierId: string | null = null;
  if (data.supplierId) {
    const sup = await db.supplier.findFirst({ where: { id: data.supplierId, organisationId: actor.orgId } });
    if (!sup) throw new Error("The selected supplier was not found.");
    supplierId = sup.id;
  }
  const warehouse = data.openingStock > 0 ? await defaultWarehouse(actor.orgId) : null;
  if (data.openingStock > 0 && !warehouse) throw new Error("Create a warehouse first to hold opening stock.");

  const product = await db.$transaction(async (tx) => {
    const created = await tx.product.create({
      data: {
        organisationId: actor.orgId,
        sku: data.sku.trim().toUpperCase(),
        barcode: data.barcode?.trim() || null,
        name: data.name.trim(),
        description: data.description?.trim() || null,
        categoryId: data.categoryId || null,
        salesUnit: data.salesUnit.trim().toUpperCase(),
        purchaseUnit: data.purchaseUnit.trim().toUpperCase(),
        conversionFactor: data.conversionFactor,
        costCents: data.costCents,
        standardPriceCents: data.standardPriceCents,
        vatRate: data.vatRate,
        minStock: data.minStock,
        reorderPoint: data.reorderPoint,
        safetyStock: data.safetyStock,
        leadTimeDays: data.leadTimeDays,
      },
    });
    await tx.productPrice.create({ data: { productId: created.id, kind: "STANDARD", priceCents: data.standardPriceCents, createdById: me.id } });
    if (supplierId) {
      await tx.productSupplier.create({ data: { productId: created.id, supplierId, costCents: data.costCents, isPreferred: true } });
    }
    if (warehouse && data.openingStock > 0) {
      await tx.inventoryMovement.create({
        data: {
          productId: created.id,
          warehouseId: warehouse.id,
          quantity: data.openingStock,
          type: "ADJUSTMENT_IN",
          reference: "OPENING",
          note: "Opening stock at product creation",
          actorId: me.id,
          actorName: me.name,
        },
      });
    }
    return created;
  });
  await audit({ orgId: actor.orgId, action: "CREATE", entityType: "PRODUCT", entityId: product.id, newValue: { sku: product.sku }, actor: me });
  await activity({ orgId: actor.orgId, entityType: "PRODUCT", entityId: product.id, message: `Product ${product.name} created.`, actor: me });
  return product.id;
}

export async function updateProduct(actor: Actor, id: string, raw: unknown) {
  const me = await assertPermission("products.manage");
  const data = ProductSchema.partial().omit({ supplierId: true, openingStock: true }).parse(raw);
  const before = await db.product.findFirst({ where: { id, organisationId: actor.orgId } });
  if (!before) throw new Error("This product was not found.");
  const product = await db.$transaction(async (tx) => {
    const updated = await tx.product.update({ where: { id }, data: emptyToNull(data) });
    // §9: a changed standard price appends history — it never rewrites the past.
    if (data.standardPriceCents !== undefined && data.standardPriceCents !== before.standardPriceCents) {
      await tx.productPrice.create({ data: { productId: id, kind: "STANDARD", priceCents: data.standardPriceCents, createdById: me.id } });
    }
    return updated;
  });
  await audit({ orgId: actor.orgId, action: "UPDATE", entityType: "PRODUCT", entityId: id, oldValue: { sku: before.sku }, newValue: { sku: product.sku }, actor: me });
  return product.id;
}

export async function deleteProduct(actor: Actor, id: string) {
  const me = await assertPermission("products.manage");
  const product = await db.product.findFirst({
    where: { id, organisationId: actor.orgId },
    include: { _count: { select: { movements: true, reservations: true, orderLines: true, poLines: true, receiptLines: true, invoiceLines: true } } },
  });
  if (!product) throw new Error("This product was not found.");
  const c = product._count;
  if (c.movements + c.reservations + c.orderLines + c.poLines + c.receiptLines + c.invoiceLines > 0) {
    throw new Error("This product has transactional history. Discontinue it instead of deleting.");
  }
  await db.product.delete({ where: { id } });
  await audit({ orgId: actor.orgId, action: "DELETE", entityType: "PRODUCT", entityId: id, oldValue: { sku: product.sku }, actor: me });
}

export async function discontinueProduct(actor: Actor, id: string, discontinued: boolean) {
  const me = await assertPermission("products.manage");
  const before = await db.product.findFirst({ where: { id, organisationId: actor.orgId } });
  if (!before) throw new Error("This product was not found.");
  await db.product.update({ where: { id }, data: { status: discontinued ? "DISCONTINUED" : "ACTIVE" } });
  await audit({ orgId: actor.orgId, action: discontinued ? "DISCONTINUE" : "REACTIVATE", entityType: "PRODUCT", entityId: id, actor: me });
}

const PriceRuleSchema = z.object({
  kind: z.enum(["GROUP", "PROMO", "CONTRACT"]),
  priceGroup: z.string().trim().max(64).nullish(),
  priceCents: z.coerce.number().int().min(0, "Price cannot be negative."),
  minQty: z.coerce.number().positive().default(1),
  validTo: z.string().optional(),
});

export async function addPriceRule(actor: Actor, productId: string, raw: unknown) {
  const me = await assertPermission("pricing.manage");
  const data = PriceRuleSchema.parse(raw);
  const product = await db.product.findFirst({ where: { id: productId, organisationId: actor.orgId } });
  if (!product) throw new Error("This product was not found.");
  if (data.kind === "GROUP" && !data.priceGroup?.trim()) throw new Error("A price group is required for group pricing.");
  const rule = await db.productPrice.create({
    data: {
      productId,
      kind: data.kind,
      priceGroup: data.priceGroup?.trim() || null,
      priceCents: data.priceCents,
      minQty: data.minQty,
      validTo: data.validTo ? new Date(data.validTo) : null,
      createdById: me.id,
    },
  });
  await audit({ orgId: actor.orgId, action: "PRICE_SET", entityType: "PRODUCT", entityId: productId, newValue: rule, actor: me });
  await activity({ orgId: actor.orgId, entityType: "PRODUCT", entityId: productId, message: `New ${data.kind.toLowerCase()} price rule added.`, actor: me });
  return rule.id;
}

export async function linkProductSupplier(actor: Actor, productId: string, supplierId: string, costCents: number, preferred: boolean) {
  const me = await assertPermission("products.manage");
  const [product, supplier] = await Promise.all([
    db.product.findFirst({ where: { id: productId, organisationId: actor.orgId } }),
    db.supplier.findFirst({ where: { id: supplierId, organisationId: actor.orgId } }),
  ]);
  if (!product) throw new Error("This product was not found.");
  if (!supplier) throw new Error("This supplier was not found.");
  if (!Number.isInteger(costCents) || costCents < 0) throw new Error("Cost cannot be negative.");
  await db.$transaction(async (tx) => {
    if (preferred) {
      await tx.productSupplier.updateMany({ where: { productId }, data: { isPreferred: false } });
    }
    await tx.productSupplier.upsert({
      where: { productId_supplierId: { productId, supplierId } },
      update: { costCents, isPreferred: preferred },
      create: { productId, supplierId, costCents, isPreferred: preferred },
    });
  });
  await audit({ orgId: actor.orgId, action: "SUPPLIER_LINK", entityType: "PRODUCT", entityId: productId, newValue: { supplierId, preferred }, actor: me });
}

/** Pricing overview page data: active special rules + customer prices (bounded lists). */
export async function pricingOverview(orgId: string, q: string) {
  await assertPermission("pricing.view");
  const where = q
    ? { product: { organisationId: orgId, OR: [{ name: { contains: q } }, { sku: { contains: q } }] } }
    : { product: { organisationId: orgId } };
  const [rules, customerPrices] = await Promise.all([
    db.productPrice.findMany({
      where: { ...where, kind: { in: ["GROUP", "PROMO", "CONTRACT"] } },
      include: { product: true },
      orderBy: { createdAt: "desc" },
      take: 60,
    }),
    db.customerPrice.findMany({
      where: q
        ? {
            OR: [
              { product: { organisationId: orgId, OR: [{ name: { contains: q } }, { sku: { contains: q } }] } },
              { customer: { organisationId: orgId, company: { contains: q } } },
            ],
          }
        : { customer: { organisationId: orgId } },
      include: { product: true, customer: true },
      orderBy: { createdAt: "desc" },
      take: 60,
    }),
  ]);
  return { rules, customerPrices };
}

/** Lightweight options for selects (products, warehouses) in operational forms. */
export async function productOptions(orgId: string) {
  await assertPermission("products.view");
  return db.product.findMany({
    where: { organisationId: orgId, status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: { id: true, sku: true, name: true, salesUnit: true, standardPriceCents: true, costCents: true, purchaseUnit: true, conversionFactor: true },
  });
}

export async function getLowStock(orgId: string, limit = 8) {
  await assertPermission("products.view");
  const products = await db.product.findMany({ where: { organisationId: orgId, status: "ACTIVE" } });
  const stock = await stockForProducts(products.map((p) => p.id));
  return products
    .map((p) => ({ product: p, stock: stock[p.id] }))
    .filter((r) => r.stock.available < r.product.reorderPoint)
    .sort((a, b) => a.stock.available - b.stock.available)
    .slice(0, limit);
}

function emptyToNull<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = v === "" ? null : v;
  return out as T;
}
