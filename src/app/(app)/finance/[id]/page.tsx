import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, hasPermission } from "@/server/auth/permissions";
import { getInvoice } from "@/server/services/finance";
import {
  issueInvoiceAction,
  voidInvoiceAction,
  deleteInvoiceAction,
  setInvoiceDueDateAction,
  recordPaymentAction,
} from "@/server/actions/finance";
import { PageHeader, Card, Stat, Table, Td, StatusPill, Timeline } from "@/components/ui";
import { ConfirmAction } from "@/components/client";
import { PaymentForm, DueDateForm } from "@/components/finance-forms";
import { formatCents } from "@/domain/units";

export const dynamic = "force-dynamic";

export default async function InvoiceDetailPage({ params }: {
  params: Promise<{ id: string }>;
}) {
  const session = await requirePermission("finance.view");
  const { id } = await params;
  const data = await getInvoice(session.orgId, id).catch(() => null);
  if (!data) notFound();
  const { invoice, events, balance, overdue } = data;
  const canManage = hasPermission(session, "finance.manage");
  const isDraft = invoice.status === "DRAFT";
  const isPayable = invoice.status === "ISSUED" || invoice.status === "PARTIAL";
  const canVoid = (isDraft || invoice.status === "ISSUED") && invoice.paidCents === 0;

  return (
    <>
      <PageHeader
        title={`Invoice ${invoice.number}`}
        subtitle={`${invoice.customer.company} (${invoice.customer.code})${invoice.order ? ` · order ${invoice.order.number} (${invoice.order.status})` : ""}`}
        actions={
          <>
            <StatusPill value={overdue ? "OVERDUE" : invoice.status} />
            <Link href="/finance" className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium hover:bg-slate-200">← Invoices</Link>
          </>
        }
      />
      <div className="mb-5 grid gap-4 sm:grid-cols-4">
        <Stat label="Total" value={formatCents(invoice.totalCents)} />
        <Stat label="Paid" value={formatCents(invoice.paidCents)} />
        <Stat label="Balance" value={formatCents(balance)} />
        <Stat label="Due" value={invoice.dueDate ? invoice.dueDate.toLocaleDateString("en-IE") : "—"} />
      </div>

      {canManage && (isDraft || isPayable || canVoid) && (
        <Card className="mb-5">
          <h2 className="mb-3 font-semibold">Actions</h2>
          <div className="flex flex-wrap items-start gap-3">
            {isDraft && (
              <>
                <ConfirmAction action={issueInvoiceAction} args={[invoice.id, invoice.orderId]} confirmText={`Issue invoice ${invoice.number}?`}>
                  Issue invoice
                </ConfirmAction>
                <DueDateForm
                  action={setInvoiceDueDateAction}
                  invoiceId={invoice.id}
                  dueDate={invoice.dueDate ? invoice.dueDate.toISOString().slice(0, 10) : ""}
                />
                <ConfirmAction danger action={deleteInvoiceAction} args={[invoice.id, invoice.orderId]} confirmText={`Delete draft invoice ${invoice.number}?`}>
                  Delete draft
                </ConfirmAction>
              </>
            )}
            {canVoid && !isDraft && (
              <ConfirmAction danger action={voidInvoiceAction} args={[invoice.id, invoice.orderId]} confirmText={`Void invoice ${invoice.number}?`}>
                Void invoice
              </ConfirmAction>
            )}
          </div>
          {invoice.status === "PARTIAL" && (
            <p className="mt-3 text-sm text-slate-500">
              This invoice has payments — it cannot be voided. <Link href="/finance/credit-notes" className="font-medium text-indigo-700 hover:underline">Issue a credit note instead →</Link>
            </p>
          )}
        </Card>
      )}

      <Card className="mb-5">
        <h2 className="mb-3 font-semibold">Lines ({invoice.lines.length})</h2>
        <Table headers={["Description", "Qty", "Unit price", "Tax %", "Line total"]}>
          {invoice.lines.map((l) => (
            <tr key={l.id} className="hover:bg-slate-50">
              <Td>{l.description}</Td>
              <Td>{l.quantity}</Td>
              <Td>{formatCents(l.unitPriceCents)}</Td>
              <Td>{l.taxRate}%</Td>
              <Td>{formatCents(Math.round(l.quantity * l.unitPriceCents))}</Td>
            </tr>
          ))}
        </Table>
        <div className="mt-3 space-y-1 text-right text-sm text-slate-600">
          <p>Subtotal: {formatCents(invoice.subtotalCents)}</p>
          <p>Tax: {formatCents(invoice.taxCents)}</p>
          <p className="font-semibold text-slate-900">Total: {formatCents(invoice.totalCents)}</p>
        </div>
      </Card>

      <Card className="mb-5">
        <h2 className="mb-3 font-semibold">Payments ({invoice.payments.length})</h2>
        {invoice.payments.length === 0 ? (
          <p className="text-sm text-slate-500">No payments recorded yet.</p>
        ) : (
          <Table headers={["Paid on", "Method", "Amount", "Reference"]}>
            {invoice.payments.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <Td className="text-xs">{p.paidAt.toLocaleDateString("en-IE")}</Td>
                <Td>{p.method.replace(/_/g, " ")}</Td>
                <Td>{formatCents(p.amountCents)}</Td>
                <Td className="text-xs text-slate-500">{p.reference ?? "—"}</Td>
              </tr>
            ))}
          </Table>
        )}
        {canManage && isPayable && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <h3 className="mb-3 text-sm font-semibold">Record a payment</h3>
            <PaymentForm action={recordPaymentAction} invoiceId={invoice.id} balanceCents={balance} />
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold">Activity</h2>
        <Timeline events={events} />
      </Card>
    </>
  );
}
