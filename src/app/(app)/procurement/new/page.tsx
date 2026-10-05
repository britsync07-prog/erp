import Link from "next/link";
import { requirePermission } from "@/server/auth/permissions";
import { supplierOptions } from "@/server/services/suppliers";
import { listWarehouses } from "@/server/services/warehouses";
import { PageHeader, Card } from "@/components/ui";
import { POHeaderForm } from "@/components/procurement-forms";
import { createPODraftAction } from "@/server/actions/procurement";

export const dynamic = "force-dynamic";

export default async function NewPOPage() {
  const session = await requirePermission("procurement.manage");
  const [suppliers, warehouses] = await Promise.all([
    supplierOptions(session.orgId),
    listWarehouses(session.orgId),
  ]);

  return (
    <>
      <Link href="/procurement" className="mb-3 inline-block text-sm font-medium text-indigo-700 hover:underline">
        ← Back to purchase orders
      </Link>
      <PageHeader
        title="New purchase order"
        subtitle="Create a draft header first, then add lines on the PO detail page."
      />
      <Card>
        <POHeaderForm
          action={createPODraftAction}
          suppliers={suppliers}
          warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))}
          submitLabel="Create draft"
        />
      </Card>
    </>
  );
}
