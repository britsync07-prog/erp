import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, hasPermission } from "@/server/auth/permissions";
import { getFulfilment, returnableForOrder } from "@/server/services/fulfilment";
import {
  startPickingAction,
  confirmPickAction,
  dispatchAction,
  deliverAction,
  createReturnAction,
} from "@/server/actions/fulfilment";
import { PageHeader, Card, Stat, Table, Td, StatusPill } from "@/components/ui";
import { ConfirmAction } from "@/components/client";
import { PickForm, DispatchForm, ReturnForm } from "@/components/fulfilment-forms";

export const dynamic = "force-dynamic";

export default async function FulfilmentDetailPage({ params }: {
  params: Promise<{ id: string }>;
}) {
  const session = await requirePermission("orders.view");
  const { id } = await params;
  const data = await getFulfilment(session.orgId, id).catch(() => null);
  if (!data) notFound();
  const { fulfilment: f, returns } = data;
  const canWork = hasPermission(session, "inventory.manage");

  const required = f.lines.reduce((s, l) => s + l.requiredQty, 0);
  const picked = f.lines.reduce((s, l) => s + l.pickedQty, 0);

  // Returnable rows for this order (null when the order status no longer allows returns).
  let returnRows: { productId: string; sku: string; name: string; returnable: number; salesUnit: string }[] | null = null;
  if (canWork) {
    const r = await returnableForOrder(session.orgId, f.orderId).catch(() => null);
    if (r) {
      returnRows = r.rows
        .filter((row) => row.returnable > 0)
        .map((row) => ({
          productId: row.line.productId,
          sku: row.line.product.sku,
          name: row.line.product.name,
          returnable: row.returnable,
          salesUnit: row.line.product.salesUnit,
        }));
    }
  }

  return (
    <>
      <PageHeader
        title={`Pick & dispatch ${f.order.number}`}
        subtitle={`${f.order.customer.company}${f.order.requestedDate ? ` · wanted ${f.order.requestedDate.toLocaleDateString("en-IE")}` : ""}`}
        actions={
          <>
            <StatusPill value={f.status} />
            <Link href="/fulfilment" className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium hover:bg-slate-200">← Fulfilment</Link>
          </>
        }
      />
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Stat label="Lines" value={f.lines.length} />
        <Stat label="Picked" value={`${picked} / ${required}`} />
        <Stat label="Shipments" value={f.shipments.length} />
      </div>

      <Card className="mb-5">
        <h2 className="mb-3 font-semibold">Pick list — quantities only, no prices</h2>
        <Table headers={["SKU", "Product", "Required", "Picked", "Remaining"]}>
          {f.lines.map((l) => (
            <tr key={l.id} className="hover:bg-slate-50">
              <Td className="font-mono text-xs font-medium">{l.product.sku}</Td>
              <Td>{l.product.name}</Td>
              <Td>{l.requiredQty} {l.product.salesUnit}</Td>
              <Td>{l.pickedQty} {l.product.salesUnit}</Td>
              <Td><span className={l.pickedQty + 1e-9 >= l.requiredQty ? "text-emerald-700" : "font-medium"}>{l.requiredQty - l.pickedQty} {l.product.salesUnit}</span></Td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card className="mb-5">
        <h2 className="mb-3 font-semibold">Warehouse workflow</h2>
        {!canWork ? (
          <p className="text-sm text-slate-500">You can view this fulfilment. Warehouse staff (inventory.manage) advance picking, dispatch and delivery.</p>
        ) : f.status === "READY_TO_PICK" ? (
          <ConfirmAction action={startPickingAction} args={[f.id]} confirmText={`Start picking ${f.order.number}?`}>Start picking</ConfirmAction>
        ) : f.status === "PICKING" ? (
          <PickForm
            action={confirmPickAction}
            fulfilmentId={f.id}
            lines={f.lines.map((l) => ({
              productId: l.productId,
              sku: l.product.sku,
              name: l.product.name,
              salesUnit: l.product.salesUnit,
              requiredQty: l.requiredQty,
              pickedQty: l.pickedQty,
            }))}
          />
        ) : f.status === "READY_TO_DISPATCH" ? (
          <DispatchForm action={dispatchAction} fulfilmentId={f.id} />
        ) : f.status === "DISPATCHED" ? (
          <ConfirmAction action={deliverAction} args={[f.id]} confirmText={`Mark ${f.order.number} delivered?`}>Mark delivered</ConfirmAction>
        ) : (
          <p className="text-sm text-slate-500">
            {f.status === "DELIVERED" ? "Delivered. Returns for this order are handled below." : `No warehouse action available while status is ${f.status.replace(/_/g, " ")}.`}
          </p>
        )}
      </Card>

      {f.shipments.length > 0 && (
        <Card className="mb-5">
          <h2 className="mb-3 font-semibold">Shipments ({f.shipments.length})</h2>
          <Table headers={["Carrier", "Tracking", "Shipped", "Delivered"]}>
            {f.shipments.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50">
                <Td>{s.carrier ?? "—"}</Td>
                <Td className="font-mono text-xs">{s.tracking ?? "—"}</Td>
                <Td className="text-xs">{s.shippedAt ? s.shippedAt.toLocaleString("en-IE") : "—"}</Td>
                <Td className="text-xs">{s.deliveredAt ? s.deliveredAt.toLocaleString("en-IE") : "In transit"}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <Card className="mb-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Returns for this order ({returns.length})</h2>
          <Link href="/fulfilment/returns" className="text-sm font-medium text-indigo-700 hover:underline">All returns →</Link>
        </div>
        {returns.length === 0 ? (
          <p className="text-sm text-slate-500">No returns recorded for this order.</p>
        ) : (
          <Table headers={["Return", "Lines", "Reason", "Status", "Date"]}>
            {returns.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <Td className="font-mono text-xs font-medium">{r.code}</Td>
                <Td className="text-xs">
                  {r.lines.map((l) => `${l.product.sku} × ${l.quantity} (${l.condition})`).join(", ")}
                </Td>
                <Td className="text-xs text-slate-500">{r.reason ?? "—"}</Td>
                <Td><StatusPill value={r.status} /></Td>
                <Td className="text-xs text-slate-500">{r.createdAt.toLocaleDateString("en-IE")}</Td>
              </tr>
            ))}
          </Table>
        )}
        {canWork && returnRows && returnRows.length > 0 && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <h3 className="mb-3 text-sm font-semibold">Record a return</h3>
            <ReturnForm action={createReturnAction} orderId={f.orderId} rows={returnRows} orderLabel={f.order.number} />
          </div>
        )}
      </Card>
    </>
  );
}
