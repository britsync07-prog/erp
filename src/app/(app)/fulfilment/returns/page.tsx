import Link from "next/link";
import { requirePermission, hasPermission } from "@/server/auth/permissions";
import { listReturns } from "@/server/services/fulfilment";
import { PageHeader, Table, Td, StatusPill, EmptyState, Pagination } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ReturnsPage({ searchParams }: {
  searchParams?: Promise<{ page?: string }>;
}) {
  const session = await requirePermission("orders.view");
  const sp = (await searchParams) ?? {};
  const rawPage = Number.parseInt(sp.page ?? "1", 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const data = await listReturns(session.orgId, page);

  return (
    <>
      <PageHeader
        title="Returns"
        subtitle="Restockable quantities re-enter inventory immediately; damaged lines are recorded as waste. Finance is notified for a possible credit note."
        actions={
          <>
            {hasPermission(session, "inventory.manage") && (
              <Link href="/fulfilment/returns/new" className="rounded-lg bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800">Record a return</Link>
            )}
            <Link href="/fulfilment" className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium hover:bg-slate-200">← Fulfilment</Link>
          </>
        }
      />
      {data.items.length === 0 ? (
        <EmptyState title="No returns yet." hint="Returns are recorded against delivered orders." />
      ) : (
        <>
          <Table headers={["Return", "Order", "Customer", "Lines", "Reason", "Status", "Date"]}>
            {data.items.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <Td>
                  <Link href={`/fulfilment/returns/${r.id}`} className="font-mono text-xs font-medium text-indigo-700 hover:underline">
                    {r.code}
                  </Link>
                </Td>
                <Td><Link href={`/orders/${r.orderId}`} className="font-mono text-xs text-indigo-700 hover:underline">{r.order.number}</Link></Td>
                <Td>{r.order.customer.company}</Td>
                <Td>{r._count.lines}</Td>
                <Td className="max-w-56 truncate text-xs text-slate-500">{r.reason ?? "—"}</Td>
                <Td><StatusPill value={r.status} /></Td>
                <Td className="text-xs text-slate-500">{r.createdAt.toLocaleDateString("en-IE")}</Td>
              </tr>
            ))}
          </Table>
          <Pagination page={data.page} pages={data.pages} base="/fulfilment/returns" />
        </>
      )}
    </>
  );
}
