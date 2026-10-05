import Link from "next/link";
import { requirePermission, hasPermission } from "@/server/auth/permissions";
import { listMovements } from "@/server/services/inventory";
import { listWarehouses } from "@/server/services/warehouses";
import { productOptions } from "@/server/services/catalog";
import { createAdjustmentAction } from "@/server/actions/inventory";
import { AdjustmentForm } from "@/components/inventory-forms";
import { PageHeader, Card, Table, Td, StatusPill, EmptyState, Pagination } from "@/components/ui";
import { SearchBox, QuerySelect } from "@/components/client";

export const dynamic = "force-dynamic";

const DIRS = ["ADJUSTMENT_IN", "ADJUSTMENT_OUT"] as const;

export default async function AdjustmentsPage({ searchParams }: {
  searchParams?: Promise<{ q?: string; warehouse?: string; type?: string; page?: string }>;
}) {
  const session = await requirePermission("inventory.view");
  const sp = (await searchParams) ?? {};
  const dir = sp.type === "ADJUSTMENT_IN" || sp.type === "ADJUSTMENT_OUT" ? sp.type : undefined;
  const canManage = hasPermission(session, "inventory.manage");

  const [data, warehouses, products] = await Promise.all([
    listMovements(session.orgId, { q: sp.q, warehouse: sp.warehouse, type: dir, page: sp.page }),
    listWarehouses(session.orgId),
    productOptions(session.orgId),
  ]);
  // Default view mixes both directions from one ledger page; the IN/OUT views
  // are exact service queries with correct pagination.
  const rows = dir
    ? data.items
    : data.items.filter((m) => m.type === "ADJUSTMENT_IN" || m.type === "ADJUSTMENT_OUT");

  const baseParams = new URLSearchParams();
  if (sp.q) baseParams.set("q", sp.q);
  if (sp.warehouse) baseParams.set("warehouse", sp.warehouse);
  if (sp.type) baseParams.set("type", sp.type);
  const base = `/inventory/adjustments${baseParams.toString() ? `?${baseParams.toString()}` : ""}`;

  return (
    <>
      <PageHeader
        title="Stock adjustments"
        subtitle="Corrections within one warehouse. Small adjustments post immediately — significant ones (over 50 units) need a second person's approval."
        actions={
          <>
            <SearchBox defaultValue={sp.q} placeholder="Search reference or note…" />
            <QuerySelect
              name="warehouse" value={sp.warehouse} placeholder="All warehouses"
              options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
            />
            <QuerySelect
              name="type" value={sp.type} placeholder="All adjustments"
              options={DIRS.map((t) => ({ value: t, label: t.replace(/_/g, " ").toLowerCase() }))}
            />
          </>
        }
      />
      {rows.length === 0 ? (
        <EmptyState title="No adjustments found." hint="Posted adjustments will appear here." />
      ) : (
        <>
          <Table headers={["Date", "Product", "Warehouse", "Type", "Qty", "Reference", "Note"]}>
            {rows.map((m) => (
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
                <Td className="max-w-64 text-xs text-slate-500">
                  {m.note ?? "—"}
                  {m.actorName && <span className="block text-slate-400">by {m.actorName}</span>}
                </Td>
              </tr>
            ))}
          </Table>
          {dir ? (
            <Pagination page={data.page} pages={data.pages} base={base} />
          ) : (
            <p className="mt-3 text-sm text-slate-500">
              Showing recent adjustments. Narrow by direction for full history, or see every
              movement type on{" "}
              <Link href="/inventory/movements" className="font-medium text-indigo-700 hover:underline">
                stock movements
              </Link>
              .
            </p>
          )}
        </>
      )}
      {canManage ? (
        <Card className="mt-4">
          <h2 className="mb-1 font-semibold">New adjustment</h2>
          <p className="mb-3 text-sm text-slate-500">
            A reason is required for every adjustment. Over 50 units either way creates an
            approval request instead of posting — decide it on the{" "}
            <Link href="/approvals" className="font-medium text-indigo-700 hover:underline">approvals</Link>{" "}
            board.
          </p>
          <AdjustmentForm
            action={createAdjustmentAction}
            products={products.map((p) => ({ id: p.id, sku: p.sku, name: p.name, salesUnit: p.salesUnit }))}
            warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))}
            defaultWarehouseId={warehouses.find((w) => w.isDefault)?.id}
          />
        </Card>
      ) : (
        <Card className="mt-4">
          <p className="text-sm text-slate-500">You need the inventory.manage permission to post adjustments.</p>
        </Card>
      )}
    </>
  );
}
