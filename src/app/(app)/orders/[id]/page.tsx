import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, hasPermission } from "@/server/auth/permissions";
import { getOrder } from "@/server/services/orders";
import { productOptions } from "@/server/services/catalog";
import {
  cancelOrderAction,
  confirmOrderAction,
  deleteDraftAction,
  recheckOrderAction,
  setDraftLinesAction,
  updateDraftAction,
} from "@/server/actions/orders";
import { DraftForm, OrderLinesEditor } from "@/components/order-forms";
import { ConfirmAction } from "@/components/client";
import {
  PageHeader,
  Card,
  Stat,
  Table,
  Td,
  StatusPill,
  Timeline,
} from "@/components/ui";
import { formatCents } from "@/domain/units";

export const dynamic = "force-dynamic";

const FINAL_STATUSES = ["CANCELLED", "DELIVERED", "PAID", "INVOICED"];

function toDateInput(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requirePermission("orders.view");
  const { id } = await params;

  let data: Awaited<ReturnType<typeof getOrder>>;
  try {
    data = await getOrder(session.orgId, id);
  } catch (e) {
    if (e instanceof Error && /not found/i.test(e.message)) notFound();
    throw e;
  }
  const { order, reservations, requirements, events, estimate } = data;
  const canManage = hasPermission(session, "orders.manage");
  const isDraft = order.status === "DRAFT";
  const isPriced = !isDraft;

  // Margin from snapshotted values (stored at confirm; drafts have no snapshot yet).
  const netCents = (order.subtotalCents ?? 0) - (order.discountCents ?? 0);
  const costCents = order.costCents ?? 0;
  const marginCents = netCents - costCents;
  const marginPct = netCents > 0 ? (marginCents / netCents) * 100 : 0;

  // Draft-only editing data (permission-gated to avoid needless product reads).
  const products = canManage && isDraft ? await productOptions(session.orgId) : [];

  const showCancel =
    canManage && !isDraft && !FINAL_STATUSES.includes(order.status);
  const reservedUnits = reservations.reduce((s, r) => s + r.quantity, 0);

  return (
    <>
      <Link href="/orders" className="mb-4 inline-block text-sm font-medium text-indigo-700 hover:underline">
        ← Back to orders
      </Link>
      <PageHeader
        title={`Order ${order.number}`}
        subtitle={`${order.customer.company} (${order.customer.code}) · ordered ${order.orderDate.toLocaleDateString("en-IE")}`}
        actions={
          <>
            <StatusPill value={order.status} />
            {canManage && isDraft && (
              <ConfirmAction
                action={confirmOrderAction} args={[order.id]}
                confirmText={`Confirm ${order.number}? Prices snapshot and stock is reserved.`}
              >
                Confirm order
              </ConfirmAction>
            )}
            {canManage && order.status === "WAITING_FOR_STOCK" && (
              <ConfirmAction
                action={recheckOrderAction} args={[order.id]}
                confirmText={`Recheck availability for ${order.number}?`}
              >
                Recheck stock
              </ConfirmAction>
            )}
            {canManage && isDraft && (
              <ConfirmAction
                action={deleteDraftAction} args={[order.id]}
                confirmText={`Delete draft ${order.number}?`}
                danger
              >
                Delete draft
              </ConfirmAction>
            )}
            {showCancel && (
              <ConfirmAction
                action={cancelOrderAction} args={[order.id]}
                confirmText={`Cancel ${order.number}? Reservations are released.`}
                danger
              >
                Cancel order
              </ConfirmAction>
            )}
          </>
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat
          label="Total"
          value={isPriced ? formatCents(order.totalCents) : "—"}
        />
        <Stat
          label="Subtotal"
          value={isPriced ? formatCents(order.subtotalCents) : "—"}
        />
        <Stat label="Tax" value={isPriced ? formatCents(order.taxCents) : "—"} />
        <Stat
          label="Cost"
          value={isPriced ? formatCents(costCents) : "—"}
        />
        <Stat
          label="Margin"
          value={
            isPriced
              ? `${formatCents(marginCents)} (${marginPct.toFixed(1)}%)`
              : "—"
          }
        />
      </div>

      <Card className="mb-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Lines · {isDraft ? "live estimates (snapshot at confirm)" : "snapshotted prices"}
        </h2>
        {order.lines.length === 0 ? (
          <p className="text-sm text-slate-500">
            No lines yet.{canManage && isDraft ? " Add lines below." : ""}
          </p>
        ) : (
          <Table headers={["Product", "Qty", "Unit price", "Discount", "Tax", "Line total"]}>
            {order.lines.map((l, i) => {
              const unit = isDraft ? (estimate?.[i]?.unitPriceCents ?? 0) : l.unitPriceCents;
              const net = Math.round(l.quantity * unit * (1 - l.discountPct / 100));
              const tax = Math.round((net * l.taxRate) / 100);
              return (
                <tr key={l.id} className="hover:bg-slate-50">
                  <Td>
                    <span className="font-medium">{l.product.name}</span>
                    <span className="block font-mono text-xs text-slate-400">{l.product.sku}</span>
                  </Td>
                  <Td>{l.quantity}</Td>
                  <Td>
                    {formatCents(unit)}
                    {isDraft && (
                      <span className="block text-xs text-slate-400">
                        est. · {estimate?.[i]?.source ?? "standard"}
                      </span>
                    )}
                  </Td>
                  <Td>{l.discountPct}%</Td>
                  <Td>{l.taxRate}%</Td>
                  <Td className="font-medium">{formatCents(net + tax)}</Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      {canManage && isDraft && (
        <div className="mb-4 grid items-start gap-4 lg:grid-cols-2">
          <Card>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Draft details
            </h2>
            <DraftForm
              action={updateDraftAction}
              customers={[]}
              lockCustomer
              submitLabel="Save details"
              initial={{
                id: order.id,
                customerName: `${order.customer.code} — ${order.customer.company}`,
                paymentTerms: order.paymentTerms ?? "",
                orderDate: toDateInput(order.orderDate),
                requestedDate: toDateInput(order.requestedDate),
                deliveryAddress: order.deliveryAddress ?? "",
                internalNotes: order.internalNotes ?? "",
                customerNotes: order.customerNotes ?? "",
              }}
            />
          </Card>
          <Card>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Order lines
            </h2>
            <OrderLinesEditor
              action={setDraftLinesAction}
              orderId={order.id}
              products={products}
              initialLines={order.lines.map((l) => ({
                productId: l.productId,
                quantity: l.quantity,
                discountPct: l.discountPct,
              }))}
            />
          </Card>
        </div>
      )}

      <div className="mb-4 grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Fulfilment & shipments
          </h2>
          {order.fulfilments.length === 0 ? (
            <p className="text-sm text-slate-500">
              {isDraft
                ? "Fulfilment is created when the order is confirmed."
                : "No fulfilment records yet."}
            </p>
          ) : (
            <ul className="space-y-3">
              {order.fulfilments.map((f) => {
                const required = f.lines.reduce((s, l) => s + l.requiredQty, 0);
                const picked = f.lines.reduce((s, l) => s + l.pickedQty, 0);
                return (
                  <li key={f.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <StatusPill value={f.status} />
                      <span className="text-xs text-slate-500">
                        {picked}/{required} picked · {f.lines.length} line{f.lines.length === 1 ? "" : "s"}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-3 text-sm text-slate-500">
            Reserved stock: <span className="font-semibold text-slate-800">{reservedUnits}</span> unit{reservedUnits === 1 ? "" : "s"}
            {order.deliveryAddress && (
              <span className="block truncate" title={order.deliveryAddress}>
                Ship to: {order.deliveryAddress}
              </span>
            )}
          </p>
          {order.invoices.length > 0 && (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Invoices</p>
              <ul className="space-y-1.5 text-sm">
                {order.invoices.map((inv) => (
                  <li key={inv.id} className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs">{inv.number}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-slate-600">{formatCents(inv.totalCents)}</span>
                      <StatusPill value={inv.status} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
        <Card>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Stock shortages
          </h2>
          {requirements.length === 0 ? (
            <p className="text-sm text-slate-500">No open shortages for this order.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {requirements.map((r) => (
                <li key={r.id} className="rounded-lg bg-amber-50 px-3 py-2 ring-1 ring-inset ring-amber-200">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {r.product.sku} — {r.product.name}
                    </span>
                    <StatusPill value={r.status} />
                  </div>
                  <p className="text-xs text-amber-800">
                    Needs {r.requiredQty} more unit{r.requiredQty === 1 ? "" : "s"}.
                    {r.reason ? ` ${r.reason}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Activity
        </h2>
        <Timeline events={events} />
      </Card>
    </>
  );
}
