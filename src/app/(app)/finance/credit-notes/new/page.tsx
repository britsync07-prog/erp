import Link from "next/link";
import { requirePermission } from "@/server/auth/permissions";
import { eligibleReturnsForCredit } from "@/server/services/finance";
import { createCreditNoteAction } from "@/server/actions/finance";
import { PageHeader, Card, Table, Td, EmptyState } from "@/components/ui";
import { ConfirmAction } from "@/components/client";

export const dynamic = "force-dynamic";

export default async function NewCreditNotePage() {
  const session = await requirePermission("finance.manage");
  const returns = await eligibleReturnsForCredit(session.orgId);

  return (
    <>
      <PageHeader
        title="New credit note"
        subtitle="Credit notes are raised from completed customer returns. One note per return."
        actions={<Link href="/finance/credit-notes" className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium hover:bg-slate-200">← Credit notes</Link>}
      />
      {returns.length === 0 ? (
        <EmptyState title="No returns awaiting a credit note." hint="Record a customer return in Fulfilment → Returns first." />
      ) : (
        <Card>
          <Table headers={["Return", "Order", "Customer", ""]}>
            {returns.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <Td><Link href={`/fulfilment/returns/${r.id}`} className="font-mono text-xs font-medium text-indigo-700 hover:underline">{r.code}</Link></Td>
                <Td className="font-mono text-xs">{r.order.number}</Td>
                <Td className="font-medium">{r.order.customer.company}</Td>
                <Td className="text-right">
                  <ConfirmAction action={createCreditNoteAction} args={[r.id]} confirmText={`Create a credit note from return ${r.code}?`}>
                    Create credit note
                  </ConfirmAction>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
      <p className="mt-3 text-xs text-slate-400">Amounts are derived from the returned lines at their original order price.</p>
    </>
  );
}
