import Link from "next/link";
import { requirePermission, hasPermission } from "@/server/auth/permissions";
import { receivablesBoard, invoiceableOrders } from "@/server/services/finance";
import { createInvoiceAction } from "@/server/actions/finance";
import { PageHeader, Card, Stat, Table, Td, StatusPill, EmptyState } from "@/components/ui";
import { ConfirmAction } from "@/components/client";
import { formatCents } from "@/domain/units";

export const dynamic = "force-dynamic";

const BUCKET_LABELS: Record<string, string> = {
  CURRENT: "Not yet due",
  D1_30: "1–30 days overdue",
  D31_60: "31–60 days overdue",
  D60_PLUS: "60+ days overdue",
};

export default async function ReceivablesPage() {
  const session = await requirePermission("finance.view");
  const [board, queue] = await Promise.all([
    receivablesBoard(session.orgId),
    invoiceableOrders(session.orgId),
  ]);
  const canManage = hasPermission(session, "finance.manage");

  return (
    <>
      <PageHeader
        title="Receivables"
        subtitle="Open invoices by age, netted against issued credit notes. Invoices are created from delivered orders — never manually."
        actions={<Link href="/finance" className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium hover:bg-slate-200">← Invoices</Link>}
      />
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Stat label="Open receivables" value={formatCents(board.totals.open)} link="/finance?overdue=1" />
        <Stat label="Overdue" value={formatCents(board.totals.overdue)} link="/finance?overdue=1" />
        <Stat label="Awaiting invoice" value={formatCents(queue.reduce((s, o) => s + o.totalCents, 0))} />
      </div>

      <Card className="mb-5">
        <h2 className="mb-3 font-semibold">Aging buckets</h2>
        {board.rows.length === 0 ? (
          <p className="text-sm text-slate-500">No open invoices.</p>
        ) : (
          <Table headers={["Bucket", "Balance"]}>
            {Object.entries(BUCKET_LABELS).map(([key, label]) => (
              <tr key={key} className="hover:bg-slate-50">
                <Td>{label}</Td>
                <Td>{formatCents(board.totals.buckets[key] ?? 0)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card className="mb-5">
        <h2 className="mb-3 font-semibold">Balance by customer</h2>
        {board.byCustomer.length === 0 ? (
          <p className="text-sm text-slate-500">No customer balances.</p>
        ) : (
          <Table headers={["Customer", "Code", "Invoiced", "Credits", "Net"]}>
            {board.byCustomer.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <Td>{c.company}</Td>
                <Td className="font-mono text-xs">{c.code}</Td>
                <Td>{formatCents(c.invoiced)}</Td>
                <Td>{formatCents(c.credits)}</Td>
                <Td><span className={c.net > 0 ? "font-semibold" : "text-slate-400"}>{formatCents(c.net)}</span></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card className="mb-5">
        <h2 className="mb-3 font-semibold">Open invoices</h2>
        {board.rows.length === 0 ? (
          <EmptyState title="Nothing outstanding." hint="Issued invoices with an open balance will appear here." />
        ) : (
          <Table headers={["Number", "Customer", "Order", "Due", "Balance", "Bucket", "Status"]}>
            {board.rows.map((i) => (
              <tr key={i.id} className="hover:bg-slate-50">
                <Td><Link href={`/finance/${i.id}`} className="font-mono text-xs font-medium text-indigo-700 hover:underline">{i.number}</Link></Td>
                <Td>{i.customer.company}</Td>
                <Td className="font-mono text-xs">{i.order?.number ?? "—"}</Td>
                <Td className="text-xs">{i.dueDate ? i.dueDate.toLocaleDateString("en-IE") : "—"}</Td>
                <Td><span className={i.overdue ? "font-semibold text-red-700" : "font-medium"}>{formatCents(i.balance)}</span></Td>
                <Td className="text-xs text-slate-500">{i.bucket ? BUCKET_LABELS[i.bucket] : "—"}</Td>
                <Td><StatusPill value={i.overdue ? "OVERDUE" : i.status} /></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {canManage && (
        <Card>
          <h2 className="mb-1 font-semibold">Delivered orders awaiting invoice ({queue.length})</h2>
          <p className="mb-3 text-sm text-slate-500">Creating an invoice opens it as a draft — issue it from the invoice page.</p>
          {queue.length === 0 ? (
            <p className="text-sm text-slate-500">Everything delivered is already invoiced.</p>
          ) : (
            <Table headers={["Order", "Customer", "Total", ""]}>
              {queue.map((o) => (
                <tr key={o.id} className="hover:bg-slate-50">
                  <Td className="font-mono text-xs">{o.number}</Td>
                  <Td>{o.customer.company}</Td>
                  <Td>{formatCents(o.totalCents)}</Td>
                  <Td>
                    <ConfirmAction action={createInvoiceAction} args={[o.id]} confirmText={`Create draft invoice for ${o.number}?`}>
                      Create invoice
                    </ConfirmAction>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
    </>
  );
}
