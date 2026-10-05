import Link from "next/link";
import { requirePermission, hasPermission } from "@/server/auth/permissions";
import { listCounts, listMovements } from "@/server/services/inventory";
import { listWarehouses } from "@/server/services/warehouses";
import { createCountAction, cancelCountAction } from "@/server/actions/inventory";
import { CountCreateForm } from "@/components/inventory-forms";
import { PageHeader, Card, Table, Td, StatusPill, EmptyState, Pagination } from "@/components/ui";
import { ConfirmAction } from "@/components/client";

export const dynamic = "force-dynamic";

export default async function CountsPage({ searchParams }: {
  searchParams?: Promise<{ page?: string }>;
}) {
  const session = await requirePermission("inventory.view");
  const sp = (await searchParams) ?? {};
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const canManage = hasPermission(session, "inventory.manage");

  const [data, warehouses, corrections] = await Promise.all([
    listCounts(session.orgId, page),
    listWarehouses(session.orgId),
    listMovements(session.orgId, { type: "STOCK_COUNT_CORRECTION" }),
  ]);

  return (
    <>
      <PageHeader
        title="Stock counts"
        subtitle="Full-warehouse counts: snapshot expected quantities, enter what you find, then post corrections. Only lines with a real difference post a movement."
      />
      {data.items.length === 0 ? (
        <EmptyState title="No counts yet." hint="Start a count for a warehouse below." />
      ) : (
        <>
          <Table headers={["Code", "Warehouse", "Status", "Lines", "Created", "Action"]}>
            {data.items.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <Td>
                  <Link href={`/inventory/counts/${c.id}`} className="font-mono text-xs font-medium text-indigo-700 hover:underline">
                    {c.code}
                  </Link>
                </Td>
                <Td>{c.warehouse.name}</Td>
                <Td><StatusPill value={c.status} /></Td>
                <Td>{c._count.lines}</Td>
                <Td className="whitespace-nowrap text-xs text-slate-500">
                  {c.createdAt.toLocaleString("en-IE")}
                </Td>
                <Td>
                  {c.status === "OPEN" && canManage ? (
                    <ConfirmAction
                      action={cancelCountAction} args={[c.id]}
                      confirmText={`Cancel count ${c.code}? Counted quantities will be discarded.`}
                      danger
                    >
                      Cancel
                    </ConfirmAction>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
          <Pagination page={data.page} pages={data.pages} base="/inventory/counts" />
        </>
      )}

      {canManage ? (
        <Card className="mt-4">
          <h2 className="mb-1 font-semibold">Start a count</h2>
          <p className="mb-3 text-sm text-slate-500">
            Snapshots today&apos;s expected quantities for every active product in the warehouse.
            Enter counted quantities on the count page, then post.
          </p>
          <CountCreateForm
            action={createCountAction}
            warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))}
          />
        </Card>
      ) : (
        <Card className="mt-4">
          <p className="text-sm text-slate-500">You need the inventory.manage permission to start counts.</p>
        </Card>
      )}

      <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Recent count corrections
      </h2>
      {corrections.items.length === 0 ? (
        <EmptyState title="No corrections posted." hint="Posting a count creates one correction movement per line with a real difference." />
      ) : (
        <Table headers={["Date", "Product", "Qty", "Count", "Note"]}>
          {corrections.items.map((m) => (
            <tr key={m.id} className="hover:bg-slate-50">
              <Td className="whitespace-nowrap text-xs text-slate-500">
                {m.createdAt.toLocaleString("en-IE")}
              </Td>
              <Td>
                <span className="font-mono text-xs text-slate-500">{m.product.sku}</span>{" "}
                <Link href={`/products/${m.productId}`} className="font-medium text-indigo-700 hover:underline">
                  {m.product.name}
                </Link>
              </Td>
              <Td>
                <span className={m.quantity < 0 ? "font-semibold text-red-700" : "font-semibold text-emerald-700"}>
                  {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                </span>
              </Td>
              <Td className="font-mono text-xs">{m.reference ?? "—"}</Td>
              <Td className="max-w-64 text-xs text-slate-500">{m.note ?? "—"}</Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
