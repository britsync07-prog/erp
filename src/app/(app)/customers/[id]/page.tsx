import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, hasPermission } from "@/server/auth/permissions";
import { getCustomer } from "@/server/services/customers";
import { productOptions } from "@/server/services/catalog";
import { updateCustomerAction, addAddressAction, addContactAction, setCustomerPriceAction } from "@/server/actions/customers";
import { CustomerForm, AddressForm, ContactForm, CustomerPriceForm } from "@/components/entity-forms";
import { PageHeader, Card, Stat, Table, Td, StatusPill, EmptyState, Timeline } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("customers.view");
  const { id } = await params;
  const data = await getCustomer(session.orgId, id).catch(() => notFound());
  const { customer, events, balanceCents, recentOrders } = data;
  const canManage = hasPermission(session, "customers.manage");
  const canPrice = hasPermission(session, "pricing.manage");
  const products = canPrice ? await productOptions(session.orgId).catch(() => []) : [];

  return (
    <>
      <PageHeader
        title={customer.company}
        subtitle={`${customer.code} · Customer since ${customer.createdAt.toLocaleDateString("en-IE")}.`}
        actions={
          <Link href="/customers" className="text-sm font-medium text-indigo-700 hover:underline">
            ← Back to customers
          </Link>
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Stat label="Outstanding balance" value={`€${(balanceCents / 100).toFixed(2)}`} />
        <Stat label="Orders" value={customer._count.orders} />
        <Stat label="Invoices" value={customer._count.invoices} />
      </div>

      <div className="space-y-5">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Details</h2>
            <StatusPill value={customer.status} />
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-slate-500">Email</dt><dd>{customer.email ?? "—"}</dd></div>
            <div><dt className="text-slate-500">Phone</dt><dd>{customer.phone ?? "—"}</dd></div>
            <div><dt className="text-slate-500">VAT number</dt><dd>{customer.vatNumber ?? "—"}</dd></div>
            <div><dt className="text-slate-500">Fiscal code</dt><dd>{customer.fiscalCode ?? "—"}</dd></div>
            <div><dt className="text-slate-500">Payment terms</dt><dd>{customer.paymentTerms.replace(/_/g, " ")}</dd></div>
            <div><dt className="text-slate-500">Credit limit</dt><dd>€{(customer.creditLimitCents / 100).toFixed(2)}</dd></div>
            <div><dt className="text-slate-500">Price group</dt><dd>{customer.priceGroup ?? "—"}</dd></div>
            <div><dt className="text-slate-500">Notes</dt><dd>{customer.notes ?? "—"}</dd></div>
          </dl>
        </Card>

        {canManage && (
          <Card>
            <h2 className="mb-3 text-lg font-semibold">Edit customer</h2>
            <CustomerForm
              action={updateCustomerAction}
              initial={{
                id: customer.id,
                code: customer.code,
                company: customer.company,
                email: customer.email,
                vatNumber: customer.vatNumber,
                fiscalCode: customer.fiscalCode,
                phone: customer.phone,
                paymentTerms: customer.paymentTerms,
                creditLimitCents: customer.creditLimitCents,
                priceGroup: customer.priceGroup,
                notes: customer.notes,
              }}
              submitLabel="Save changes"
            />
          </Card>
        )}

        <Card>
          <h2 className="mb-3 text-lg font-semibold">Addresses</h2>
          {customer.addresses.length === 0 ? (
            <EmptyState title="No addresses yet." hint="Add a billing or delivery address below." />
          ) : (
            <Table headers={["Type", "Label", "Street", "City", "Country", "Default"]}>
              {customer.addresses.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50">
                  <Td>{a.kind}</Td>
                  <Td>{a.label ?? "—"}</Td>
                  <Td>{a.street}</Td>
                  <Td>{a.city}{a.postal ? ` ${a.postal}` : ""}</Td>
                  <Td>{a.country}</Td>
                  <Td>{a.isDefault ? "Yes" : "—"}</Td>
                </tr>
              ))}
            </Table>
          )}
          {canManage && (
            <div className="mt-4">
              <AddressForm action={addAddressAction} ownerIdField="customerId" ownerId={id} />
            </div>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-lg font-semibold">Contacts</h2>
          {customer.contacts.length === 0 ? (
            <EmptyState title="No contacts yet." hint="Add the people you deal with at this customer." />
          ) : (
            <Table headers={["Name", "Role", "Phone", "Email"]}>
              {customer.contacts.map((c) => (
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
              <ContactForm action={addContactAction} ownerIdField="customerId" ownerId={id} />
            </div>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-lg font-semibold">Custom prices</h2>
          {customer.prices.length === 0 ? (
            <EmptyState title="No custom prices." hint="Set a customer-specific price for a product below." />
          ) : (
            <Table headers={["Product", "Price", "Min. qty", "Valid until"]}>
              {customer.prices.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <Td><span className="font-mono text-xs">{p.product.sku}</span> — {p.product.name}</Td>
                  <Td>€{(p.priceCents / 100).toFixed(2)}</Td>
                  <Td>{p.minQty}</Td>
                  <Td>{p.validTo ? new Date(p.validTo).toLocaleDateString("en-IE") : "—"}</Td>
                </tr>
              ))}
            </Table>
          )}
          {canPrice && (
            <div className="mt-4">
              <CustomerPriceForm action={setCustomerPriceAction} customerId={id} products={products} />
            </div>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-lg font-semibold">Recent orders</h2>
          {recentOrders.length === 0 ? (
            <EmptyState title="No orders yet." />
          ) : (
            <Table headers={["Order", "Status", "Total", "Placed"]}>
              {recentOrders.map((o) => (
                <tr key={o.id} className="hover:bg-slate-50">
                  <Td className="font-mono text-xs">{o.number}</Td>
                  <Td><StatusPill value={o.status} /></Td>
                  <Td>€{(o.totalCents / 100).toFixed(2)}</Td>
                  <Td>{new Date(o.orderDate).toLocaleDateString("en-IE")}</Td>
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
