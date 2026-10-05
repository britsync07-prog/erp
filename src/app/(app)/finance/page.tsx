import Link from "next/link";
import { requirePermission, hasPermission } from "@/server/auth/permissions";
import { listInvoices } from "@/server/services/finance";
import { PageHeader, Table, Td, StatusPill, EmptyState, Pagination } from "@/components/ui";
import { SearchBox, QuerySelect } from "@/components/client";
import { formatCents } from "@/domain/units";

export const dynamic = "force-dynamic";

const STATUSES = ["DRAFT", "ISSUED", "PARTIAL", "PAID", "OVERDUE", "VOID"];

export default async function InvoicesPage({ searchParams }: {
  searchParams?: Promise<{ q?: string; status?: string; overdue?: string; page?: string }>;
}) {
  const session = await requirePermission("finance.view");
  const sp = (await searchParams) ?? {};
  const data = await listInvoices(session.orgId, sp);
  const canManage = hasPermission(session, "finance.manage");
  const baseParams = new URLSearchParams();
  if (sp.q) baseParams.set("q", sp.q);
  if (sp.status) baseParams.set("status", sp.status);
  if (sp.overdue) baseParams.set("overdue", sp.overdue);
  const base = `/finance${baseParams.toString() ? `?${baseParams.toString()}` : ""}`;

  return (
    <>
      <PageHeader
        title="Invoices"
        subtitle="Draft → issued → paid. Overdue is derived from due date and open balance."
        actions={
          <>
            <SearchBox defaultValue={sp.q} placeholder="Search invoice number…" />
            <QuerySelect name="status" value={sp.status} placeholder="All statuses" options={STATUSES.map((s) => ({ value: s, label: s }))} />
            {sp.overdue ? (
              <Link href="/finance" className="rounded-lg bg-red-100 px-3 py-2 text-sm font-medium text-red-800">Overdue only ✕</Link>
            ) : (
              <Link href="/finance?overdue=1" className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium hover:bg-slate-200">Overdue only</Link>
            )}
            {canManage && (
              <Link href="/finance/new" className="rounded-lg bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800">New invoice</Link>
            )}
          </>
        }
      />
      {data.items.length === 0 ? (
        <EmptyState title="No invoices found." hint="Invoice delivered orders to start billing." />
      ) : (
        <>
          <Table headers={["Number", "Customer", "Due", "Total", "Paid", "Balance", "Status"]}>
            {data.items.map((i) => (
              <tr key={i.id} className="hover:bg-slate-50">
                <Td><Link href={`/finance/${i.id}`} className="font-mono text-xs font-medium text-indigo-700 hover:underline">{i.number}</Link></Td>
                <Td>{i.customer.company}</Td>
                <Td className="text-xs">{i.dueDate ? i.dueDate.toLocaleDateString("en-IE") : "—"}</Td>
                <Td>{formatCents(i.totalCents)}</Td>
                <Td>{formatCents(i.paidCents)}</Td>
                <Td><span className={("overdue" in i && i.overdue) ? "font-semibold text-red-700" : "font-medium"}>{formatCents(i.balance)}</span></Td>
                <Td><StatusPill value={("overdue" in i && i.overdue) ? "OVERDUE" : i.status} /></Td>
              </tr>
            ))}
          </Table>
          <Pagination page={data.page} pages={data.pages} base={base} />
        </>
      )}
    </>
  );
}
