import Link from "next/link";
import { requirePermission } from "@/server/auth/permissions";
import { stockOverview } from "@/server/services/inventory";
import { listWarehouses } from "@/server/services/warehouses";
import { PageHeader, Table, Td, EmptyState, Pagination } from "@/components/ui";
import { SearchBox, QuerySelect } from "@/components/client";

export const dynamic = "force-dynamic";

export default async function StockOverviewPage({ searchParams }: {
  searchParams?: Promise<{ q?: string; warehouse?: string; low?: string; page?: string }>;
}) {
  const session = await requirePermission("inventory.view");
  const sp = (await searchParams) ?? {};
  const [data, warehouses] = await Promise.all([
    stockOverview(session.orgId, sp),
    listWarehouses(session.orgId),
  ]);
  const baseParams = new URLSearchParams();
  if (sp.q) baseParams.set("q", sp.q);
  if (sp.warehouse) baseParams.set("warehouse", sp.warehouse);
  if (sp.low) baseParams.set("low", sp.low);
  const base = `/inventory${baseParams.toString() ? `?${baseParams.toString()}` : ""}`;

  return (
    <>
      <PageHeader
        title="Stock overview"
        subtitle="Live levels derived from the inventory ledger. Quantities in sales units."
        actions={
          <>
            <SearchBox defaultValue={sp.q} placeholder="Search name, SKU, barcode…" />
            <QuerySelect name="warehouse" value={sp.warehouse} placeholder="All warehouses" options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
            {sp.low ? (
              <Link href="/inventory" className="rounded-lg bg-amber-100 px-3 py-2 text-sm font-medium text-amber-800">Showing low only ✕</Link>
            ) : (
              <Link href="/inventory?low=1" className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium hover:bg-slate-200">Low stock only</Link>
            )}
          </>
        }
      />
      {data.items.length === 0 ? (
        <EmptyState title="No stock rows." hint="Add products with opening stock to see levels here." />
      ) : (
        <>
          <Table headers={["SKU", "Product", "Physical", "Reserved", "Available", "Reorder at", "Health"]}>
            {data.items.map((r) => {
              const low = r.stock.available < r.product.reorderPoint;
              return (
                <tr key={r.product.id} className="hover:bg-slate-50">
                  <Td className="font-mono text-xs">{r.product.sku}</Td>
                  <Td><Link href={`/products/${r.product.id}`} className="font-medium text-indigo-700 hover:underline">{r.product.name}</Link></Td>
                  <Td>{r.stock.physical}</Td>
                  <Td>{r.stock.reserved}</Td>
                  <Td><span className={low ? "font-semibold text-amber-700" : "font-medium"}>{r.stock.available}</span></Td>
                  <Td>{r.product.reorderPoint}</Td>
                  <Td>{low ? <span className="font-medium text-amber-700">LOW</span> : <span className="text-emerald-700">OK</span>}</Td>
                </tr>
              );
            })}
          </Table>
          <Pagination page={data.page} pages={data.pages} base={base} />
        </>
      )}
    </>
  );
}
