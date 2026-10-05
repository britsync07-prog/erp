import Link from "next/link";
import { requirePermission } from "@/server/auth/permissions";
import { marginsBoard } from "@/server/services/finance";
import { PageHeader, Card, Stat, Table, Td, StatusPill } from "@/components/ui";
import { formatCents } from "@/domain/units";

export const dynamic = "force-dynamic";

function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}

export default async function MarginsPage() {
  const session = await requirePermission("finance.view");
  const board = await marginsBoard(session.orgId);

  return (
    <>
      <PageHeader
        title="Margins"
        subtitle="Finance-only view: net revenue, cost basis and margin on delivered, invoiced and paid orders. Never shown on the warehouse floor."
        actions={<Link href="/finance" className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium hover:bg-slate-200">← Invoices</Link>}
      />
      <div className="mb-5 grid gap-4 sm:grid-cols-4">
        <Stat label="Net revenue" value={formatCents(board.totals.revenue)} />
        <Stat label="Cost basis" value={formatCents(board.totals.cost)} />
        <Stat label="Margin" value={formatCents(board.totals.margin)} />
        <Stat label="Margin %" value={pct(board.pct)} />
      </div>

      <Card className="mb-5">
        <h2 className="mb-3 font-semibold">Orders ({board.orders.length})</h2>
        {board.orders.length === 0 ? (
          <p className="text-sm text-slate-500">No delivered, invoiced or paid orders yet.</p>
        ) : (
          <Table headers={["Order", "Customer", "Status", "Net", "Cost", "Margin", "Margin %"]}>
            {board.orders.map((o) => (
              <tr key={o.id} className="hover:bg-slate-50">
                <Td className="font-mono text-xs">{o.number}</Td>
                <Td>{o.customer.company}</Td>
                <Td><StatusPill value={o.status} /></Td>
                <Td>{formatCents(o.net)}</Td>
                <Td>{formatCents(o.costCents)}</Td>
                <Td><span className={o.margin < 0 ? "font-semibold text-red-700" : "font-medium"}>{formatCents(o.margin)}</span></Td>
                <Td className={o.margin < 0 ? "font-semibold text-red-700" : ""}>{pct(o.pct)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold">Products ({board.products.length})</h2>
        {board.products.length === 0 ? (
          <p className="text-sm text-slate-500">No active products.</p>
        ) : (
          <Table headers={["SKU", "Product", "Cost", "Std price", "Margin", "Margin %"]}>
            {board.products.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <Td className="font-mono text-xs">{p.sku}</Td>
                <Td>{p.name}</Td>
                <Td>{formatCents(p.costCents)}</Td>
                <Td>{formatCents(p.standardPriceCents)}</Td>
                <Td><span className={p.margin < 0 ? "font-semibold text-red-700" : "font-medium"}>{formatCents(p.margin)}</span></Td>
                <Td className={p.margin < 0 ? "font-semibold text-red-700" : ""}>{pct(p.pct)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
