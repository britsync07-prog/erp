import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, hasPermission } from "@/server/auth/permissions";
import { receivablePOs, getReceivablePO, listReceipts, receivingStats } from "@/server/services/receiving";
import { submitReceiptAction } from "@/server/actions/receiving";
import { ReceiveForm } from "@/components/receiving-forms";
import { PageHeader, Card, Stat, Table, Td, StatusPill, EmptyState, Pagination } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ReceivingPage({ searchParams }: {
  searchParams?: Promise<{ po?: string; page?: string }>;
}) {
  const session = await requirePermission("inventory.view");
  const sp = (await searchParams) ?? {};
  const canReceive = hasPermission(session, "inventory.manage");
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const [stats, queue, receipts] = await Promise.all([
    receivingStats(session.orgId),
    receivablePOs(session.orgId),
    listReceipts(session.orgId, page),
  ]);

  let selected: Awaited<ReturnType<typeof getReceivablePO>> | null = null;
  if (sp.po) {
    try {
      selected = await getReceivablePO(session.orgId, sp.po);
    } catch {
      notFound();
    }
  }

  const receiptsBase = `/inventory/receiving${sp.po ? `?po=${encodeURIComponent(sp.po)}` : ""}`;

  return (
    <>
      <PageHeader
        title="Goods receiving"
        subtitle="Warehouse work queue: receive deliveries against purchase orders. Damaged goods are recorded but never enter sellable stock."
      />
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Stat label="POs awaiting delivery" value={stats.incoming} />
        <Stat label="Overdue" value={stats.overdue} />
        <Stat label="Receipts posted" value={receipts.total} />
      </div>

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Work queue ({queue.length})
      </h2>
      {queue.length === 0 ? (
        <EmptyState title="Nothing to receive." hint="Sent, confirmed or partially received purchase orders will queue here." />
      ) : (
        <Table headers={["PO", "Supplier", "Expected", "Remaining", "Action"]}>
          {queue.map(({ po, remainingLines, remainingQty, overdue }) => (
            <tr key={po.id} className={po.id === sp.po ? "bg-indigo-50/60 hover:bg-indigo-50" : "hover:bg-slate-50"}>
              <Td>
                <Link href={`/procurement/${po.id}`} className="font-mono text-xs font-medium text-indigo-700 hover:underline">
                  {po.number}
                </Link>
              </Td>
              <Td>{po.supplier.company}</Td>
              <Td>
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-xs text-slate-500">
                    {po.expectedDate ? po.expectedDate.toLocaleDateString("en-IE") : "—"}
                  </span>
                  {overdue ? <StatusPill value="OVERDUE" /> : <StatusPill value={po.status} />}
                </span>
              </Td>
              <Td className="text-xs text-slate-500">
                {remainingLines} line{remainingLines === 1 ? "" : "s"} · {remainingQty} units
              </Td>
              <Td>
                <Link
                  href={`/inventory/receiving/${po.id}`}
                  className="rounded-lg bg-indigo-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-800"
                >
                  Receive
                </Link>
              </Td>
            </tr>
          ))}
        </Table>
      )}

      {selected && (
        <Card className="mt-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">Receive {selected.number}</h2>
              <StatusPill value={selected.status} />
              <span className="text-sm text-slate-500">
                {selected.supplier.company} → {selected.warehouse?.name ?? "no warehouse"}
              </span>
            </div>
            <Link href="/inventory/receiving" className="text-sm font-medium text-slate-500 hover:underline">
              Clear ✕
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
              poId={selected.id}
              rows={selected.lines.map((l) => ({
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
      )}

      <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Receipt history ({receipts.total})
      </h2>
      {receipts.items.length === 0 ? (
        <EmptyState title="No receipts yet." hint="Posted goods receipts will appear here." />
      ) : (
        <>
          <Table headers={["Receipt", "PO", "Supplier", "Warehouse", "Received", "Lines"]}>
            {receipts.items.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <Td><Link href={`/inventory/receipts/${r.id}`} className="font-mono text-xs font-medium text-indigo-700 hover:underline">{r.code}</Link></Td>
                <Td>
                  <Link href={`/procurement/${r.poId}`} className="font-mono text-xs text-indigo-700 hover:underline">
                    {r.po.number}
                  </Link>
                </Td>
                <Td>{r.po.supplier.company}</Td>
                <Td>{r.warehouse.name}</Td>
                <Td className="text-xs text-slate-500">{r.receivedAt.toLocaleString("en-IE")}</Td>
                <Td>{r._count.lines}</Td>
              </tr>
            ))}
          </Table>
          <Pagination page={receipts.page} pages={receipts.pages} base={receiptsBase} />
        </>
      )}
    </>
  );
}
