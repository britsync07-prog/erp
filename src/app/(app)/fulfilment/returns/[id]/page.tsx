import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, hasPermission } from "@/server/auth/permissions";
import { getReturn } from "@/server/services/fulfilment";
import { createCreditNoteAction } from "@/server/actions/finance";
import { PageHeader, Card, Stat, Table, Td, StatusPill } from "@/components/ui";
import { ConfirmAction } from "@/components/client";

export const dynamic = "force-dynamic";

export default async function ReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("orders.view");
  const { id } = await params;
  const ret = await getReturn(session.orgId, id).catch(() => notFound());
  const canCredit = hasPermission(session, "finance.manage");
  const restock = ret.lines.filter((l) => l.condition === "RESTOCK").length;
  const damaged = ret.lines.filter((l) => l.condition === "DAMAGED").length;

  return (
    <>
      <PageHeader
        title={`Return ${ret.code}`}
        subtitle={`Order ${ret.order.number} · ${ret.order.customer.company} · ${ret.createdAt.toLocaleString("en-IE")}`}
        actions={<Link href="/fulfilment/returns" className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium hover:bg-slate-200">← Returns</Link>}
      />
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Order" value={<Link href={`/orders/${ret.orderId}`} className="text-indigo-700 hover:underline">{ret.order.number}</Link>} />
        <Stat label="Status" value={<StatusPill value={ret.status} />} />
        <Stat label="Restock lines" value={restock} />
        <Stat label="Damaged lines" value={damaged} />
      </div>
      {ret.reason && (
        <Card className="mt-4"><p className="text-sm text-slate-600"><span className="font-semibold">Reason: </span>{ret.reason}</p></Card>
      )}
      <Card className="mt-4">
        <h2 className="mb-3 font-semibold">Returned lines</h2>
        <p className="mb-3 text-xs text-slate-400">Restocked lines went back into sellable stock; damaged lines were recorded but never re-entered stock.</p>
        <Table headers={["Product", "Qty", "Condition"]}>
          {ret.lines.map((l) => (
            <tr key={l.id} className="hover:bg-slate-50">
              <Td><Link href={`/products/${l.productId}`} className="font-medium text-indigo-700 hover:underline">{l.product.sku} — {l.product.name}</Link></Td>
              <Td>{l.quantity}</Td>
              <Td><StatusPill value={l.condition} /></Td>
            </tr>
          ))}
        </Table>
      </Card>
      {canCredit && (
        <Card className="mt-4">
          <h2 className="mb-3 font-semibold">Finance handoff</h2>
          <ConfirmAction action={createCreditNoteAction} args={[ret.id]} confirmText={`Create a credit note from return ${ret.code}?`}>Create credit note</ConfirmAction>
        </Card>
      )}
    </>
  );
}
