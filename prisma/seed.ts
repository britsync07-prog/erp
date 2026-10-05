// Seed: demo organisation with full RBAC matrix, one admin user, one warehouse,
// categories, suppliers, products (+supplier links, standard prices, opening
// stock as ADJUSTMENT_IN), and a few customers. Demo data only — replace via
// the import system / UI in real deployments.
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { ROLE_PERMISSIONS, type RoleCode } from "../src/domain/constants";

const db = new PrismaClient();

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@demo.local";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";

  // Production guard: seeding demo master data into a live database is a data
  // incident, and the demo admin password would be a takeover. Production
  // bootstrap must set SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD explicitly and use
  // a real password.
  if (process.env.NODE_ENV === "production") {
    const weak =
      !process.env.SEED_ADMIN_EMAIL ||
      !process.env.SEED_ADMIN_PASSWORD ||
      adminPassword === "ChangeMe123!" ||
      adminPassword.length < 12 ||
      process.env.SEED_ADMIN_EMAIL === "admin@demo.local";
    if (weak) {
      throw new Error(
        "Refusing to seed in production: set SEED_ADMIN_EMAIL to a real address and " +
          "SEED_ADMIN_PASSWORD to a strong password (12+ chars) that is not the demo value.",
      );
    }
    if (process.env.ALLOW_DEMO_SEED === "true") {
      console.warn("[seed] ALLOW_DEMO_SEED=true — demo master data is being written to production.");
    }
  }

  const org = await db.organisation.upsert({
    where: { id: "demo-org" },
    update: {},
    create: {
      id: "demo-org",
      name: "Demo Distribuzione Srl",
      vatNumber: "IT01234567890",
      email: "info@demo-distribuzione.it",
      city: "Milano",
      country: "IT",
      currency: "EUR",
      locale: "en",
    },
  });

  // Roles from the Phase 0 permission matrix.
  for (const code of Object.keys(ROLE_PERMISSIONS) as RoleCode[]) {
    await db.role.upsert({
      where: { organisationId_code: { organisationId: org.id, code } },
      update: { permissions: ROLE_PERMISSIONS[code] },
      create: {
        organisationId: org.id,
        code,
        name: code.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()),
        permissions: ROLE_PERMISSIONS[code],
        isSystem: true,
      },
    });
  }
  const ownerRole = await db.role.findUniqueOrThrow({
    where: { organisationId_code: { organisationId: org.id, code: "OWNER" } },
  });

  await db.user.upsert({
    where: { organisationId_email: { organisationId: org.id, email: adminEmail } },
    update: {},
    create: {
      organisationId: org.id,
      roleId: ownerRole.id,
      name: "Demo Owner",
      email: adminEmail,
      passwordHash: await bcrypt.hash(adminPassword, 12),
    },
  });

  const warehouse = await db.warehouse.upsert({
    where: { organisationId_code: { organisationId: org.id, code: "MI-01" } },
    update: {},
    create: { organisationId: org.id, code: "MI-01", name: "Milano Main", address: "Via delle Merci 10, Milano", isDefault: true },
  });

  for (const name of ["Carni & Döner", "Pane & Panificati", "Salse & Condimenti", "Bevande", "Imballaggi"]) {
    await db.productCategory.upsert({
      where: { organisationId_name: { organisationId: org.id, name } },
      update: {},
      create: { organisationId: org.id, name },
    });
  }
  const cat = async (name: string) =>
    db.productCategory.findUniqueOrThrow({ where: { organisationId_name: { organisationId: org.id, name } } });

  const supplierData = [
    { code: "SUP-001", company: "Anadolu Foods GmbH", email: "orders@anadolu-foods.de", leadTimeDays: 5 },
    { code: "SUP-002", company: "Panificio Milano Spa", email: "ordini@panificiomilano.it", leadTimeDays: 2 },
    { code: "SUP-003", company: "Salse d'Italia Srl", email: "vendite@salseditalia.it", leadTimeDays: 4 },
  ];
  for (const s of supplierData) {
    await db.supplier.upsert({
      where: { organisationId_code: { organisationId: org.id, code: s.code } },
      update: {},
      create: { organisationId: org.id, ...s },
    });
  }
  const sup = async (code: string) =>
    db.supplier.findUniqueOrThrow({ where: { organisationId_code: { organisationId: org.id, code } } });

  const products = [
    { sku: "DONER-POLLO-10", name: "Döner Pollo 10kg", category: "Carni & Döner", supplier: "SUP-001", cost: 4200, price: 5900, stock: 80, reorder: 40, safety: 40, conv: 1 },
    { sku: "DONER-VITELLO-10", name: "Döner Vitello 10kg", category: "Carni & Döner", supplier: "SUP-001", cost: 5800, price: 7900, stock: 55, reorder: 30, safety: 30, conv: 1 },
    { sku: "PANE-PIADINA-24", name: "Piadina sfogliata (ctn 24pz)", category: "Pane & Panificati", supplier: "SUP-002", cost: 120, price: 190, stock: 480, reorder: 240, safety: 200, conv: 24 },
    { sku: "SALSA-YOGURT-5", name: "Salsa yogurt 5kg", category: "Salse & Condimenti", supplier: "SUP-003", cost: 1400, price: 2100, stock: 36, reorder: 20, safety: 15, conv: 1 },
    { sku: "SALSA-PICC-5", name: "Salsa piccante 5kg", category: "Salse & Condimenti", supplier: "SUP-003", cost: 1350, price: 2050, stock: 12, reorder: 20, safety: 15, conv: 1 },
    { sku: "AYRAN-250-12", name: "Ayran 250ml (ctn 12pz)", category: "Bevande", supplier: "SUP-001", cost: 65, price: 110, stock: 300, reorder: 144, safety: 120, conv: 12 },
  ];
  for (const p of products) {
    const category = await cat(p.category);
    const supplier = await sup(p.supplier);
    const product = await db.product.upsert({
      where: { organisationId_sku: { organisationId: org.id, sku: p.sku } },
      update: {},
      create: {
        organisationId: org.id,
        sku: p.sku,
        name: p.name,
        categoryId: category.id,
        salesUnit: "PCS",
        purchaseUnit: "CTN",
        conversionFactor: p.conv,
        costCents: p.cost,
        standardPriceCents: p.price,
        vatRate: 10,
        minStock: p.safety,
        reorderPoint: p.reorder,
        safetyStock: p.safety,
      },
    });
    await db.productSupplier.upsert({
      where: { productId_supplierId: { productId: product.id, supplierId: supplier.id } },
      update: {},
      create: { productId: product.id, supplierId: supplier.id, costCents: p.cost, isPreferred: true },
    });
    await db.productPrice.create({
      data: { productId: product.id, kind: "STANDARD", priceCents: p.price },
    });
    const existing = await db.inventoryMovement.findFirst({
      where: { productId: product.id, warehouseId: warehouse.id, type: "ADJUSTMENT_IN" },
    });
    if (!existing) {
      await db.inventoryMovement.create({
        data: {
          productId: product.id,
          warehouseId: warehouse.id,
          quantity: p.stock,
          type: "ADJUSTMENT_IN",
          reference: "OPENING",
          note: "Opening stock (seed)",
          actorName: "system/seed",
        },
      });
    }
  }

  const customers = [
    { code: "CUS-001", company: "Kebab Roma Centro", email: "ordini@kebabroma.it", city: "Roma" },
    { code: "CUS-002", company: "Döner House Milano", email: "ciao@donerhouse.it", city: "Milano" },
    { code: "CUS-003", company: "Turkish Food Torino", email: "info@turkishfoodto.it", city: "Torino" },
  ];
  for (const c of customers) {
    const customer = await db.customer.upsert({
      where: { organisationId_code: { organisationId: org.id, code: c.code } },
      update: {},
      create: { organisationId: org.id, code: c.code, company: c.company, email: c.email, paymentTerms: "30_DAYS", creditLimitCents: 500000 },
    });
    const hasAddr = await db.customerAddress.findFirst({ where: { customerId: customer.id } });
    if (!hasAddr) {
      await db.customerAddress.create({
        data: { customerId: customer.id, kind: "DELIVERY", street: "Via Roma 1", city: c.city, country: "IT", isDefault: true },
      });
    }
  }

  console.log(`Seeded org ${org.id}. Admin login: ${adminEmail}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
