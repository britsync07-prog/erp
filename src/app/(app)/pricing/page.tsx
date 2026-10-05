import Link from "next/link";
import { requirePermission } from "@/server/auth/permissions";
import { pricingOverview } from "@/server/services/catalog";
import { PageHeader, Card, Table, Td, StatusPill, EmptyState } from "@/components/ui";
import { formatCents } from "@/domain/units";

export const dynamic = "force-dynamic";

export default async function PricingPage({ searchParams }: { searchParams?: Promise<{ q?: string }> }) {
  const session = await requirePermission("pricing.view");
  const sp = (await searchParams) ?? {};
  const q = sp.q?.trim() ?? "";
  const { rules, customerPrices } = await pricingOverview(session.orgId, q);

  return (
    <>
      <PageHeader
        title="Pricing"
        subtitle="Group, promotional and contract rules plus customer-specific prices. Order lines always snapshot the resolved price."
        actions={
          <form method="get" className="flex gap-2">
            <input
              name="q"
              defaultValue={q}
              placeholder="Filter by product or customer…"
              className="w-64 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none"
            />
            <button type="submit" className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium hover:bg-slate-200">Filter</button>
          </form>
        }
      />
      <div className="grid gap-4">
        <Card>
          <h2 className="mb-3 font-semibold">Price rules ({rules.length})</h2>
          {rules.length === 0 ? <EmptyState title="No special price rules." hint="Add group, promo or contract rules from a product page." /> : (
            <Table headers={["Product", "Type", "Group", "Price", "Min qty", "Valid to"]}>
              {rules.map((r) => (
                <tr key={r.id}>
                  <Td><Link href={`/products/${r.productId}`} className="font-medium text-indigo-700 hover:underline">{r.product.sku}</Link></Td>
                  <Td><StatusPill value={r.kind} /></Td>
                  <Td>{r.priceGroup ?? "—"}</Td>
                  <Td>{formatCents(r.priceCents)}</Td>
                  <Td>{r.minQty}</Td>
                  <Td>{r.validTo ? r.validTo.toLocaleDateString("en-IE") : "—"}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Customer-specific prices ({customerPrices.length})</h2>
          {customerPrices.length === 0 ? <EmptyState title="No customer-specific prices." hint="Set them from a customer page." /> : (
            <Table headers={["Customer", "Product", "Price", "Min qty", "Valid to"]}>
              {customerPrices.map((p) => (
                <tr key={p.id}>
                  <Td><Link href={`/customers/${p.customerId}`} className="font-medium text-indigo-700 hover:underline">{p.customer.company}</Link></Td>
                  <Td><Link href={`/products/${p.productId}`} className="text-indigo-700 hover:underline">{p.product.sku}</Link></Td>
                  <Td>{formatCents(p.priceCents)}</Td>
                  <Td>{p.minQty}</Td>
                  <Td>{p.validTo ? p.validTo.toLocaleDateString("en-IE") : "—"}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
