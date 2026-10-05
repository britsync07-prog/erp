import Link from "next/link";
import { requirePermission } from "@/server/auth/permissions";
import { listReservations } from "@/server/services/inventory";
import { productOptions } from "@/server/services/catalog";
import { PageHeader, Card, Stat, Table, Td, EmptyState, Pagination } from "@/components/ui";
import { QuerySelect } from "@/components/client";

export const dynamic = "force-dynamic";

export default async function ReservationsPage({ searchParams }: {
  searchParams?: Promise<{ product?: string; page?: string }>;
}) {
  const session = await requirePermission("inventory.view");
  const sp = (await searchParams) ?? {};
  const [data, products] = await Promise.all([
    listReservations(session.orgId, sp),
    productOptions(session.orgId),
  ]);

  const base = `/inventory/reservations${sp.product ? `?product=${encodeURIComponent(sp.product)}` : ""}`;
  const pageUnits = data.items.reduce((s, r) => s + r.quantity, 0);

  return (
    <>
      <PageHeader
        title="Stock reservations"
        subtitle="Sellable stock held for confirmed orders. Reservations reduce available stock without moving physical goods."
        actions={
          <QuerySelect
            name="product" value={sp.product} placeholder="All products"
            options={products.map((p) => ({ value: p.id, label: `${p.sku} — ${p.name}` }))}
          />
        }
      />
      <div className="mb-5 grid gap-4 sm:grid-cols-2">
        <Stat label="Open reservations" value={data.total} />
        <Stat label="Reserved units (this page)" value={pageUnits} />
      </div>
      {data.items.length === 0 ? (
        <EmptyState
          title="No reservations."
          hint="Confirming a sales order reserves stock; dispatching or cancelling releases it."
        />
      ) : (
        <>
          <Table headers={["Created", "Product", "Qty", "Order"]}>
            {data.items.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <Td className="whitespace-nowrap text-xs text-slate-500">
                  {r.createdAt.toLocaleString("en-IE")}
                </Td>
                <Td>
                  <span className="font-mono text-xs text-slate-500">{r.product.sku}</span>{" "}
                  <Link href={`/products/${r.productId}`} className="font-medium text-indigo-700 hover:underline">
                    {r.product.name}
                  </Link>
                </Td>
                <Td className="font-semibold">{r.quantity}</Td>
                <Td>
                  {r.orderId ? (
                    <Link href={`/orders/${r.orderId}`} className="text-sm font-medium text-indigo-700 hover:underline">
                      Open order →
                    </Link>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
          <Pagination page={data.page} pages={data.pages} base={base} />
        </>
      )}
      <Card className="mt-4">
        <p className="text-sm text-slate-600">
          Reservations are system-managed — there is no manual edit. If held stock looks wrong,
          correct physical levels with an{" "}
          <Link href="/inventory/adjustments" className="font-medium text-indigo-700 hover:underline">
            adjustment
          </Link>{" "}
          and check the order on{" "}
          <Link href="/fulfilment" className="font-medium text-indigo-700 hover:underline">fulfilment</Link>.
        </p>
      </Card>
    </>
  );
}
