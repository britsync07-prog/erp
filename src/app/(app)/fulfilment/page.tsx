import Link from "next/link";
import { requirePermission, hasPermission } from "@/server/auth/permissions";
import { fulfilmentBoard } from "@/server/services/fulfilment";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { ConfirmAction } from "@/components/client";
import { startPickingAction } from "@/server/actions/fulfilment";

export const dynamic = "force-dynamic";

const COLUMNS: { key: string; title: string; hint: string }[] = [
  { key: "WAITING_FOR_STOCK", title: "Waiting for stock", hint: "Blocked until goods arrive." },
  { key: "READY_TO_PICK", title: "Ready to pick", hint: "Start picking." },
  { key: "PICKING", title: "Picking", hint: "In progress on the floor." },
  { key: "READY_TO_DISPATCH", title: "Ready to dispatch", hint: "Pack and ship." },
  { key: "DISPATCHED", title: "Dispatched", hint: "With the carrier." },
];

function age(createdAt: Date): string {
  const h = Math.floor((Date.now() - createdAt.getTime()) / 3600000);
  if (h < 1) return "new";
  if (h < 24) return `${h}h old`;
  return `${Math.floor(h / 24)}d old`;
}

export default async function FulfilmentPage() {
  const session = await requirePermission("orders.view");
  const board = await fulfilmentBoard(session.orgId);
  const canWork = hasPermission(session, "inventory.manage");
  const total = Object.values(board).reduce((s, g) => s + g.length, 0);

  return (
    <>
      <PageHeader
        title="Fulfilment"
        subtitle="Warehouse view: what to pick, pack and ship. No finance data on this screen by design."
        actions={<Link href="/fulfilment/returns" className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium hover:bg-slate-200">Returns →</Link>}
      />
      {total === 0 ? (
        <EmptyState title="Floor is clear." hint="Confirmed orders waiting, ready or moving will queue here." />
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-5 lg:grid-cols-3 sm:grid-cols-2">
          {COLUMNS.map((col) => (
            <div key={col.key} className="rounded-xl bg-slate-200/60 p-3">
              <p className="px-1 text-sm font-semibold">{col.title} ({board[col.key].length})</p>
              <p className="px-1 pb-2 text-xs text-slate-500">{col.hint}</p>
              <div className="space-y-2">
                {board[col.key].map((f) => (
                  <Card key={f.id} className="p-3">
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`/fulfilment/${f.id}`} className="font-mono text-sm font-semibold text-indigo-700 hover:underline">
                        {f.order.number}
                      </Link>
                      <span className="text-xs text-slate-400">{age(f.createdAt)}</span>
                    </div>
                    <p className="mt-0.5 truncate text-sm text-slate-600">{f.order.customer.company}</p>
                    <p className="text-xs text-slate-400">
                      {f.lines.length} line{f.lines.length === 1 ? "" : "s"} ·{" "}
                      {f.lines.reduce((s, l) => s + l.pickedQty, 0)}/{f.lines.reduce((s, l) => s + l.requiredQty, 0)} picked
                    </p>
                    {f.order.requestedDate && (
                      <p className="text-xs text-slate-400">wanted {f.order.requestedDate.toLocaleDateString("en-IE")}</p>
                    )}
                    {canWork && f.status === "READY_TO_PICK" && (
                      <div className="mt-2">
                        <ConfirmAction action={startPickingAction} args={[f.id]} confirmText={`Start picking ${f.order.number}?`}>Start picking</ConfirmAction>
                      </div>
                    )}
                    {(!canWork || f.status !== "READY_TO_PICK") && (
                      <Link href={`/fulfilment/${f.id}`} className="mt-2 inline-block text-sm font-medium text-indigo-700 hover:underline">Open →</Link>
                    )}
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
