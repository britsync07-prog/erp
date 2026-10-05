import "server-only";
import type { PrismaClient } from "@prisma/client";
import { db } from "@/server/db";
import { assertPermission } from "@/server/auth/permissions";
import { audit } from "@/server/platform";
import type { Actor } from "./util";

export async function listWarehouses(orgId: string) {
  await assertPermission("warehouses.view");
  return db.warehouse.findMany({
    where: { organisationId: orgId },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    include: { _count: { select: { locations: true } } },
  });
}

export async function getWarehouse(orgId: string, id: string) {
  await assertPermission("warehouses.view");
  const warehouse = await db.warehouse.findFirst({
    where: { id, organisationId: orgId },
    include: { locations: { orderBy: { code: "asc" } } },
  });
  if (!warehouse) throw new Error("This warehouse was not found.");
  return warehouse;
}

/** Query-only default lookup (no auth) for use inside already-authorized flows. */
export async function findDefaultWarehouse(
  orgId: string,
  client: Pick<PrismaClient, "warehouse"> = db,
) {
  return (
    (await client.warehouse.findFirst({ where: { organisationId: orgId, isDefault: true } })) ??
    (await client.warehouse.findFirst({ where: { organisationId: orgId }, orderBy: { code: "asc" } }))
  );
}

export async function defaultWarehouse(
  orgId: string,
  client: Pick<PrismaClient, "warehouse"> = db,
) {
  await assertPermission("warehouses.view");
  return findDefaultWarehouse(orgId, client);
}

export async function createWarehouse(actor: Actor, raw: { code: string; name: string; address?: string }) {
  const me = await assertPermission("warehouses.manage");
  const code = raw.code.trim();
  const name = raw.name.trim();
  if (!code) throw new Error("Warehouse code is required.");
  if (!name) throw new Error("Warehouse name is required.");
  const count = await db.warehouse.count({ where: { organisationId: actor.orgId } });
  const warehouse = await db.warehouse.create({
    data: {
      organisationId: actor.orgId,
      code: code.toUpperCase(),
      name,
      address: raw.address?.trim() || null,
      isDefault: count === 0,
    },
  });
  await audit({ orgId: actor.orgId, action: "CREATE", entityType: "WAREHOUSE", entityId: warehouse.id, newValue: warehouse, actor: me });
  return warehouse.id;
}

export async function setDefaultWarehouse(actor: Actor, id: string) {
  const me = await assertPermission("warehouses.manage");
  const warehouse = await db.warehouse.findFirst({ where: { id, organisationId: actor.orgId } });
  if (!warehouse) throw new Error("This warehouse was not found.");
  await db.$transaction([
    db.warehouse.updateMany({ where: { organisationId: actor.orgId }, data: { isDefault: false } }),
    db.warehouse.update({ where: { id }, data: { isDefault: true } }),
  ]);
  await audit({ orgId: actor.orgId, action: "SET_DEFAULT", entityType: "WAREHOUSE", entityId: id, actor: me });
}

export async function deleteWarehouse(actor: Actor, id: string) {
  const me = await assertPermission("warehouses.manage");
  const warehouse = await db.warehouse.findFirst({
    where: { id, organisationId: actor.orgId },
    include: { _count: { select: { movements: true, receipts: true, orders: true } } },
  });
  if (!warehouse) throw new Error("This warehouse was not found.");
  if (warehouse.isDefault) throw new Error("The default warehouse cannot be deleted. Set another default first.");
  if (warehouse._count.movements > 0 || warehouse._count.receipts > 0 || warehouse._count.orders > 0) {
    throw new Error("This warehouse has stock history and cannot be deleted.");
  }
  await db.warehouse.delete({ where: { id } });
  await audit({ orgId: actor.orgId, action: "DELETE", entityType: "WAREHOUSE", entityId: id, oldValue: { code: warehouse.code }, actor: me });
}

export async function addLocation(actor: Actor, warehouseId: string, code: string, zone?: string) {
  const me = await assertPermission("warehouses.manage");
  const warehouse = await db.warehouse.findFirst({ where: { id: warehouseId, organisationId: actor.orgId } });
  if (!warehouse) throw new Error("This warehouse was not found.");
  const clean = code.trim().toUpperCase();
  if (!clean) throw new Error("Location code is required.");
  const location = await db.warehouseLocation.create({
    data: { warehouseId, code: clean, zone: zone?.trim() || null },
  });
  await audit({ orgId: actor.orgId, action: "CREATE", entityType: "WAREHOUSE_LOCATION", entityId: location.id, newValue: location, actor: me });
  return location.id;
}

export async function deleteLocation(actor: Actor, warehouseId: string, locationId: string) {
  const me = await assertPermission("warehouses.manage");
  const location = await db.warehouseLocation.findFirst({ where: { id: locationId, warehouseId } });
  if (!location) throw new Error("This location was not found.");
  await db.warehouseLocation.delete({ where: { id: locationId } });
  await audit({ orgId: actor.orgId, action: "DELETE", entityType: "WAREHOUSE_LOCATION", entityId: locationId, oldValue: { code: location.code }, actor: me });
}
