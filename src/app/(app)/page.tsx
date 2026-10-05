import Link from "next/link";
import { requireSession, hasPermission } from "@/server/auth/permissions";
import { dashboard } from "@/server/services/platformRead";
import { Card, PageHeader, Stat, Table, Td, Timeline } from "@/components/ui";
import { formatCents } from "@/domain/units";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await requireSession();
  const data = await dashboard(user.orgId, user);
  const canSeeStock = hasPermission(user, "products.view");

  return (
    <>
      <PageHeader
        title="Operational command centre"
        subtitle={`Good to see you, ${user.name}. Here is what needs attention right now.`}
        actions={
          <>
            {hasPermission(user, "customers.manage") && (
              <Link href="/customers/new" className="rounded-lg bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800">New order flow starts with customers →</Link>
            )}
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active customers" value={data.customers} link={hasPermission(user, "customers.view") ? "/customers" : undefined} />
        <Stat label="Active suppliers" value={data.suppliers} link={hasPermission(user, "suppliers.view") ? "/suppliers" : undefined} />
        <Stat label="Active products" value={data.products} link={canSeeStock ? "/products" : undefined} />
        <Stat label="Unread alerts" value={data.unread} link="/notifications" />
      </div>

      {hasPermission(user, "orders.view") && (
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Stat label="Orders today" value={data.orders.today} link="/orders" />
          <Stat label="Waiting for stock" value={data.orders.waiting} link="/orders?status=WAITING_FOR_STOCK" />
          <Stat label="Ready to pick" value={data.orders.ready} link="/orders?status=READY" />
        </div>
      )}
      {hasPermission(user, "procurement.view") && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Stat label="Open requirements" value={data.procurement.openReqs} link="/procurement/requirements" />
          <Stat label="Active purchase orders" value={data.procurement.pendingPOs} link="/procurement" />
        </div>
      )}
      {hasPermission(user, "inventory.view") && (data.receiving.incoming > 0 || data.receiving.overdue > 0) && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Stat label="POs awaiting delivery" value={data.receiving.incoming} link="/inventory/receiving" />
          <Stat label="Late supplier deliveries" value={data.receiving.overdue} link="/inventory/receiving" />
        </div>
      )}
      {hasPermission(user, "orders.view") && (data.fulfilment.toPick > 0 || data.fulfilment.toDispatch > 0 || data.fulfilment.inTransit > 0) && (
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Stat label="To pick" value={data.fulfilment.toPick} link="/fulfilment" />
          <Stat label="To dispatch" value={data.fulfilment.toDispatch} link="/fulfilment" />
          <Stat label="In transit" value={data.fulfilment.inTransit} link="/fulfilment" />
        </div>
      )}
      {hasPermission(user, "finance.view") && (data.finance.outstanding > 0 || data.finance.overdueCount > 0) && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Stat label="Outstanding receivables" value={formatCents(data.finance.outstanding)} link="/finance/receivables" />
          <Stat label="Overdue invoices" value={data.finance.overdueCount} link="/finance?overdue=1" />
        </div>
      )}
      {data.brief && (
        <Card className="mt-4 border-indigo-200">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-semibold">AI Daily Brief</p>
            <Link href="/intelligence" className="text-sm font-medium text-indigo-700 hover:underline">Open brief →</Link>
          </div>
          <p className="mt-1 text-sm text-slate-600">{data.brief.title}</p>
          <p className="mt-1 text-xs text-slate-400">{data.brief.open} open findings · {data.brief.at.toLocaleString("en-IE")}</p>
        </Card>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">Needs attention — low stock</h2>
          {!canSeeStock ? (
            <p className="text-sm text-slate-500">Your role does not include inventory visibility.</p>
          ) : data.lowStock.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing below reorder point. Stock is healthy.</p>
          ) : (
            <Table headers={["Product", "Available", "Reorder at"]}>
              {data.lowStock.map((r) => (
                <tr key={r.product.id} className="hover:bg-slate-50">
                  <Td><Link href={`/products/${r.product.id}`} className="font-medium text-indigo-700 hover:underline">{r.product.sku} — {r.product.name}</Link></Td>
                  <Td><span className="font-semibold text-amber-700">{r.stock.available}</span></Td>
                  <Td>{r.product.reorderPoint}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Latest activity</h2>
          <Timeline events={data.recentActivity} />
        </Card>
      </div>

      {data.unread > 0 && (
        <Card className="mt-4 border-amber-200 bg-amber-50">
          <p className="text-sm">
            <span className="font-semibold">{data.unread} unread alert{data.unread === 1 ? "" : "s"}.</span>{" "}
            <Link href="/notifications" className="font-medium text-indigo-700 hover:underline">Review them →</Link>
          </p>
        </Card>
      )}

      <Card className="mt-4">
        <h2 className="mb-3 font-semibold">Start working</h2>
        <div className="flex flex-wrap gap-2 text-sm">
          {hasPermission(user, "customers.manage") && <Link href="/customers/new" className="rounded-lg bg-slate-100 px-3 py-2 hover:bg-slate-200">New customer</Link>}
          {hasPermission(user, "suppliers.manage") && <Link href="/suppliers/new" className="rounded-lg bg-slate-100 px-3 py-2 hover:bg-slate-200">New supplier</Link>}
          {hasPermission(user, "products.manage") && <Link href="/products/new" className="rounded-lg bg-slate-100 px-3 py-2 hover:bg-slate-200">New product</Link>}
          <Link href="/search" className="rounded-lg bg-slate-100 px-3 py-2 hover:bg-slate-200">Global search</Link>
          {hasPermission(user, "audit.view") && <Link href="/audit" className="rounded-lg bg-slate-100 px-3 py-2 hover:bg-slate-200">Audit log</Link>}
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Full order → fulfilment → finance flow ships in Phases 4–8. Outstanding customer balance today: see Customers.
        </p>
      </Card>
    </>
  );
}
