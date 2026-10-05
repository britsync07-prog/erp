import Link from "next/link";
import { requirePermission } from "@/server/auth/permissions";
import { suggestCustomerCode } from "@/server/services/customers";
import { createCustomerAction } from "@/server/actions/customers";
import { CustomerForm } from "@/components/entity-forms";
import { PageHeader, Card } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NewCustomerPage() {
  const session = await requirePermission("customers.manage");
  const code = await suggestCustomerCode(session.orgId);

  return (
    <>
      <PageHeader
        title="New customer"
        subtitle="Add a company to the customer directory."
        actions={
          <Link href="/customers" className="text-sm font-medium text-indigo-700 hover:underline">
            ← Back to customers
          </Link>
        }
      />
      <Card>
        <CustomerForm action={createCustomerAction} initial={{ code }} submitLabel="Create customer" />
      </Card>
    </>
  );
}
