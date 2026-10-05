import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/server/auth/permissions";
import { getReceipt } from "@/server/services/receiving";
import { PageHeader, Card, Table, Td, StatusPill } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("inventory.view");
  const { id } = await params;
  const receipt = await getReceipt(session.orgId, id).catch(() => notFound());

  return (
    <>
      <PageHeader
        title={`Receipt ${receipt.code}`}
        subtitle={`PO ${receipt.po.number} · ${receipt.po.supplier.company} · received ${receipt.receivedAt.toLocaleString("en-IE")}`}
        actions={<Link href="/inventory/receiving" className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium hover:bg-slate-200">← Receiving</Link>}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="py-4">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Purchase order</div>
          <div className="mt-1 text-2xl font-semibold"><Link href={`/procurement/${receipt.poId}`} className="text-indigo-700 hover:underline">{receipt.po.number}</Link></div>
        </Card>
        <Card className="py-4">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Warehouse</div>
          <div className="mt-1 text-2xl font-semibold">{receipt.warehouse.name}</div>
        </Card>
        <Card className="py-4">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Lines</div>
          <div className="mt-1 text-2xl font-semibold">{receipt.lines.length}</div>
        </Card>
      </div>
      <Card className="mt-4">
        <h2 className="mb-3 font-semibold">Received lines</h2>
        <p className="mb-3 text-xs text-slate-400">Damaged quantities are recorded here but never enter sellable stock.</p>
        <Table headers={["Product", "Received", "Damaged", "Status"]}>
          {receipt.lines.map((l) => (
            <tr key={l.id} className="hover:bg-slate-50">
              <Td><Link href={`/products/${l.productId}`} className="font-medium text-indigo-700 hover:underline">{l.product.sku} — {l.product.name}</Link></Td>
              <Td><span className="font-semibold text-emerald-700">{l.receivedQty}</span></Td>
              <Td>{l.damagedQty > 0 ? <span className="font-semibold text-red-700">{l.damagedQty}</span> : "—"}</Td>
              <Td><StatusPill value={l.damagedQty > 0 ? "PARTIAL" : "RECEIVED"} /></Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
