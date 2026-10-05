import Link from "next/link";
import { requirePermission } from "@/server/auth/permissions";
import { listMovements } from "@/server/services/inventory";
import { listWarehouses } from "@/server/services/warehouses";
import { productOptions } from "@/server/services/catalog";
import { MOVEMENT_TYPES } from "@/domain/constants";
import { PageHeader, Table, Td, StatusPill, EmptyState, Pagination } from "@/components/ui";
import { SearchBox, QuerySelect } from "@/components/client";

export const dynamic = "force-dynamic";

export default async function MovementsPage({ searchParams }: {
  searchParams?: Promise<{ q?: string; warehouse?: string; type?: string; product?: string; page?: string }>;
}) {
  const session = await requirePermission("inventory.view");
  const sp = (await searchParams) ?? {};
  const [data, warehouses, products] = await Promise.all([
    listMovements(session.orgId, sp),
    listWarehouses(session.orgId),
    productOptions(session.orgId),
  ]);

  const baseParams = new URLSearchParams();
  if (sp.q) baseParams.set("q", sp.q);
  if (sp.warehouse) baseParams.set("warehouse", sp.warehouse);
  if (sp.type) baseParams.set("type", sp.type);
  if (sp.product) baseParams.set("product", sp.product);
  const base = `/inventory/movements${baseParams.toString() ? `?${baseParams.toString()}` : ""}`;

  return (
    <>
      <PageHeader
        title="Stock movements"
        subtitle="Append-only ledger. Physical stock is always derived from these rows — nothing here can be edited or deleted."
        actions={
          <>
            <SearchBox defaultValue={sp.q} placeholder="Search reference or note…" />
            <QuerySelect
              name="warehouse" value={sp.warehouse} placeholder="All warehouses"
              options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
            />
            <QuerySelect
              name="type" value={sp.type} placeholder="All types"
              options={MOVEMENT_TYPES.map((t) => ({ value: t, label: t.replace(/_/g, " ") }))}
            />
            <QuerySelect
              name="product" value={sp.product} placeholder="All products"
              options={products.map((p) => ({ value: p.id, label: `${p.sku} — ${p.name}` }))}
            />
          </>
        }
      />
      {data.items.length === 0 ? (
        <EmptyState
          title="No movements found."
          hint="Adjustments, transfers, receipts and count corrections will appear here."
        />
      ) : (
        <>
          <Table headers={["Date", "Product", "Warehouse", "Type", "Qty", "Reference", "Note"]}>
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
                <Td className="max-w-64 text-xs text-slate-500">
                  {m.note ?? "—"}
                  {m.actorName && <span className="block text-slate-400">by {m.actorName}</span>}
                </Td>
              </tr>
            ))}
          </Table>
          <Pagination page={data.page} pages={data.pages} base={base} />
        </>
      )}
    </>
  );
}
