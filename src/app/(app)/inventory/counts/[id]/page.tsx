import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, hasPermission } from "@/server/auth/permissions";
import { getCount } from "@/server/services/inventory";
import { submitCountedAction, postCountAction, cancelCountAction } from "@/server/actions/inventory";
import { PageHeader, Card, Table, Td, StatusPill } from "@/components/ui";
import { CountEntryForm } from "@/components/inventory-forms";
import { ConfirmAction } from "@/components/client";

export const dynamic = "force-dynamic";

export default async function CountPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("inventory.view");
  const { id } = await params;
  const count = await getCount(session.orgId, id).catch(() => notFound());
  const canManage = hasPermission(session, "inventory.manage");
  const isOpen = count.status === "OPEN";

  return (
    <>
      <PageHeader
        title={`Count ${count.code}`}
        subtitle={`${count.warehouse.name} · opened ${count.createdAt.toLocaleString("en-IE")}`}
        actions={<Link href="/inventory/counts" className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium hover:bg-slate-200">← Counts</Link>}
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill value={count.status} />
          {canManage && isOpen && (
            <>
              <ConfirmAction action={postCountAction} args={[count.id]} confirmText="Post this count? Ledger corrections will be written for every variance.">Post corrections</ConfirmAction>
              <ConfirmAction action={cancelCountAction} args={[count.id]} confirmText="Cancel this count without posting?">Cancel count</ConfirmAction>
            </>
          )}
        </div>
        {!isOpen && <p className="mt-2 text-sm text-slate-500">This count is closed. Variances were posted as stock count corrections.</p>}
      </Card>
      {canManage && isOpen && (
        <Card className="mt-4">
          <h2 className="mb-3 font-semibold">Enter counted quantities</h2>
          <CountEntryForm action={submitCountedAction} countId={count.id} lines={count.lines.map((l) => ({ productId: l.productId, sku: l.product.sku, name: l.product.name, expectedQty: l.expectedQty, countedQty: l.countedQty }))} />
        </Card>
      )}
      <Card className="mt-4">
        <h2 className="mb-3 font-semibold">Count lines</h2>
        <Table headers={["Product", "Expected", "Counted", "Variance"]}>
          {count.lines.map((l) => {
            const variance = (l.countedQty ?? l.expectedQty) - l.expectedQty;
            return (
              <tr key={l.id} className="hover:bg-slate-50">
                <Td><Link href={`/products/${l.productId}`} className="font-medium text-indigo-700 hover:underline">{l.product.sku} — {l.product.name}</Link></Td>
                <Td>{l.expectedQty}</Td>
                <Td>{l.countedQty ?? "—"}</Td>
                <Td>{l.countedQty == null ? "—" : <span className={variance === 0 ? "" : "font-semibold text-amber-700"}>{variance}</span>}</Td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </>
  );
}
