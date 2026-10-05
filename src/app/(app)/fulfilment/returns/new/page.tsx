import Link from "next/link";
import { requirePermission, hasPermission } from "@/server/auth/permissions";
import { deliveredOrderOptions, returnableForOrder } from "@/server/services/fulfilment";
import { createReturnAction } from "@/server/actions/fulfilment";
import { PageHeader, Card, Field, inputCls } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { ReturnForm } from "@/components/fulfilment-forms";

export const dynamic = "force-dynamic";

export default async function NewReturnPage({ searchParams }: {
  searchParams?: Promise<{ orderId?: string }>;
}) {
  const session = await requirePermission("orders.view");
  const sp = (await searchParams) ?? {};
  const canWork = hasPermission(session, "inventory.manage");
  const options = canWork ? await deliveredOrderOptions(session.orgId) : [];
  const selectedId = typeof sp.orderId === "string" ? sp.orderId : "";
  const selected = selectedId
    ? await returnableForOrder(session.orgId, selectedId).catch(() => null)
    : null;
  const rows = selected
    ? selected.rows
        .filter((row) => row.returnable > 0)
        .map((row) => ({
          productId: row.line.productId,
          sku: row.line.product.sku,
          name: row.line.product.name,
          returnable: row.returnable,
          salesUnit: row.line.product.salesUnit,
        }))
    : [];

  return (
    <>
      <PageHeader
        title="Record a return"
        subtitle="Pick a delivered order, then enter quantities back per condition."
        actions={<Link href="/fulfilment/returns" className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium hover:bg-slate-200">← Returns</Link>}
      />
      {!canWork ? (
        <Card>
          <p className="text-sm text-slate-500">You need the inventory.manage permission to record returns.</p>
        </Card>
      ) : (
        <Card>
          <form method="get" action="/fulfilment/returns/new" className="mb-4 flex items-end gap-2">
            <Field label="Order">
              <select name="orderId" defaultValue={selectedId} className={inputCls}>
                <option value="">Select an order…</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>{o.number} — {o.customer.company}</option>
                ))}
              </select>
            </Field>
            <SubmitButton label="Load" pendingLabel="Loading…" />
          </form>
          {!selected ? (
            <p className="text-sm text-slate-500">
              {selectedId ? "This order can no longer be returned." : "Select an order to see returnable quantities."}
            </p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-500">Everything fulfilled on {selected.order.number} was already returned.</p>
          ) : (
            <ReturnForm action={createReturnAction} orderId={selected.order.id} rows={rows} orderLabel={selected.order.number} />
          )}
        </Card>
      )}
    </>
  );
}
