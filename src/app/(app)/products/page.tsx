import Link from "next/link";
import { requirePermission, hasPermission } from "@/server/auth/permissions";
import { listProducts, listCategories } from "@/server/services/catalog";
import { PageHeader, Table, Td, StatusPill, EmptyState, Pagination } from "@/components/ui";
import { SearchBox, QuerySelect } from "@/components/client";

export const dynamic = "force-dynamic";

export default async function ProductsPage({ searchParams }: {
  searchParams?: Promise<{ q?: string; category?: string; status?: string; page?: string }>;
}) {
  const session = await requirePermission("products.view");
  const sp = (await searchParams) ?? {};
  const [data, categories] = await Promise.all([
    listProducts(session.orgId, sp),
    listCategories(session.orgId),
  ]);
  const canManage = hasPermission(session, "products.manage");
  const baseParams = new URLSearchParams();
  if (sp.q) baseParams.set("q", sp.q);
  if (sp.category) baseParams.set("category", sp.category);
  if (sp.status) baseParams.set("status", sp.status);
  const base = `/products${baseParams.toString() ? `?${baseParams.toString()}` : ""}`;

  return (
    <>
      <PageHeader
        title="Products"
        subtitle={`${data.total} product${data.total === 1 ? "" : "s"}. Stock shown in sales units.`}
        actions={
          <>
            <SearchBox defaultValue={sp.q} placeholder="Search name, SKU, barcode…" />
            <QuerySelect name="category" value={sp.category} placeholder="All categories" options={categories.map((c) => ({ value: c.id, label: c.name }))} />
            <QuerySelect name="status" value={sp.status} placeholder="All statuses" options={[{ value: "ACTIVE", label: "Active" }, { value: "DISCONTINUED", label: "Discontinued" }, { value: "ARCHIVED", label: "Archived" }]} />
            {canManage && (
              <Link href="/products/new" className="rounded-lg bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800">New product</Link>
            )}
          </>
        }
      />
      {data.items.length === 0 ? (
        <EmptyState title="No products found." hint={sp.q ? "Try a different search." : "Add your first product to start selling."} />
      ) : (
        <>
          <Table headers={["SKU", "Product", "Price", "Available", "Reorder at", "Status"]}>
            {data.items.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <Td className="font-mono text-xs">{p.sku}</Td>
                <Td><Link href={`/products/${p.id}`} className="font-medium text-indigo-700 hover:underline">{p.name}</Link></Td>
                <Td>€{(p.standardPriceCents / 100).toFixed(2)}</Td>
                <Td><span className={p.stock.available < p.reorderPoint ? "font-semibold text-amber-700" : ""}>{p.stock.available}</span></Td>
                <Td>{p.reorderPoint}</Td>
                <Td><StatusPill value={p.status} /></Td>
              </tr>
            ))}
          </Table>
          <Pagination page={data.page} pages={data.pages} base={base} />
        </>
      )}
    </>
  );
}
