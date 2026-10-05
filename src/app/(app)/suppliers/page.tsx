import Link from "next/link";
import { requirePermission, hasPermission } from "@/server/auth/permissions";
import { listSuppliers } from "@/server/services/suppliers";
import { PageHeader, Table, Td, StatusPill, EmptyState, Pagination } from "@/components/ui";
import { SearchBox } from "@/components/client";

export const dynamic = "force-dynamic";

export default async function SuppliersPage({ searchParams }: { searchParams?: Promise<{ q?: string; page?: string }> }) {
  const session = await requirePermission("suppliers.view");
  const sp = (await searchParams) ?? {};
  const data = await listSuppliers(session.orgId, sp);
  const canManage = hasPermission(session, "suppliers.manage");
  const base = `/suppliers${sp.q ? `?q=${encodeURIComponent(sp.q)}` : ""}`;

  return (
    <>
      <PageHeader
        title="Suppliers"
        subtitle={`${data.total} supplier${data.total === 1 ? "" : "s"} in the directory.`}
        actions={
          <>
            <SearchBox defaultValue={sp.q} placeholder="Search company, code…" />
            {canManage && (
              <Link href="/suppliers/new" className="rounded-lg bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800">New supplier</Link>
            )}
          </>
        }
      />
      {data.items.length === 0 ? (
        <EmptyState title="No suppliers found." hint={sp.q ? "Try a different search." : "Add your first supplier to start purchasing."} />
      ) : (
        <>
          <Table headers={["Code", "Company", "Contact", "Lead time", "Status", "Products", "POs"]}>
            {data.items.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50">
                <Td className="font-mono text-xs">{s.code}</Td>
                <Td><Link href={`/suppliers/${s.id}`} className="font-medium text-indigo-700 hover:underline">{s.company}</Link></Td>
                <Td><span className="text-slate-500">{s.email ?? s.phone ?? "—"}</span></Td>
                <Td>{s.leadTimeDays}d</Td>
                <Td><StatusPill value={s.status} /></Td>
                <Td>{s._count.productLinks}</Td>
                <Td>{s._count.purchaseOrders}</Td>
              </tr>
            ))}
          </Table>
          <Pagination page={data.page} pages={data.pages} base={base} />
        </>
      )}
    </>
  );
}
