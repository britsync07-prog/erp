import Link from "next/link";
import { requirePermission, hasPermission } from "@/server/auth/permissions";
import { listOrders } from "@/server/services/orders";
import { ORDER_STATUSES } from "@/domain/constants";
import { PageHeader, Table, Td, StatusPill, EmptyState, Pagination } from "@/components/ui";
import { SearchBox, QuerySelect } from "@/components/client";
import { formatCents } from "@/domain/units";

export const dynamic = "force-dynamic";

export default async function OrdersPage({ searchParams }: {
  searchParams?: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const session = await requirePermission("orders.view");
  const sp = (await searchParams) ?? {};
  const data = await listOrders(session.orgId, sp);
  const canManage = hasPermission(session, "orders.manage");
  const baseParams = new URLSearchParams();
  if (sp.q) baseParams.set("q", sp.q);
  if (sp.status) baseParams.set("status", sp.status);
  const base = `/orders${baseParams.toString() ? `?${baseParams.toString()}` : ""}`;

  return (
    <>
      <PageHeader
        title="Orders"
        subtitle="Customer → stock → fulfilment pipeline. Prices snapshot at confirm; history never changes."
        actions={
          <>
            <SearchBox defaultValue={sp.q} placeholder="Search order number…" />
            <QuerySelect name="status" value={sp.status} placeholder="All statuses" options={ORDER_STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))} />
            {canManage && (
              <Link href="/orders/new" className="rounded-lg bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800">New order</Link>
            )}
          </>
        }
      />
      {data.items.length === 0 ? (
        <EmptyState title="No orders found." hint={sp.q || sp.status ? "Try different filters." : "Create your first order to start the pipeline."} />
      ) : (
        <>
          <Table headers={["Number", "Customer", "Date", "Total", "Status", "Payment"]}>
            {data.items.map((o) => (
              <tr key={o.id} className="hover:bg-slate-50">
                <Td><Link href={`/orders/${o.id}`} className="font-mono text-xs font-medium text-indigo-700 hover:underline">{o.number}</Link></Td>
                <Td>{o.customer.company}</Td>
                <Td className="text-xs text-slate-500">{o.orderDate.toLocaleDateString("en-IE")}</Td>
                <Td>{o.status === "DRAFT" ? <span className="text-slate-400">—</span> : formatCents(o.totalCents)}</Td>
                <Td><StatusPill value={o.status} /></Td>
                <Td><StatusPill value={o.paymentStatus} /></Td>
              </tr>
            ))}
          </Table>
          <Pagination page={data.page} pages={data.pages} base={base} />
        </>
      )}
    </>
  );
}
