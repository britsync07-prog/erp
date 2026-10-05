import { requirePermission, hasPermission } from "@/server/auth/permissions";
import { listCategories } from "@/server/services/catalog";
import { PageHeader, Card, Table, Td } from "@/components/ui";
import { ConfirmAction } from "@/components/client";
import { CategoryForm } from "@/components/entity-forms";
import { createCategoryAction, deleteCategoryAction } from "@/server/actions/catalog";

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const session = await requirePermission("products.view");
  const categories = await listCategories(session.orgId);
  const canManage = hasPermission(session, "products.manage");

  return (
    <>
      <PageHeader title="Categories" subtitle="Product taxonomy. Deletion is blocked while products use a category." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">All categories</h2>
          {categories.length === 0 ? <p className="text-sm text-slate-500">No categories yet.</p> : (
            <Table headers={["Name", "Products", ""]}>
              {categories.map((c) => (
                <tr key={c.id}>
                  <Td className="font-medium">{c.name}</Td>
                  <Td>{c._count.products}</Td>
                  <Td>
                    {canManage && (
                      <ConfirmAction action={deleteCategoryAction} args={[c.id]} confirmText={`Delete category "${c.name}"?`} danger>Delete</ConfirmAction>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        {canManage && (
          <Card>
            <h2 className="mb-3 font-semibold">New category</h2>
            <CategoryForm action={createCategoryAction} />
          </Card>
        )}
      </div>
    </>
  );
}
