import Link from "next/link";
import { requirePermission } from "@/server/auth/permissions";
import { invoiceableOrders } from "@/server/services/finance";
import { createInvoiceAction } from "@/server/actions/finance";
import { PageHeader, Card, Table, Td, EmptyState } from "@/components/ui";
import { ConfirmAction } from "@/components/client";
import { formatCents } from "@/domain/units";

export const dynamic = "force-dynamic";

export default async function NewInvoicePage() {
  const session = await requirePermission("finance.manage");
  const orders = await invoiceableOrders(session.orgId);

  return (
    <>
      <PageHeader
        title="New invoice"
        subtitle="Invoices are raised from delivered orders. Lines and prices are snapshotted from the order."
        actions={<Link href="/finance" className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium hover:bg-slate-200">← Invoices</Link>}
      />
      {orders.length === 0 ? (
        <EmptyState title="No delivered orders awaiting an invoice." hint="Deliver an order in Fulfilment, then come back here." />
      ) : (
        <Card>
          <Table headers={["Order", "Customer", "Total", ""]}>
            {orders.map((o) => (
              <tr key={o.id} className="hover:bg-slate-50">
                <Td><Link href={`/orders/${o.id}`} className="font-mono text-xs font-medium text-indigo-700 hover:underline">{o.number}</Link></Td>
                <Td className="font-medium">{o.customer.company}</Td>
                <Td>{formatCents(o.totalCents)}</Td>
                <Td className="text-right">
                  <ConfirmAction action={createInvoiceAction} args={[o.id]} confirmText={`Create a draft invoice from ${o.number}?`}>
                    Create invoice
                  </ConfirmAction>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </>
  );
}
