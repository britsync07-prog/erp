import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, hasPermission } from "@/server/auth/permissions";
import { getWarehouse } from "@/server/services/warehouses";
import { stockOverview } from "@/server/services/inventory";
import { PageHeader, Card, Table, Td, StatusPill } from "@/components/ui";
import { ConfirmAction, InlineAction } from "@/components/client";
import { LocationForm } from "@/components/entity-forms";
import {
  setDefaultWarehouseAction, deleteWarehouseAction,
  addLocationAction, deleteLocationAction,
} from "@/server/actions/warehouses";

export const dynamic = "force-dynamic";

export default async function WarehouseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("warehouses.view");
  const { id } = await params;
  const warehouse = await getWarehouse(session.orgId, id).catch(() => null);
  if (!warehouse) notFound();
  const canManage = hasPermission(session, "warehouses.manage");
  // Stock needs inventory.view; hide the section when the viewer lacks it.
  const stock = await stockOverview(session.orgId, { warehouse: warehouse.id }).catch(() => null);

  return (
    <>
      <PageHeader
        title={warehouse.name}
        subtitle={`${warehouse.code}${warehouse.address ? ` · ${warehouse.address}` : ""}`}
        actions={
          <Link href="/warehouses" className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200">
            ← Back to warehouses
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {warehouse.isDefault && <StatusPill value="DEFAULT" />}
        {canManage && !warehouse.isDefault && (
          <InlineAction action={setDefaultWarehouseAction} args={[warehouse.id]} title="Make this the default warehouse">
            Set as default
          </InlineAction>
        )}
        {canManage && !warehouse.isDefault && (
          <ConfirmAction action={deleteWarehouseAction} args={[warehouse.id]} confirmText={`Delete warehouse "${warehouse.name}"? Only possible with no stock history.`} danger>
            Delete
          </ConfirmAction>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">Locations ({warehouse.locations.length})</h2>
          {warehouse.locations.length === 0 ? (
            <p className="mb-3 text-sm text-slate-500">No locations yet. Add bins to support zone/bin picking later.</p>
          ) : (
            <Table headers={["Code", "Zone", ""]}>
              {warehouse.locations.map((l) => (
                <tr key={l.id}>
                  <Td className="font-mono text-xs font-medium">{l.code}</Td>
                  <Td>{l.zone ?? "—"}</Td>
                  <Td>
                    {canManage && (
                      <ConfirmAction
                        action={deleteLocationAction} args={[warehouse.id, l.id]}
                        confirmText={`Delete location "${l.code}"?`}
                        danger
                      >
                        Delete
                      </ConfirmAction>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
          {canManage && (
            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold">Add location</h3>
              <LocationForm action={addLocationAction} warehouseId={warehouse.id} />
            </div>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">Stock in this warehouse{stock ? ` (${stock.total})` : ""}</h2>
          {!stock ? (
            <p className="text-sm text-slate-500">Stock levels require inventory access.</p>
          ) : stock.items.length === 0 ? (
            <p className="text-sm text-slate-500">No active products with stock in this warehouse.</p>
          ) : (
            <Table headers={["SKU", "Product", "Physical", "Reserved", "Available"]}>
              {stock.items.map((r) => (
                <tr key={r.product.id} className="hover:bg-slate-50">
                  <Td className="font-mono text-xs">{r.product.sku}</Td>
                  <Td><Link href={`/products/${r.product.id}`} className="font-medium text-indigo-700 hover:underline">{r.product.name}</Link></Td>
                  <Td>{r.stock.physical}</Td>
                  <Td>{r.stock.reserved}</Td>
                  <Td>{r.stock.available}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
