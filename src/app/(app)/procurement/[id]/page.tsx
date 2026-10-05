import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, hasPermission } from "@/server/auth/permissions";
import { getPO } from "@/server/services/procurement";
import { productOptions } from "@/server/services/catalog";
import { PageHeader, Card, Table, Td, StatusPill, EmptyState, Timeline } from "@/components/ui";
import { ConfirmAction } from "@/components/client";
import { POHeaderForm, POLinesEditor } from "@/components/procurement-forms";
import {
  updatePODraftAction,
  setPOLinesAction,
  deletePODraftAction,
  submitPOAction,
  sendPOAction,
  confirmSupplierPOAction,
  closePOAction,
  cancelPOAction,
} from "@/server/actions/procurement";
import { formatCents } from "@/domain/units";

export const dynamic = "force-dynamic";

export default async function PODetailPage({ params }: {
  params: Promise<{ id: string }>;
}) {
  const session = await requirePermission("procurement.view");
  const { id } = await params;
  const data = await getPO(session.orgId, id).catch(() => null);
  if (!data) notFound();
  const { po, requirements, events, approval } = data;
  const canManage = hasPermission(session, "procurement.manage");
  const products = po.status === "DRAFT" && canManage ? await productOptions(session.orgId) : [];

  return (
    <>
      <Link href="/procurement" className="mb-3 inline-block text-sm font-medium text-indigo-700 hover:underline">
        ← Back to purchase orders
      </Link>
      <PageHeader
        title={`PO ${po.number}`}
        subtitle={`${po.supplier.company} · expected ${po.expectedDate ? po.expectedDate.toLocaleDateString("en-IE") : "—"}`}
        actions={<StatusPill value={po.status} />}
      />

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card>
          <h2 className="mb-3 font-semibold">Header</h2>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Supplier</dt><dd className="font-medium">{po.supplier.code} — {po.supplier.company}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Warehouse</dt><dd>{po.warehouse?.name ?? "—"}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Subtotal</dt><dd>{formatCents(po.subtotalCents)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Tax</dt><dd>{formatCents(po.taxCents)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Total</dt><dd className="font-semibold">{formatCents(po.totalCents)}</dd></div>
          </dl>
          {po.notes && <p className="mt-3 text-sm text-slate-600">{po.notes}</p>}
        </Card>

        {approval && (
          <Card>
            <h2 className="mb-3 font-semibold">Approval</h2>
            <div className="flex items-center gap-2">
              <StatusPill value={approval.status} />
              <span className="text-sm text-slate-600">{approval.reason ?? "Purchase order approval"}</span>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              requested {approval.createdAt.toLocaleString("en-IE")}
              {approval.decidedAt && ` · decided ${approval.decidedAt.toLocaleString("en-IE")}`}
            </p>
            {approval.status === "PENDING" && (
              <p className="mt-2 text-sm text-slate-600">
                Waiting for a decision. <Link href="/approvals" className="font-medium text-indigo-700 hover:underline">Open approvals →</Link>
              </p>
            )}
          </Card>
        )}

        {canManage && (
          <Card>
            <h2 className="mb-3 font-semibold">Actions</h2>
            <div className="flex flex-wrap gap-2">
              {po.status === "DRAFT" && (
                <>
                  <ConfirmAction action={submitPOAction} args={[po.id]} confirmText={`Submit ${po.number} for approval? Lines can no longer be edited once submitted.`}>
                    Submit for approval
                  </ConfirmAction>
                  <ConfirmAction action={cancelPOAction} args={[po.id]} confirmText={`Cancel draft ${po.number}?`} danger>
                    Cancel PO
                  </ConfirmAction>
                  <ConfirmAction action={deletePODraftAction} args={[po.id]} confirmText={`Delete draft ${po.number}? Linked requirements reopen.`} danger>
                    Delete draft
                  </ConfirmAction>
                </>
              )}
              {po.status === "PENDING_APPROVAL" && (
                <>
                  <ConfirmAction action={cancelPOAction} args={[po.id]} confirmText={`Cancel ${po.number} while awaiting approval?`} danger>
                    Cancel PO
                  </ConfirmAction>
                  <p className="w-full text-xs text-slate-400">Approve or reject from the approvals queue — you cannot decide your own requests.</p>
                </>
              )}
              {po.status === "APPROVED" && (
                <>
                  <ConfirmAction action={sendPOAction} args={[po.id]} confirmText={`Mark ${po.number} as sent to the supplier?`}>
                    Send to supplier
                  </ConfirmAction>
                  <ConfirmAction action={cancelPOAction} args={[po.id]} confirmText={`Cancel ${po.number}?`} danger>
                    Cancel PO
                  </ConfirmAction>
                </>
              )}
              {po.status === "SENT" && (
                <>
                  <ConfirmAction action={confirmSupplierPOAction} args={[po.id]} confirmText={`Mark ${po.number} as confirmed by the supplier?`}>
                    Confirm receipt by supplier
                  </ConfirmAction>
                  <ConfirmAction action={cancelPOAction} args={[po.id]} confirmText={`Cancel ${po.number}?`} danger>
                    Cancel PO
                  </ConfirmAction>
                </>
              )}
              {(po.status === "SUPPLIER_CONFIRMED" || po.status === "PARTIALLY_RECEIVED") && (
                <>
                  <p className="w-full text-sm text-slate-600">Goods are received through warehouse receiving; partial receipts move the PO automatically.</p>
                  <ConfirmAction action={cancelPOAction} args={[po.id]} confirmText={`Cancel ${po.number}? Linked requirements reopen.`} danger>
                    Cancel PO
                  </ConfirmAction>
                </>
              )}
              {po.status === "RECEIVED" && (
                <ConfirmAction action={closePOAction} args={[po.id]} confirmText={`Close ${po.number}?`}>
                  Close PO
                </ConfirmAction>
              )}
              {(po.status === "CLOSED" || po.status === "CANCELLED") && (
                <p className="text-sm text-slate-500">This purchase order is {po.status.toLowerCase().replace(/_/g, " ")}. No further actions.</p>
              )}
            </div>
          </Card>
        )}
      </div>

      <Card className="mt-4">
        <h2 className="mb-3 font-semibold">Lines ({po.lines.length})</h2>
        {po.lines.length === 0 ? (
          <EmptyState title="No lines yet." hint={po.status === "DRAFT" ? "Add lines below before submitting for approval." : "This PO was submitted without lines."} />
        ) : (
          <Table headers={["Product", "Qty", "Unit cost", "Received", "Line total"]}>
            {po.lines.map((l) => (
              <tr key={l.id} className="hover:bg-slate-50">
                <Td>
                  <span className="font-mono text-xs font-medium">{l.product.sku}</span>
                  <span className="ml-2 text-slate-600">{l.product.name}</span>
                </Td>
                <Td>{l.quantity} {l.product.purchaseUnit}</Td>
                <Td>{formatCents(l.unitCostCents)}</Td>
                <Td>{l.receivedQty} {l.product.purchaseUnit}</Td>
                <Td>{formatCents(Math.round(l.quantity * (l.product.conversionFactor ?? 1) * l.unitCostCents))}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {po.status === "DRAFT" && canManage && (
        <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
          <Card>
            <h2 className="mb-3 font-semibold">Edit header</h2>
            <POHeaderForm
              action={updatePODraftAction}
              suppliers={[{ id: po.supplierId, company: po.supplier.company, code: po.supplier.code }]}
              warehouses={po.warehouse ? [{ id: po.warehouseId as string, name: po.warehouse.name }] : []}
              initial={{
                id: po.id,
                supplierId: po.supplierId,
                warehouseId: po.warehouseId ?? "",
                expectedDate: po.expectedDate ? po.expectedDate.toISOString().slice(0, 10) : "",
                notes: po.notes ?? "",
              }}
              submitLabel="Save header"
            />
          </Card>
          <Card>
            <h2 className="mb-3 font-semibold">Edit lines</h2>
            <POLinesEditor
              action={setPOLinesAction}
              poId={po.id}
              products={products.map((p) => ({
                id: p.id,
                sku: p.sku,
                name: p.name,
                purchaseUnit: p.purchaseUnit,
                conversionFactor: p.conversionFactor,
                defaultCostCents: p.costCents,
              }))}
              initialLines={po.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitCostCents: l.unitCostCents }))}
            />
          </Card>
        </div>
      )}

      {requirements.length > 0 && (
        <Card className="mt-4">
          <h2 className="mb-3 font-semibold">Linked requirements ({requirements.length})</h2>
          <Table headers={["Product", "Status"]}>
            {requirements.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <Td>
                  <span className="font-mono text-xs font-medium">{r.product.sku}</span>
                  <span className="ml-2 text-slate-600">{r.product.name}</span>
                </Td>
                <Td><StatusPill value={r.status} /></Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <Card className="mt-4">
        <h2 className="mb-3 font-semibold">Receipt history ({po.receipts.length})</h2>
        {po.receipts.length === 0 ? (
          <EmptyState title="Nothing received yet." hint="Goods receipts post here once the warehouse receives this PO." />
        ) : (
          <Table headers={["Code", "Received at"]}>
            {po.receipts.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <Td className="font-mono text-xs font-medium">{r.code}</Td>
                <Td className="text-xs text-slate-500">{r.receivedAt.toLocaleString("en-IE")}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card className="mt-4">
        <h2 className="mb-3 font-semibold">Activity</h2>
        <Timeline events={events} />
      </Card>
    </>
  );
}
