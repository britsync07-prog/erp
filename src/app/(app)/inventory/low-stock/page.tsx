import Link from "next/link";
import { requirePermission, hasPermission } from "@/server/auth/permissions";
import { lowStockBoard } from "@/server/services/inventory";
import { createRequirementAction } from "@/server/actions/inventory";
import { PageHeader, Card, Stat, Table, Td, StatusPill, EmptyState, Pagination } from "@/components/ui";
import { SearchBox } from "@/components/client";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

/** FormData-compatible wrapper: delegates to the existing requirement action. */
async function raiseRequirementAction(formData: FormData): Promise<void> {
  "use server";
  const productId = String(formData.get("productId") ?? "");
  const qty = Number(String(formData.get("qty") ?? "0").replace(",", "."));
  const reason = String(formData.get("reason") ?? "");
  await createRequirementAction(productId, qty, reason);
}

export default async function LowStockPage({ searchParams }: {
  searchParams?: Promise<{ q?: string; page?: string }>;
}) {
  const session = await requirePermission("inventory.view");
  const sp = (await searchParams) ?? {};
  const board = await lowStockBoard(session.orgId);
  const canRaise =
    hasPermission(session, "inventory.manage") || hasPermission(session, "procurement.manage");

  const q = (sp.q ?? "").trim().toLowerCase();
  const rows = q
    ? board.filter(
        (r) =>
          r.product.sku.toLowerCase().includes(q) ||
          r.product.name.toLowerCase().includes(q),
      )
    : board;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pages);
  const items = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const openCount = board.filter((r) => r.openRequirement).length;
  const base = `/inventory/low-stock${sp.q ? `?q=${encodeURIComponent(sp.q)}` : ""}`;

  return (
    <>
      <PageHeader
        title="Low stock"
        subtitle="Products below reorder point with deterministic reorder suggestions. Raising a requirement notifies procurement."
        actions={<SearchBox defaultValue={sp.q} placeholder="Search SKU or name…" />}
      />
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Stat label="Below reorder point" value={board.length} />
        <Stat label="Open requirements" value={openCount} link="/procurement" />
        <Stat label="Suggested units (total)" value={board.reduce((s, r) => s + r.suggestion, 0)} />
      </div>
      {items.length === 0 ? (
        <EmptyState
          title={board.length === 0 ? "Nothing is low." : "No matches."}
          hint={board.length === 0 ? "All products are above their reorder point." : "Try a different search."}
        />
      ) : (
        <>
          <Table headers={["SKU", "Product", "Available", "Reorder at", "Suggested", "Reason", "Requirement", "Action"]}>
            {items.map((r) => (
              <tr key={r.product.id} className="hover:bg-slate-50">
                <Td className="font-mono text-xs">{r.product.sku}</Td>
                <Td>
                  <Link href={`/products/${r.product.id}`} className="font-medium text-indigo-700 hover:underline">
                    {r.product.name}
                  </Link>
                </Td>
                <Td><span className="font-semibold text-amber-700">{r.stock.available}</span></Td>
                <Td>{r.product.reorderPoint}</Td>
                <Td className="font-medium">{r.suggestion}</Td>
                <Td className="max-w-56 text-xs text-slate-500">{r.reason}</Td>
                <Td>
                  {r.openRequirement ? (
                    <span className="inline-flex items-center gap-1.5">
                      <StatusPill value={r.openRequirement.status} />
                      <span className="text-xs text-slate-500">× {r.openRequirement.requiredQty}</span>
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </Td>
                <Td>
                  {!r.openRequirement && canRaise ? (
                    <form action={raiseRequirementAction} className="flex items-center gap-1.5">
                      <input type="hidden" name="productId" value={r.product.id} />
                      <input type="hidden" name="reason" value={r.reason} />
                      <input
                        name="qty"
                        required
                        inputMode="decimal"
                        defaultValue={r.suggestion > 0 ? String(r.suggestion) : ""}
                        placeholder="Qty"
                        aria-label={`Required quantity for ${r.product.sku}`}
                        className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
                      />
                      <button
                        type="submit"
                        className="rounded-lg bg-indigo-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-800"
                      >
                        Raise
                      </button>
                    </form>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
          <Pagination page={safePage} pages={pages} base={base} />
        </>
      )}
      <Card className="mt-4">
        <p className="text-sm text-slate-600">
          Requirements convert into purchase orders on the{" "}
          <Link href="/procurement" className="font-medium text-indigo-700 hover:underline">procurement</Link>{" "}
          board. Full levels (all warehouses) stay on{" "}
          <Link href="/inventory" className="font-medium text-indigo-700 hover:underline">stock overview</Link>{" "}
          — the <span className="font-mono text-xs">?low=1</span> filter there keeps working.
        </p>
      </Card>
    </>
  );
}
