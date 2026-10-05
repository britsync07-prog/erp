import Link from "next/link";
import { requirePermission, hasPermission } from "@/server/auth/permissions";
import { listApprovals } from "@/server/services/approvals";
import { PageHeader, Card, StatusPill, Pagination, EmptyState } from "@/components/ui";
import { ConfirmAction, QuerySelect } from "@/components/client";
import { ApprovalRejectForm } from "@/components/inventory-forms";
import { approveRequestAction, rejectRequestAction } from "@/server/actions/approvals";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage({ searchParams }: {
  searchParams?: Promise<{ status?: string; page?: string }>;
}) {
  const session = await requirePermission("inventory.view");
  const sp = (await searchParams) ?? {};
  const status = sp.status ?? "PENDING";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const data = await listApprovals(session.orgId, status, page);
  const base = `/approvals${status !== "PENDING" ? `?status=${status}` : ""}`;
  const canApprove = (kind: string) =>
    (kind === "PO_APPROVAL" && hasPermission(session, "procurement.approve")) ||
    (kind === "AI_ACTION" && hasPermission(session, "intelligence.manage")) ||
    (kind === "STOCK_ADJUSTMENT" && hasPermission(session, "inventory.manage"));

  return (
    <>
      <PageHeader
        title="Approvals"
        subtitle="Human gate for significant actions. You cannot decide your own requests."
        actions={
          <QuerySelect
            name="status" value={status} placeholder="Pending"
            options={[{ value: "PENDING", label: "Pending" }, { value: "APPROVED", label: "Approved" }, { value: "REJECTED", label: "Rejected" }, { value: "ALL", label: "All" }]}
          />
        }
      />
      {data.items.length === 0 ? (
        <EmptyState title={status === "PENDING" ? "Nothing waiting." : "No requests."} hint="Significant stock adjustments and purchase orders will appear here." />
      ) : (
        <>
          <div className="space-y-3">
            {data.items.map((r) => (
              <Card key={r.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <StatusPill value={r.status} />
                    <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs">{r.kind.replace(/_/g, " ")}</span>
                    <p className="font-medium">{r.reason ?? "—"}</p>
                    {r.kind === "PO_APPROVAL" && r.entityId !== "PENDING" && (
                      <Link href={`/procurement/${r.entityId}`} className="text-sm font-medium text-indigo-700 hover:underline">Open PO →</Link>
                    )}
                    {r.kind === "STOCK_ADJUSTMENT" && r.payload?.productId && (
                      <Link href={`/products/${r.payload.productId}`} className="text-sm font-medium text-indigo-700 hover:underline">Open product →</Link>
                    )}
                    {r.kind === "AI_ACTION" && (
                      <Link href="/intelligence/activity" className="text-sm font-medium text-indigo-700 hover:underline">AI activity →</Link>
                    )}
                  </div>
                  {r.kind === "AI_ACTION" && r.payload?.tool && (
                    <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-600">
                      {r.payload.tool} {JSON.stringify(r.payload.args ?? {})}
                    </pre>
                  )}
                  <p className="text-xs text-slate-400">
                    requested by {r.requestedByName} · {r.createdAt.toLocaleString("en-IE")}
                    {r.decidedByName && ` · decided by ${r.decidedByName}`}
                  </p>
                </div>
                {r.status === "PENDING" && r.requestedBy !== session.id && canApprove(r.kind) && (
                  <div className="mt-3 flex flex-wrap items-start gap-3">
                    <ConfirmAction action={approveRequestAction} args={[r.id]} confirmText="Approve and apply this action?">Approve & apply</ConfirmAction>
                    <div className="min-w-64 flex-1"><ApprovalRejectForm action={rejectRequestAction} id={r.id} /></div>
                  </div>
                )}
                {r.status === "PENDING" && r.requestedBy === session.id && (
                  <p className="mt-2 text-xs text-slate-400">Waiting for a second person to decide.</p>
                )}
              </Card>
            ))}
          </div>
          <Pagination page={data.page} pages={data.pages} base={base} />
        </>
      )}
    </>
  );
}
