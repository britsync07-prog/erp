import Link from "next/link";
import { requirePermission, hasPermission } from "@/server/auth/permissions";
import { listPOs } from "@/server/services/procurement";
import { supplierOptions } from "@/server/services/suppliers";
import { PO_STATUSES } from "@/domain/constants";
import { PageHeader, Table, Td, StatusPill, EmptyState, Pagination } from "@/components/ui";
import { SearchBox, QuerySelect } from "@/components/client";
import { formatCents } from "@/domain/units";

export const dynamic = "force-dynamic";

export default async function PurchaseOrdersPage({ searchParams }: {
  searchParams?: Promise<{ q?: string; status?: string; supplier?: string; page?: string }>;
}) {
  const session = await requirePermission("procurement.view");
  const sp = (await searchParams) ?? {};
  const [data, suppliers] = await Promise.all([
    listPOs(session.orgId, sp),
    supplierOptions(session.orgId),
  ]);
  const canManage = hasPermission(session, "procurement.manage");
  const baseParams = new URLSearchParams();
  if (sp.q) baseParams.set("q", sp.q);
  if (sp.status) baseParams.set("status", sp.status);
  if (sp.supplier) baseParams.set("supplier", sp.supplier);
  const base = `/procurement${baseParams.toString() ? `?${baseParams.toString()}` : ""}`;

  return (
    <>
      <PageHeader
        title="Purchase orders"
        subtitle="Draft → approval → sent → confirmed → received → closed. Linked requirements reopen if cancelled."
        actions={
          <>
            <SearchBox defaultValue={sp.q} placeholder="Search PO number…" />
            <QuerySelect name="status" value={sp.status} placeholder="All statuses" options={PO_STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))} />
            <QuerySelect name="supplier" value={sp.supplier} placeholder="All suppliers" options={suppliers.map((s) => ({ value: s.id, label: s.company }))} />
            {canManage && (
              <Link href="/procurement/new" className="rounded-lg bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800">New PO</Link>
            )}
          </>
        }
      />
      {data.items.length === 0 ? (
        <EmptyState title="No purchase orders found." hint="Convert requirements or create a PO manually." />
      ) : (
        <>
          <Table headers={["Number", "Supplier", "Expected", "Total", "Status", "Lines"]}>
            {data.items.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <Td><Link href={`/procurement/${p.id}`} className="font-mono text-xs font-medium text-indigo-700 hover:underline">{p.number}</Link></Td>
                <Td>{p.supplier.company}</Td>
                <Td className="text-xs text-slate-500">{p.expectedDate ? p.expectedDate.toLocaleDateString("en-IE") : "—"}</Td>
                <Td>{formatCents(p.totalCents)}</Td>
                <Td><StatusPill value={p.status} /></Td>
                <Td>{p._count.lines}</Td>
              </tr>
            ))}
          </Table>
          <Pagination page={data.page} pages={data.pages} base={base} />
        </>
      )}
    </>
  );
}
