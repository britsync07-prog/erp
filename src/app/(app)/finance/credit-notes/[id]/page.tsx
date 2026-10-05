import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, hasPermission } from "@/server/auth/permissions";
import { getCreditNote } from "@/server/services/finance";
import { issueCreditNoteAction, voidCreditNoteAction } from "@/server/actions/finance";
import { PageHeader, Card, Stat, Table, Td, StatusPill } from "@/components/ui";
import { ConfirmAction } from "@/components/client";
import { formatCents } from "@/domain/units";

export const dynamic = "force-dynamic";

export default async function CreditNotePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("finance.view");
  const { id } = await params;
  const { note, return: ret } = await getCreditNote(session.orgId, id).catch(() => notFound());
  const canManage = hasPermission(session, "finance.manage");

  return (
    <>
      <PageHeader
        title={`Credit note ${note.number}`}
        subtitle={`${note.customer.company} · issued ${note.createdAt.toLocaleString("en-IE")}`}
        actions={<Link href="/finance/credit-notes" className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium hover:bg-slate-200">← Credit notes</Link>}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Total" value={formatCents(note.totalCents)} />
        <Stat label="Status" value={<StatusPill value={note.status} />} />
        <Stat label="Source return" value={ret ? <Link href={`/fulfilment/returns/${ret.id}`} className="text-indigo-700 hover:underline">{ret.code}</Link> : "Manual"} />
      </div>
      {note.reason && (
        <Card className="mt-4"><p className="text-sm text-slate-600"><span className="font-semibold">Reason: </span>{note.reason}</p></Card>
      )}
      {canManage && (
        <Card className="mt-4">
          <div className="flex flex-wrap gap-2">
            {note.status === "DRAFT" && (
              <ConfirmAction action={issueCreditNoteAction} args={[note.id]} confirmText={`Issue credit note ${note.number}?`}>Issue credit note</ConfirmAction>
            )}
            {note.status !== "VOID" && (
              <ConfirmAction action={voidCreditNoteAction} args={[note.id]} confirmText={`Void credit note ${note.number}?`}>Void credit note</ConfirmAction>
            )}
          </div>
        </Card>
      )}
      <Card className="mt-4">
        <h2 className="mb-3 font-semibold">Lines</h2>
        <Table headers={["Product", "Qty", "Unit price", "Line total"]}>
          {note.lines.map((l) => (
            <tr key={l.id} className="hover:bg-slate-50">
              <Td>{l.product ? <Link href={`/products/${l.productId}`} className="font-medium text-indigo-700 hover:underline">{l.product.sku}</Link> : <span className="font-medium">{l.description}</span>}</Td>
              <Td>{l.quantity}</Td>
              <Td>{formatCents(l.unitPriceCents)}</Td>
              <Td>{formatCents(Math.round(l.quantity * l.unitPriceCents))}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
