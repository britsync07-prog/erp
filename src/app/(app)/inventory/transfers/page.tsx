import Link from "next/link";
import { requirePermission, hasPermission } from "@/server/auth/permissions";
import { listMovements } from "@/server/services/inventory";
import { listWarehouses } from "@/server/services/warehouses";
import { productOptions } from "@/server/services/catalog";
import { createTransferAction } from "@/server/actions/inventory";
import { TransferForm } from "@/components/inventory-forms";
import { PageHeader, Card, Table, Td, StatusPill, EmptyState, Pagination } from "@/components/ui";
import { SearchBox, QuerySelect } from "@/components/client";

export const dynamic = "force-dynamic";

const LEGS = ["TRANSFER_OUT", "TRANSFER_IN"] as const;

export default async function TransfersPage({ searchParams }: {
  searchParams?: Promise<{ q?: string; warehouse?: string; leg?: string; page?: string }>;
}) {
  const session = await requirePermission("inventory.view");
  const sp = (await searchParams) ?? {};
  const leg = sp.leg === "TRANSFER_IN" ? "TRANSFER_IN" : "TRANSFER_OUT";
  const canManage = hasPermission(session, "inventory.manage");

  const [data, warehouses, products] = await Promise.all([
    listMovements(session.orgId, { q: sp.q, warehouse: sp.warehouse, type: leg, page: sp.page }),
    listWarehouses(session.orgId),
    productOptions(session.orgId),
  ]);

  const baseParams = new URLSearchParams();
  if (sp.q) baseParams.set("q", sp.q);
  if (sp.warehouse) baseParams.set("warehouse", sp.warehouse);
  if (sp.leg) baseParams.set("leg", sp.leg);
  const base = `/inventory/transfers${baseParams.toString() ? `?${baseParams.toString()}` : ""}`;

  return (
    <>
      <PageHeader
        title="Stock transfers"
        subtitle="Move sellable stock between warehouses. Each transfer posts an OUT leg and a matching IN leg under one reference — source must hold enough available stock."
        actions={
          <>
            <SearchBox defaultValue={sp.q} placeholder="Search reference or note…" />
            <QuerySelect
              name="warehouse" value={sp.warehouse} placeholder="All warehouses"
              options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
            />
            <QuerySelect
              name="leg" value={leg} placeholder="Leg"
              options={LEGS.map((t) => ({ value: t, label: t.replace(/_/g, " ").toLowerCase() }))}
            />
          </>
        }
      />
      {data.items.length === 0 ? (
        <EmptyState title="No transfers found." hint="Transfers between warehouses will appear here." />
      ) : (
        <>
          <Table headers={["Date", "Product", "Warehouse", "Leg", "Qty", "Reference", "Note"]}>
            {data.items.map((m) => (
              <tr key={m.id} className="hover:bg-slate-50">
                <Td className="whitespace-nowrap text-xs text-slate-500">
                  {m.createdAt.toLocaleString("en-IE")}
                </Td>
                <Td>
                  <span className="font-mono text-xs text-slate-500">{m.product.sku}</span>{" "}
                  <Link href={`/products/${m.productId}`} className="font-medium text-indigo-700 hover:underline">
                    {m.product.name}
                  </Link>
                </Td>
                <Td>{m.warehouse.name}</Td>
                <Td><StatusPill value={m.type} /></Td>
                <Td>
                  <span className={m.quantity < 0 ? "font-semibold text-red-700" : "font-semibold text-emerald-700"}>
                    {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                  </span>
                </Td>
                <Td className="font-mono text-xs">{m.reference ?? "—"}</Td>
                <Td className="max-w-64 text-xs text-slate-500">{m.note ?? "—"}</Td>
              </tr>
            ))}
          </Table>
          <Pagination page={data.page} pages={data.pages} base={base} />
        </>
      )}
      {canManage ? (
        <Card className="mt-4">
          <h2 className="mb-1 font-semibold">New transfer</h2>
          <p className="mb-3 text-sm text-slate-500">
            Source and destination must differ. Use an{" "}
            <Link href="/inventory/adjustments" className="font-medium text-indigo-700 hover:underline">
              adjustment
            </Link>{" "}
            for corrections within one warehouse.
          </p>
          <TransferForm
            action={createTransferAction}
            products={products.map((p) => ({ id: p.id, sku: p.sku, name: p.name, salesUnit: p.salesUnit }))}
            warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))}
          />
        </Card>
      ) : (
        <Card className="mt-4">
          <p className="text-sm text-slate-500">You need the inventory.manage permission to transfer stock.</p>
        </Card>
      )}
    </>
  );
}
