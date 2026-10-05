import Link from "next/link";
import { requirePermission, hasPermission } from "@/server/auth/permissions";
import { listWarehouses } from "@/server/services/warehouses";
import { PageHeader, Card, StatusPill, EmptyState } from "@/components/ui";
import { WarehouseForm } from "@/components/entity-forms";
import { createWarehouseAction } from "@/server/actions/warehouses";

export const dynamic = "force-dynamic";

export default async function WarehousesPage() {
  const session = await requirePermission("warehouses.view");
  const warehouses = await listWarehouses(session.orgId);
  const canManage = hasPermission(session, "warehouses.manage");

  return (
    <>
      <PageHeader title="Warehouses" subtitle="Multi-warehouse ready from day one. Locations support zone/bin picking later." />
      {warehouses.length === 0 ? (
        <EmptyState title="No warehouses yet." hint="Create your first warehouse to hold stock." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {warehouses.map((w) => (
            <Link key={w.id} href={`/warehouses/${w.id}`} className="block">
              <Card className="hover:border-indigo-300">
                <div className="flex items-center justify-between">
                  <p className="font-semibold">{w.name}</p>
                  {w.isDefault && <StatusPill value="DEFAULT" />}
                </div>
                <p className="mt-1 font-mono text-xs text-slate-400">{w.code}</p>
                <p className="mt-1 text-sm text-slate-500">{w.address ?? "No address"}</p>
                <p className="mt-2 text-xs text-slate-400">{w._count.locations} locations</p>
              </Card>
            </Link>
          ))}
        </div>
      )}
      {canManage && (
        <Card className="mt-4">
          <h2 className="mb-3 font-semibold">New warehouse</h2>
          <WarehouseForm action={createWarehouseAction} />
        </Card>
      )}
    </>
  );
}
