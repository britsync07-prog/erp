import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, hasPermission } from "@/server/auth/permissions";
import { getSupplier } from "@/server/services/suppliers";
import { updateSupplierAction, addSupplierContactAction } from "@/server/actions/suppliers";
import { SupplierForm, ContactForm } from "@/components/entity-forms";
import { PageHeader, Card, Stat, Table, Td, StatusPill, EmptyState, Timeline } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("suppliers.view");
  const { id } = await params;
  const data = await getSupplier(session.orgId, id).catch(() => notFound());
  const { supplier, events } = data;
  const canManage = hasPermission(session, "suppliers.manage");

  return (
    <>
      <PageHeader
        title={supplier.company}
        subtitle={`${supplier.code} · Supplier since ${supplier.createdAt.toLocaleDateString("en-IE")}.`}
        actions={
          <Link href="/suppliers" className="text-sm font-medium text-indigo-700 hover:underline">
            ← Back to suppliers
          </Link>
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Stat label="Linked products" value={supplier.productLinks.length} />
        <Stat label="Purchase orders" value={supplier.purchaseOrders.length} />
        <Stat label="Lead time" value={`${supplier.leadTimeDays}d`} />
      </div>

      <div className="space-y-5">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Details</h2>
            <StatusPill value={supplier.status} />
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-slate-500">Email</dt><dd>{supplier.email ?? "—"}</dd></div>
            <div><dt className="text-slate-500">Phone</dt><dd>{supplier.phone ?? "—"}</dd></div>
            <div><dt className="text-slate-500">VAT number</dt><dd>{supplier.vatNumber ?? "—"}</dd></div>
            <div><dt className="text-slate-500">Payment terms</dt><dd>{supplier.paymentTerms.replace(/_/g, " ")}</dd></div>
            <div><dt className="text-slate-500">Lead time</dt><dd>{supplier.leadTimeDays} days</dd></div>
            <div><dt className="text-slate-500">Notes</dt><dd>{supplier.notes ?? "—"}</dd></div>
          </dl>
        </Card>

        {canManage && (
          <Card>
            <h2 className="mb-3 text-lg font-semibold">Edit supplier</h2>
            <SupplierForm
              action={updateSupplierAction}
              initial={{
                id: supplier.id,
                code: supplier.code,
                company: supplier.company,
                email: supplier.email,
                vatNumber: supplier.vatNumber,
                phone: supplier.phone,
                paymentTerms: supplier.paymentTerms,
                leadTimeDays: supplier.leadTimeDays,
                notes: supplier.notes,
              }}
              submitLabel="Save changes"
            />
          </Card>
        )}

        <Card>
          <h2 className="mb-3 text-lg font-semibold">Contacts</h2>
          {supplier.contacts.length === 0 ? (
            <EmptyState title="No contacts yet." hint="Add the people you deal with at this supplier." />
          ) : (
            <Table headers={["Name", "Role", "Phone", "Email"]}>
              {supplier.contacts.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <Td className="font-medium">{c.name}</Td>
                  <Td>{c.role ?? "—"}</Td>
                  <Td>{c.phone ?? "—"}</Td>
                  <Td>{c.email ?? "—"}</Td>
                </tr>
              ))}
            </Table>
          )}
          {canManage && (
            <div className="mt-4">
              <ContactForm action={addSupplierContactAction} ownerIdField="supplierId" ownerId={id} />
            </div>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-lg font-semibold">Linked products</h2>
          {supplier.productLinks.length === 0 ? (
            <EmptyState title="No linked products." hint="Link this supplier to products from the product page." />
          ) : (
            <Table headers={["SKU", "Product", "Supplier SKU", "Cost", "Preferred"]}>
              {supplier.productLinks.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50">
                  <Td className="font-mono text-xs">{l.product.sku}</Td>
                  <Td>{l.product.name}</Td>
                  <Td>{l.supplierSku ?? "—"}</Td>
                  <Td>€{(l.costCents / 100).toFixed(2)}</Td>
                  <Td>{l.isPreferred ? "Yes" : "—"}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-lg font-semibold">Purchase orders</h2>
          {supplier.purchaseOrders.length === 0 ? (
            <EmptyState title="No purchase orders yet." />
          ) : (
            <Table headers={["Order", "Status", "Total", "Created"]}>
              {supplier.purchaseOrders.map((o) => (
                <tr key={o.id} className="hover:bg-slate-50">
                  <Td className="font-mono text-xs">{o.number}</Td>
                  <Td><StatusPill value={o.status} /></Td>
                  <Td>€{(o.totalCents / 100).toFixed(2)}</Td>
                  <Td>{new Date(o.createdAt).toLocaleDateString("en-IE")}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-lg font-semibold">Activity</h2>
          <Timeline events={events} />
        </Card>
      </div>
    </>
  );
}
