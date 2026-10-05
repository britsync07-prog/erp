import Link from "next/link";
import { requireSession } from "@/server/auth/permissions";
import { searchAll } from "@/server/services/platformRead";
import { PageHeader, Card, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SearchPage({ searchParams }: { searchParams?: Promise<{ q?: string }> }) {
  const session = await requireSession();
  const q = ((await searchParams) ?? {}).q?.trim() ?? "";
  const hits = q.length >= 2 ? await searchAll(session.orgId, q) : [];
  const groups = [...new Set(hits.map((h) => h.group))];

  return (
    <>
      <PageHeader title="Global search" subtitle="Products, orders, customers, suppliers, purchase orders, invoices." />
      <form method="get" className="mb-4 flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Product, SKU, barcode, order number, customer…"
          autoFocus
          className="w-full max-w-xl rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none"
        />
        <button type="submit" className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-800">Search</button>
      </form>
      {q.length >= 2 && hits.length === 0 && <EmptyState title="No results." hint="Check spelling or try a code (SKU, order number)." />}
      {groups.map((g) => (
        <Card key={g} className="mb-3">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{g}</h2>
          <ul className="divide-y divide-slate-100">
            {hits.filter((h) => h.group === g).map((h) => (
              <li key={h.link}>
                <Link href={h.link} className="flex items-center justify-between py-2 hover:bg-slate-50">
                  <span className="font-medium text-indigo-700">{h.label}</span>
                  {h.sub && <span className="text-xs text-slate-400">{h.sub}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </>
  );
}
