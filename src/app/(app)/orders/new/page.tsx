import Link from "next/link";
import { requirePermission } from "@/server/auth/permissions";
import { createDraftAction } from "@/server/actions/orders";
import { customerOptions } from "@/server/services/customers";
import { DraftForm } from "@/components/order-forms";
import { PageHeader, Card } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NewOrderPage() {
  const session = await requirePermission("orders.manage");
  const customers = await customerOptions(session.orgId);

  return (
    <>
      <Link href="/orders" className="mb-4 inline-block text-sm font-medium text-indigo-700 hover:underline">
        ← Back to orders
      </Link>
      <PageHeader
        title="New order"
        subtitle="Create a draft: pick the customer and delivery details. You add order lines on the draft page — prices snapshot when you confirm."
      />
      <Card>
        <DraftForm action={createDraftAction} customers={customers} submitLabel="Create draft" />
      </Card>
      <Card className="mt-4">
        <p className="text-sm text-slate-500">
          After creating the draft you are taken to the order detail page, where you add lines
          (product, quantity, discount). Drafts show live price estimates; the final
          snapshotted prices, stock reservation and totals are computed at confirm time.
        </p>
      </Card>
    </>
  );
}
