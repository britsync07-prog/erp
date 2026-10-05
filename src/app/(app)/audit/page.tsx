import { requirePermission } from "@/server/auth/permissions";
import { listAudit } from "@/server/services/platformRead";
import { PageHeader, Table, Td, StatusPill, Pagination } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AuditPage({ searchParams }: {
  searchParams?: Promise<{ entity?: string; action?: string; page?: string }>;
}) {
  const session = await requirePermission("audit.view");
  const sp = (await searchParams) ?? {};
  const data = await listAudit(session.orgId, sp);
  const baseParams = new URLSearchParams();
  if (sp.entity) baseParams.set("entity", sp.entity);
  if (sp.action) baseParams.set("action", sp.action);
  const base = `/audit${baseParams.toString() ? `?${baseParams.toString()}` : ""}`;

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Immutable record of who changed what, when, and through which channel."
        actions={
          <form method="get" className="flex gap-2">
            <input name="entity" defaultValue={sp.entity ?? ""} placeholder="Entity e.g. CUSTOMER" className="w-44 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <input name="action" defaultValue={sp.action ?? ""} placeholder="Action e.g. CREATE" className="w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <button type="submit" className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium hover:bg-slate-200">Filter</button>
          </form>
        }
      />
      <Table headers={["When", "Actor", "Action", "Entity", "Source"]}>
        {data.items.map((a) => (
          <tr key={a.id}>
            <Td className="whitespace-nowrap text-xs text-slate-500">{a.createdAt.toLocaleString("en-IE")}</Td>
            <Td>{a.actorName ?? "—"}</Td>
            <Td><StatusPill value={a.action} /></Td>
            <Td className="font-mono text-xs">{a.entityType} · {a.entityId.slice(-6)}</Td>
            <Td className="text-xs text-slate-500">{a.source}</Td>
          </tr>
        ))}
      </Table>
      <Pagination page={data.page} pages={data.pages} base={base} />
    </>
  );
}
