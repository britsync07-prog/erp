import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, hasPermission } from "@/server/auth/permissions";
import { getProduct, listCategories } from "@/server/services/catalog";
import { supplierOptions } from "@/server/services/suppliers";
import {
  PageHeader, Card, Stat, Table, Td, StatusPill, Timeline,
} from "@/components/ui";
import { ConfirmAction } from "@/components/client";
import {
  ProductForm, PriceRuleForm, SupplierLinkForm,
} from "@/components/entity-forms";
import {
  updateProductAction, discontinueProductAction, deleteProductAction,
  addPriceRuleAction, linkSupplierAction,
} from "@/server/actions/catalog";
import { formatCents } from "@/domain/units";

export const dynamic = "force-dynamic";

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("products.view");
  const { id } = await params;
  const data = await getProduct(session.orgId, id).catch(() => null);
  if (!data) notFound();
  const { product, stock, perWarehouse, events } = data;
  const canManage = hasPermission(session, "products.manage");
  const canPrice = hasPermission(session, "pricing.manage");
  const discontinued = product.status === "DISCONTINUED";

  const [categories, suppliers] = canManage
    ? await Promise.all([listCategories(session.orgId), supplierOptions(session.orgId)])
    : [[], []];

  return (
    <>
      <PageHeader
        title={product.name}
        subtitle={`${product.sku} · 1 ${product.salesUnit} = ${(1 / product.conversionFactor).toFixed(4)} ${product.purchaseUnit} · conversion ×${product.conversionFactor}`}
        actions={
          <Link href="/products" className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200">
            ← Back to products
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusPill value={product.status} />
        {product.category && <StatusPill value={product.category.name} />}
        {canManage && (
          <>
            <ConfirmAction
              action={discontinueProductAction} args={[product.id, !discontinued]}
              confirmText={discontinued ? `Reactivate product "${product.name}"?` : `Discontinue product "${product.name}"?`}
            >
              {discontinued ? "Reactivate" : "Discontinue"}
            </ConfirmAction>
            <ConfirmAction action={deleteProductAction} args={[product.id]} confirmText={`Delete product "${product.name}"? Only possible with no transactional history.`} danger>
              Delete
            </ConfirmAction>
          </>
        )}
      </div>

      <div className="mb-4 grid gap-4 sm:grid-cols-4">
        <Stat label="Available" value={stock.available} />
        <Stat label="Physical" value={stock.physical} />
        <Stat label="Reserved" value={stock.reserved} />
        <Stat label="Projected" value={stock.projected} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">Product info</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-slate-500">SKU</dt><dd className="font-mono text-xs">{product.sku}</dd>
            <dt className="text-slate-500">Barcode</dt><dd>{product.barcode ?? "—"}</dd>
            <dt className="text-slate-500">Category</dt><dd>{product.category?.name ?? "—"}</dd>
            <dt className="text-slate-500">Sales / purchase unit</dt><dd>{product.salesUnit} / {product.purchaseUnit} (×{product.conversionFactor})</dd>
            <dt className="text-slate-500">Cost</dt><dd>{formatCents(product.costCents)}</dd>
            <dt className="text-slate-500">Standard price</dt><dd>{formatCents(product.standardPriceCents)}</dd>
            <dt className="text-slate-500">VAT</dt><dd>{product.vatRate}%</dd>
            <dt className="text-slate-500">Lead time</dt><dd>{product.leadTimeDays}d</dd>
            <dt className="text-slate-500">Min stock</dt><dd>{product.minStock}</dd>
            <dt className="text-slate-500">Reorder point</dt><dd>{product.reorderPoint}</dd>
            <dt className="text-slate-500">Safety stock</dt><dd>{product.safetyStock}</dd>
          </dl>
          {product.description && <p className="mt-3 text-sm text-slate-600">{product.description}</p>}
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">Stock per warehouse</h2>
          {perWarehouse.length === 0 ? (
            <p className="text-sm text-slate-500">No stock yet. Opening stock posts to the default warehouse at creation.</p>
          ) : (
            <Table headers={["Warehouse", "Physical", "Reserved", "Available"]}>
              {perWarehouse.map((r) => (
                <tr key={r.warehouse.id}>
                  <Td><Link href={`/warehouses/${r.warehouse.id}`} className="font-medium text-indigo-700 hover:underline">{r.warehouse.name}</Link></Td>
                  <Td>{r.physical}</Td>
                  <Td>{r.reserved}</Td>
                  <Td>{r.available}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">Supplier links ({product.supplierLinks.length})</h2>
          {product.supplierLinks.length === 0 ? (
            <p className="mb-3 text-sm text-slate-500">No suppliers linked yet.</p>
          ) : (
            <Table headers={["Supplier", "Cost", "Preferred"]}>
              {product.supplierLinks.map((l) => (
                <tr key={`${l.productId}-${l.supplierId}`}>
                  <Td className="font-medium">{l.supplier.company}</Td>
                  <Td>{formatCents(l.costCents)}</Td>
                  <Td>{l.isPreferred ? <StatusPill value="READY" /> : <span className="text-slate-400">—</span>}</Td>
                </tr>
              ))}
            </Table>
          )}
          {canManage && (
            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold">Link a supplier</h3>
              <SupplierLinkForm action={linkSupplierAction} productId={product.id} suppliers={suppliers} />
            </div>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">Price history ({product.prices.length})</h2>
          {product.prices.length === 0 ? (
            <p className="mb-3 text-sm text-slate-500">No price entries yet.</p>
          ) : (
            <Table headers={["Type", "Group", "Price", "Min qty", "Valid to"]}>
              {product.prices.map((r) => (
                <tr key={r.id}>
                  <Td><StatusPill value={r.kind} /></Td>
                  <Td>{r.priceGroup ?? "—"}</Td>
                  <Td>{formatCents(r.priceCents)}</Td>
                  <Td>{r.minQty}</Td>
                  <Td>{r.validTo ? r.validTo.toLocaleDateString("en-IE") : "—"}</Td>
                </tr>
              ))}
            </Table>
          )}
          {canPrice && (
            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold">Add price rule</h3>
              <PriceRuleForm action={addPriceRuleAction} productId={product.id} />
            </div>
          )}
        </Card>

        {product.customerPrices.length > 0 && (
          <Card>
            <h2 className="mb-3 font-semibold">Customer-specific prices ({product.customerPrices.length})</h2>
            <Table headers={["Customer", "Price", "Min qty", "Valid to"]}>
              {product.customerPrices.map((p) => (
                <tr key={p.id}>
                  <Td className="font-medium">{p.customer.company}</Td>
                  <Td>{formatCents(p.priceCents)}</Td>
                  <Td>{p.minQty}</Td>
                  <Td>{p.validTo ? p.validTo.toLocaleDateString("en-IE") : "—"}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        )}

        <Card>
          <h2 className="mb-3 font-semibold">Recent movements ({product.movements.length})</h2>
          {product.movements.length === 0 ? (
            <p className="text-sm text-slate-500">No movements yet.</p>
          ) : (
            <Table headers={["Type", "Qty", "Warehouse", "Reference"]}>
              {product.movements.map((m) => (
                <tr key={m.id}>
                  <Td className="font-mono text-xs">{m.type}</Td>
                  <Td>{m.quantity}</Td>
                  <Td>{m.warehouse.name}</Td>
                  <Td className="text-slate-500">{m.reference ?? "—"}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">Activity</h2>
          <Timeline events={events} />
        </Card>

        {canManage && (
          <Card>
            <h2 className="mb-3 font-semibold">Edit product</h2>
            <ProductForm
              action={updateProductAction}
              initial={{
                id: product.id,
                sku: product.sku,
                barcode: product.barcode,
                name: product.name,
                description: product.description,
                categoryId: product.categoryId,
                salesUnit: product.salesUnit,
                purchaseUnit: product.purchaseUnit,
                conversionFactor: product.conversionFactor,
                costCents: product.costCents,
                standardPriceCents: product.standardPriceCents,
                vatRate: product.vatRate,
                minStock: product.minStock,
                reorderPoint: product.reorderPoint,
                safetyStock: product.safetyStock,
                leadTimeDays: product.leadTimeDays,
              }}
              categories={categories}
              suppliers={suppliers}
              submitLabel="Save changes"
              isNew={false}
            />
          </Card>
        )}
      </div>
    </>
  );
}
