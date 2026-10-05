import Link from "next/link";
import { requirePermission, hasPermission } from "@/server/auth/permissions";
import { listCustomers } from "@/server/services/customers";
import { PageHeader, Table, Td, StatusPill, EmptyState, Pagination } from "@/components/ui";
import { SearchBox } from "@/components/client";

export const dynamic = "force-dynamic";

export default async function CustomersPage({ searchParams }: { searchParams?: Promise<{ q?: string; page?: string }> }) {
  const session = await requirePermission("customers.view");
  const sp = (await searchParams) ?? {};
  const data = await listCustomers(session.orgId, sp);
  const canManage = hasPermission(session, "customers.manage");
  const base = `/customers${sp.q ? `?q=${encodeURIComponent(sp.q)}` : ""}`;

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle={`${data.total} customer${data.total === 1 ? "" : "s"} in the directory.`}
        actions={
          <>
            <SearchBox defaultValue={sp.q} placeholder="Search company, code, email…" />
            {canManage && (
              <Link href="/customers/new" className="rounded-lg bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800">New customer</Link>
            )}
          </>
        }
      />
      {data.items.length === 0 ? (
        <EmptyState title="No customers found." hint={sp.q ? "Try a different search." : "Add your first customer to start taking orders."} />
      ) : (
        <>
          <Table headers={["Code", "Company", "Contact", "Terms", "Status", "Orders"]}>
            {data.items.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <Td className="font-mono text-xs">{c.code}</Td>
                <Td><Link href={`/customers/${c.id}`} className="font-medium text-indigo-700 hover:underline">{c.company}</Link></Td>
                <Td><span className="text-slate-500">{c.email ?? c.phone ?? "—"}</span></Td>
                <Td>{c.paymentTerms.replace(/_/g, " ")}</Td>
                <Td><StatusPill value={c.status} /></Td>
                <Td>{c._count.orders}</Td>
              </tr>
            ))}
          </Table>
          <Pagination page={data.page} pages={data.pages} base={base} />
        </>
      )}
    </>
  );
}
