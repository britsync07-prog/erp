import Link from "next/link";
import { requirePermission } from "@/server/auth/permissions";
import { listCategories } from "@/server/services/catalog";
import { supplierOptions } from "@/server/services/suppliers";
import { PageHeader, Card } from "@/components/ui";
import { ProductForm } from "@/components/entity-forms";
import { createProductAction } from "@/server/actions/catalog";

export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  const session = await requirePermission("products.manage");
  const [categories, suppliers] = await Promise.all([
    listCategories(session.orgId),
    supplierOptions(session.orgId),
  ]);

  return (
    <>
      <PageHeader
        title="New product"
        subtitle="Created with its standard price history entry. Opening stock posts to the default warehouse."
        actions={
          <Link href="/products" className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200">
            ← Back to products
          </Link>
        }
      />
      <Card>
        <ProductForm
          action={createProductAction}
          categories={categories}
          suppliers={suppliers}
          submitLabel="Create product"
          isNew
        />
      </Card>
    </>
  );
}
