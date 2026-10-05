import Link from "next/link";
import { requirePermission, hasPermission } from "@/server/auth/permissions";
import { listCreditNotes, eligibleReturnsForCredit } from "@/server/services/finance";
import { createCreditNoteAction } from "@/server/actions/finance";
import { PageHeader, Card, Table, Td, StatusPill, EmptyState, Pagination } from "@/components/ui";
import { ConfirmAction } from "@/components/client";

export const dynamic = "force-dynamic";

export default async function CreditNotesPage({ searchParams }: {
  searchParams?: Promise<{ page?: string }>;
}) {
  const session = await requirePermission("finance.view");
  const sp = (await searchParams) ?? {};
  const rawPage = Number.parseInt(sp.page ?? "1", 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const [data, eligible] = await Promise.all([
    listCreditNotes(session.orgId, page),
    eligibleReturnsForCredit(session.orgId),
  ]);
  const canManage = hasPermission(session, "finance.manage");

  return (
    <>
      <PageHeader
        title="Credit notes"
        subtitle="Issued against completed returns. Open credits reduce what the customer owes on receivables."
        actions={<Link href="/finance" className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium hover:bg-slate-200">← Invoices</Link>}
      />
      {data.items.length === 0 ? (
        <EmptyState title="No credit notes yet." hint="Complete a return, then create a credit note from it below." />
      ) : (
        <>
          <Table headers={["Number", "Customer", "Lines", "Total", "Status", "Created"]}>
            {data.items.map((n) => (
              <tr key={n.id} className="hover:bg-slate-50">
                <Td className="font-mono text-xs font-medium">{n.number}</Td>
                <Td>{n.customer.company}</Td>
                <Td>{n._count.lines}</Td>
                <Td>€{(n.totalCents / 100).toFixed(2)}</Td>
                <Td><StatusPill value={n.status} /></Td>
                <Td className="text-xs text-slate-500">{n.createdAt.toLocaleDateString("en-IE")}</Td>
              </tr>
            ))}
          </Table>
          <Pagination page={data.page} pages={data.pages} base="/finance/credit-notes" />
        </>
      )}

      {canManage && (
        <Card className="mt-5">
          <h2 className="mb-1 font-semibold">Completed returns without a credit note ({eligible.length})</h2>
          <p className="mb-3 text-sm text-slate-500">Creating a note opens it as a draft — issue it to reduce receivables.</p>
          {eligible.length === 0 ? (
            <p className="text-sm text-slate-500">Every completed return already has a credit note.</p>
          ) : (
            <Table headers={["Return", "Order", "Customer", ""]}>
              {eligible.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <Td className="font-mono text-xs">{r.code}</Td>
                  <Td className="font-mono text-xs">{r.order.number}</Td>
                  <Td>{r.order.customer.company}</Td>
                  <Td>
                    <ConfirmAction action={createCreditNoteAction} args={[r.id]} confirmText={`Create draft credit note for return ${r.code}?`}>
                      Create note
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
