import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, hasPermission } from "@/server/auth/permissions";
import { getReceivablePO } from "@/server/services/receiving";
import { submitReceiptAction } from "@/server/actions/receiving";
import { ReceiveForm } from "@/components/receiving-forms";
import { PageHeader, Card, StatusPill, Table, Td } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ReceivePOPage({ params }: { params: Promise<{ poId: string }> }) {
  const session = await requirePermission("inventory.view");
  const { poId } = await params;
  const canReceive = hasPermission(session, "inventory.manage");

  let po: Awaited<ReturnType<typeof getReceivablePO>>;
  try {
    po = await getReceivablePO(session.orgId, poId);
  } catch {
    notFound();
  }

  return (
    <>
      <PageHeader
        title={`Receive ${po.number}`}
        subtitle={`${po.supplier.company} → ${po.warehouse?.name ?? "no warehouse"}`}
        actions={<Link href="/inventory/receiving" className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium hover:bg-slate-200">← Receiving</Link>}
      />
      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <StatusPill value={po.status} />
          {po.expectedDate && (
            <span className="text-sm text-slate-500">expected {po.expectedDate.toLocaleDateString("en-IE")}</span>
          )}
          <Link href={`/procurement/${po.id}`} className="text-sm font-medium text-indigo-700 hover:underline">
            Open purchase order →
          </Link>
        </div>
        <ul className="mb-4 list-disc space-y-1 pl-5 text-sm text-slate-600">
          <li>Partial deliveries are fine — the PO stays receivable until every line is complete.</li>
          <li>Damaged quantities are logged on the receipt but never enter sellable stock.</li>
          <li>Receiving more than ordered is accepted and flagged as overdelivery.</li>
        </ul>
        {canReceive ? (
          <ReceiveForm
            action={submitReceiptAction}
            poId={po.id}
            rows={po.lines.map((l) => ({
              productId: l.productId,
              sku: l.product.sku,
              name: l.product.name,
              purchaseUnit: l.product.purchaseUnit,
              ordered: l.quantity,
              alreadyReceived: l.receivedQty,
            }))}
          />
        ) : (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-inset ring-amber-200">
            You need the inventory.manage permission to post receipts.
          </p>
        )}
      </Card>
      <Card className="mt-4">
        <h2 className="mb-3 font-semibold">Expected on this order</h2>
        <Table headers={["Product", "Ordered", "Already received", "Outstanding"]}>
          {po.lines.map((l) => (
            <tr key={l.id} className="hover:bg-slate-50">
              <Td>
                <Link href={`/products/${l.productId}`} className="font-medium text-indigo-700 hover:underline">
                  {l.product.sku} — {l.product.name}
                </Link>
              </Td>
              <Td>{l.quantity} {l.product.purchaseUnit}</Td>
              <Td>{l.receivedQty}</Td>
              <Td className="font-semibold">{Math.max(0, l.quantity - l.receivedQty)}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
