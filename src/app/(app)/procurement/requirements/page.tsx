import Link from "next/link";
import { requirePermission, hasPermission } from "@/server/auth/permissions";
import { listRequirements } from "@/server/services/procurement";
import { PageHeader, Card, Table, Td, StatusPill, EmptyState, Pagination } from "@/components/ui";
import { ConfirmAction, QuerySelect } from "@/components/client";
import { RequirementsConvertForm } from "@/components/procurement-forms";
import { cancelRequirementAction, convertRequirementsAction } from "@/server/actions/procurement";

export const dynamic = "force-dynamic";

const REQ_STATUSES = ["OPEN", "ORDERED", "CANCELLED"];

export default async function RequirementsPage({ searchParams }: {
  searchParams?: Promise<{ status?: string; page?: string }>;
}) {
  const session = await requirePermission("procurement.view");
  const sp = (await searchParams) ?? {};
  const data = await listRequirements(session.orgId, sp);
  const canManage = hasPermission(session, "procurement.manage");
  const base = `/procurement/requirements${sp.status ? `?status=${sp.status}` : ""}`;
  const open = data.items.filter((r) => r.status === "OPEN");

  return (
    <>
      <Link href="/procurement" className="mb-3 inline-block text-sm font-medium text-indigo-700 hover:underline">
        ← Back to purchase orders
      </Link>
      <PageHeader
        title="Purchase requirements"
        subtitle="Open demand from orders. Convert into supplier-grouped draft POs, or cancel what is no longer needed."
        actions={
          <QuerySelect
            name="status"
            value={sp.status}
            placeholder="All statuses"
            options={REQ_STATUSES.map((s) => ({ value: s, label: s }))}
          />
        }
      />
      {canManage && open.length > 0 && (
        <Card className="mb-5">
          <h2 className="mb-3 font-semibold">Convert to purchase orders</h2>
          <RequirementsConvertForm
            action={convertRequirementsAction}
            requirements={open.map((r) => ({
              id: r.id,
              productSku: r.product.sku,
              requiredQty: r.requiredQty,
              salesUnit: r.product.salesUnit,
            }))}
          />
        </Card>
      )}
      {data.items.length === 0 ? (
        <EmptyState title="No requirements found." hint="Confirmed order lines below safety cover will raise requirements here." />
      ) : (
        <>
          <Table headers={["Product", "Required", "Order", "Status", ""]}>
            {data.items.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <Td>
                  <span className="font-mono text-xs font-medium">{r.product.sku}</span>
                  <span className="ml-2 text-slate-600">{r.product.name}</span>
                </Td>
                <Td>
                  {r.requiredQty} {r.product.salesUnit}
                </Td>
                <Td className="font-mono text-xs text-slate-500">{r.orderNumber ?? "—"}</Td>
                <Td>
                  <StatusPill value={r.status} />
                </Td>
                <Td>
                  {canManage && r.status === "OPEN" && (
                    <ConfirmAction
                      action={cancelRequirementAction} args={[r.id]}
                      confirmText={`Cancel requirement for ${r.product.sku}?`}
                      danger
                    >
                      Cancel
                    </ConfirmAction>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
          <Pagination page={data.page} pages={data.pages} base={base} />
        </>
      )}
    </>
  );
}
