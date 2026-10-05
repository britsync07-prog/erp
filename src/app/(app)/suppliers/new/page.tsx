import Link from "next/link";
import { requirePermission } from "@/server/auth/permissions";
import { suggestSupplierCode } from "@/server/services/suppliers";
import { createSupplierAction } from "@/server/actions/suppliers";
import { SupplierForm } from "@/components/entity-forms";
import { PageHeader, Card } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NewSupplierPage() {
  const session = await requirePermission("suppliers.manage");
  const code = await suggestSupplierCode(session.orgId);

  return (
    <>
      <PageHeader
        title="New supplier"
        subtitle="Add a company to the supplier directory."
        actions={
          <Link href="/suppliers" className="text-sm font-medium text-indigo-700 hover:underline">
            ← Back to suppliers
          </Link>
        }
      />
      <Card>
        <SupplierForm action={createSupplierAction} initial={{ code }} submitLabel="Create supplier" />
      </Card>
    </>
  );
}
