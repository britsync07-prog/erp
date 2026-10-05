"use client";

import type { ActionResult } from "@/server/platform";
import { Field, inputCls, ErrorText, SavedNote } from "./ui";
import { SubmitButton, useFormAction } from "./client";

type Act = (prev: ActionResult, fd: FormData) => Promise<ActionResult>;

/** Convert euro text inputs to integer-cents fields before the server action runs. */
function mapEuros(formAction: (fd: FormData) => void, mapping: Record<string, string>) {
  return (fd: FormData) => {
    for (const [from, to] of Object.entries(mapping)) {
      const raw = String(fd.get(from) ?? "").replace(/\s/g, "").replace(",", ".");
      const num = Number(raw);
      fd.set(to, raw === "" || !Number.isFinite(num) ? "0" : String(Math.round(num * 100)));
    }
    formAction(fd);
  };
}

function euros(cents: number | null | undefined): string {
  return cents == null ? "" : String(cents / 100);
}

function FormShell({ formAction, state, saved, children, submitLabel }: {
  formAction: (fd: FormData) => void;
  state: ActionResult;
  saved: boolean;
  children: React.ReactNode;
  submitLabel: string;
}) {
  return (
    <form action={formAction} className="space-y-4">
      {children}
      <ErrorText message={state.error} />
      <SavedNote show={saved} />
      <SubmitButton label={submitLabel} />
    </form>
  );
}

const grid2 = "grid gap-4 sm:grid-cols-2";
const grid3 = "grid gap-4 sm:grid-cols-3";

// ─── Customers ──────────────────────────────────────────────────────────────

export function CustomerForm({ action, initial, submitLabel }: {
  action: Act;
  initial?: Record<string, string | number | null>;
  submitLabel: string;
}) {
  const { state, formAction, saved } = useFormAction(action);
  const v = (k: string) => (initial?.[k] ?? "") as string;
  return (
    <FormShell formAction={mapEuros(formAction, { creditLimit: "creditLimitCents" })} state={state} saved={saved} submitLabel={submitLabel}>
      <div className={grid3}>
        <Field label="Code"><input name="code" defaultValue={v("code")} required maxLength={32} className={inputCls} /></Field>
        <Field label="Company"><input name="company" defaultValue={v("company")} required maxLength={160} className={inputCls} /></Field>
        <Field label="Email"><input name="email" type="email" defaultValue={v("email")} className={inputCls} /></Field>
      </div>
      <div className={grid3}>
        <Field label="VAT number"><input name="vatNumber" defaultValue={v("vatNumber")} className={inputCls} /></Field>
        <Field label="Fiscal code"><input name="fiscalCode" defaultValue={v("fiscalCode")} className={inputCls} /></Field>
        <Field label="Phone"><input name="phone" defaultValue={v("phone")} className={inputCls} /></Field>
      </div>
      <div className={grid3}>
        <Field label="Payment terms">
          <select name="paymentTerms" defaultValue={v("paymentTerms") || "30_DAYS"} className={inputCls}>
            <option value="IMMEDIATE">Immediate</option>
            <option value="30_DAYS">30 days</option>
            <option value="60_DAYS">60 days</option>
            <option value="90_DAYS">90 days</option>
            <option value="CUSTOM">Custom</option>
          </select>
        </Field>
        <Field label="Credit limit (€)"><input name="creditLimit" inputMode="decimal" defaultValue={euros(initial?.creditLimitCents as number)} className={inputCls} /></Field>
        <Field label="Price group" hint="Optional: links to group pricing rules."><input name="priceGroup" defaultValue={v("priceGroup")} className={inputCls} /></Field>
      </div>
      <Field label="Notes"><textarea name="notes" defaultValue={v("notes")} rows={3} className={inputCls} /></Field>
      {initial?.id && <input type="hidden" name="id" value={String(initial.id)} />}
    </FormShell>
  );
}

export function AddressForm({ action, ownerIdField, ownerId }: { action: Act; ownerIdField: string; ownerId: string }) {
  const { state, formAction, saved } = useFormAction(action);
  return (
    <FormShell formAction={formAction} state={state} saved={saved} submitLabel="Add address">
      <input type="hidden" name={ownerIdField} value={ownerId} />
      <div className={grid3}>
        <Field label="Type">
          <select name="kind" className={inputCls} defaultValue="DELIVERY">
            <option value="DELIVERY">Delivery</option>
            <option value="BILLING">Billing</option>
          </select>
        </Field>
        <Field label="Label"><input name="label" placeholder="e.g. Main warehouse" className={inputCls} /></Field>
        <Field label="Default"><input name="isDefault" type="checkbox" className="h-4 w-4" /></Field>
      </div>
      <div className={grid2}>
        <Field label="Street"><input name="street" required className={inputCls} /></Field>
        <Field label="City"><input name="city" required className={inputCls} /></Field>
      </div>
      <div className={grid3}>
        <Field label="Postal code"><input name="postal" className={inputCls} /></Field>
        <Field label="Province"><input name="province" maxLength={10} className={inputCls} /></Field>
        <Field label="Country"><input name="country" defaultValue="IT" maxLength={2} className={inputCls} /></Field>
      </div>
    </FormShell>
  );
}

export function ContactForm({ action, ownerIdField, ownerId }: { action: Act; ownerIdField: string; ownerId: string }) {
  const { state, formAction, saved } = useFormAction(action);
  return (
    <FormShell formAction={formAction} state={state} saved={saved} submitLabel="Add contact">
      <input type="hidden" name={ownerIdField} value={ownerId} />
      <div className={grid2}>
        <Field label="Name"><input name="name" required className={inputCls} /></Field>
        <Field label="Role"><input name="role" className={inputCls} /></Field>
        <Field label="Phone"><input name="phone" className={inputCls} /></Field>
        <Field label="Email"><input name="email" type="email" className={inputCls} /></Field>
      </div>
    </FormShell>
  );
}

export function CustomerPriceForm({ action, customerId, products }: {
  action: Act;
  customerId: string;
  products: { id: string; sku: string; name: string }[];
}) {
  const { state, formAction, saved } = useFormAction(action);
  return (
    <FormShell formAction={mapEuros(formAction, { price: "priceCents" })} state={state} saved={saved} submitLabel="Set custom price">
      <input type="hidden" name="customerId" value={customerId} />
      <div className={grid3}>
        <Field label="Product">
          <select name="productId" required className={inputCls} defaultValue="">
            <option value="" disabled>Select product…</option>
            {products.map((p) => (<option key={p.id} value={p.id}>{p.sku} — {p.name}</option>))}
          </select>
        </Field>
        <Field label="Price (€ per sales unit)"><input name="price" required inputMode="decimal" className={inputCls} /></Field>
        <Field label="Min. qty"><input name="minQty" inputMode="decimal" defaultValue="1" className={inputCls} /></Field>
      </div>
      <Field label="Valid until (optional)"><input name="validTo" type="date" className={inputCls} /></Field>
    </FormShell>
  );
}

// ─── Suppliers ──────────────────────────────────────────────────────────────

export function SupplierForm({ action, initial, submitLabel }: {
  action: Act;
  initial?: Record<string, string | number | null>;
  submitLabel: string;
}) {
  const { state, formAction, saved } = useFormAction(action);
  const v = (k: string) => (initial?.[k] ?? "") as string;
  return (
    <FormShell formAction={formAction} state={state} saved={saved} submitLabel={submitLabel}>
      <div className={grid3}>
        <Field label="Code"><input name="code" defaultValue={v("code")} required maxLength={32} className={inputCls} /></Field>
        <Field label="Company"><input name="company" defaultValue={v("company")} required maxLength={160} className={inputCls} /></Field>
        <Field label="Email"><input name="email" type="email" defaultValue={v("email")} className={inputCls} /></Field>
      </div>
      <div className={grid3}>
        <Field label="VAT number"><input name="vatNumber" defaultValue={v("vatNumber")} className={inputCls} /></Field>
        <Field label="Phone"><input name="phone" defaultValue={v("phone")} className={inputCls} /></Field>
        <Field label="Lead time (days)"><input name="leadTimeDays" inputMode="numeric" defaultValue={v("leadTimeDays") || "7"} className={inputCls} /></Field>
      </div>
      <Field label="Payment terms">
        <select name="paymentTerms" defaultValue={v("paymentTerms") || "30_DAYS"} className={inputCls}>
          <option value="IMMEDIATE">Immediate</option>
          <option value="30_DAYS">30 days</option>
          <option value="60_DAYS">60 days</option>
          <option value="90_DAYS">90 days</option>
          <option value="CUSTOM">Custom</option>
        </select>
      </Field>
      <Field label="Notes"><textarea name="notes" defaultValue={v("notes")} rows={3} className={inputCls} /></Field>
      {initial?.id && <input type="hidden" name="id" value={String(initial.id)} />}
    </FormShell>
  );
}

// ─── Products / pricing ─────────────────────────────────────────────────────

export function ProductForm({ action, initial, categories, suppliers, submitLabel, isNew }: {
  action: Act;
  initial?: Record<string, string | number | null>;
  categories: { id: string; name: string }[];
  suppliers: { id: string; company: string }[];
  submitLabel: string;
  isNew: boolean;
}) {
  const { state, formAction, saved } = useFormAction(action);
  const v = (k: string) => (initial?.[k] ?? "") as string;
  return (
    <FormShell formAction={mapEuros(formAction, { cost: "costCents", standardPrice: "standardPriceCents" })} state={state} saved={saved} submitLabel={submitLabel}>
      <div className={grid3}>
        <Field label="SKU"><input name="sku" defaultValue={v("sku")} required className={inputCls} /></Field>
        <Field label="Barcode (scan or type)" hint="Works with phone camera scan or USB scanner wedge."><input name="barcode" defaultValue={v("barcode")} className={inputCls} /></Field>
        <Field label="Name"><input name="name" defaultValue={v("name")} required className={inputCls} /></Field>
      </div>
      <Field label="Description"><textarea name="description" defaultValue={v("description")} rows={2} className={inputCls} /></Field>
      <div className={grid3}>
        <Field label="Category">
          <select name="categoryId" defaultValue={v("categoryId")} className={inputCls}>
            <option value="">No category</option>
            {categories.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </select>
        </Field>
        <Field label="Sales unit"><input name="salesUnit" defaultValue={v("salesUnit") || "PCS"} required className={inputCls} /></Field>
        <Field label="Purchase unit"><input name="purchaseUnit" defaultValue={v("purchaseUnit") || "CTN"} required className={inputCls} /></Field>
      </div>
      <div className={grid3}>
        <Field label="Conversion (sales units per purchase unit)"><input name="conversionFactor" inputMode="decimal" defaultValue={v("conversionFactor") || "1"} className={inputCls} /></Field>
        <Field label="Cost (€ per sales unit)"><input name="cost" inputMode="decimal" defaultValue={euros(initial?.costCents as number)} className={inputCls} /></Field>
        <Field label="Standard price (€)"><input name="standardPrice" inputMode="decimal" defaultValue={euros(initial?.standardPriceCents as number)} className={inputCls} /></Field>
      </div>
      <div className={grid3}>
        <Field label="VAT %"><input name="vatRate" inputMode="decimal" defaultValue={v("vatRate") || "22"} className={inputCls} /></Field>
        <Field label="Lead time (days)"><input name="leadTimeDays" inputMode="numeric" defaultValue={v("leadTimeDays") || "7"} className={inputCls} /></Field>
        <Field label="Min. stock"><input name="minStock" inputMode="decimal" defaultValue={v("minStock") || "0"} className={inputCls} /></Field>
      </div>
      <div className={grid2}>
        <Field label="Reorder point"><input name="reorderPoint" inputMode="decimal" defaultValue={v("reorderPoint") || "0"} className={inputCls} /></Field>
        <Field label="Safety stock"><input name="safetyStock" inputMode="decimal" defaultValue={v("safetyStock") || "0"} className={inputCls} /></Field>
      </div>
      {isNew && (
        <div className={grid2}>
          <Field label="Preferred supplier (optional)">
            <select name="supplierId" defaultValue="" className={inputCls}>
              <option value="">No supplier yet</option>
              {suppliers.map((s) => (<option key={s.id} value={s.id}>{s.company}</option>))}
            </select>
          </Field>
          <Field label="Opening stock (sales units)" hint="Posted to the default warehouse as opening balance."><input name="openingStock" inputMode="decimal" defaultValue="0" className={inputCls} /></Field>
        </div>
      )}
      {initial?.id && <input type="hidden" name="id" value={String(initial.id)} />}
    </FormShell>
  );
}

export function CategoryForm({ action }: { action: Act }) {
  const { state, formAction, saved } = useFormAction(action);
  return (
    <FormShell formAction={formAction} state={state} saved={saved} submitLabel="Add category">
      <Field label="Category name"><input name="name" required maxLength={120} className={inputCls} /></Field>
    </FormShell>
  );
}

export function PriceRuleForm({ action, productId }: { action: Act; productId: string }) {
  const { state, formAction, saved } = useFormAction(action);
  return (
    <FormShell formAction={mapEuros(formAction, { price: "priceCents" })} state={state} saved={saved} submitLabel="Add price rule">
      <input type="hidden" name="productId" value={productId} />
      <div className={grid3}>
        <Field label="Rule type">
          <select name="kind" className={inputCls} defaultValue="GROUP">
            <option value="GROUP">Customer group</option>
            <option value="PROMO">Promotional</option>
            <option value="CONTRACT">Contract</option>
          </select>
        </Field>
        <Field label="Price group (for group rules)"><input name="priceGroup" className={inputCls} /></Field>
        <Field label="Price (€)"><input name="price" required inputMode="decimal" className={inputCls} /></Field>
      </div>
      <div className={grid2}>
        <Field label="Min. qty"><input name="minQty" inputMode="decimal" defaultValue="1" className={inputCls} /></Field>
        <Field label="Valid until (optional)"><input name="validTo" type="date" className={inputCls} /></Field>
      </div>
    </FormShell>
  );
}

export function SupplierLinkForm({ action, productId, suppliers }: {
  action: Act;
  productId: string;
  suppliers: { id: string; company: string }[];
}) {
  const { state, formAction, saved } = useFormAction(action);
  return (
    <FormShell formAction={mapEuros(formAction, { cost: "costCents" })} state={state} saved={saved} submitLabel="Link supplier">
      <input type="hidden" name="productId" value={productId} />
      <div className={grid3}>
        <Field label="Supplier">
          <select name="supplierId" required defaultValue="" className={inputCls}>
            <option value="" disabled>Select supplier…</option>
            {suppliers.map((s) => (<option key={s.id} value={s.id}>{s.company}</option>))}
          </select>
        </Field>
        <Field label="Cost (€ per sales unit)"><input name="cost" required inputMode="decimal" className={inputCls} /></Field>
        <Field label="Preferred"><input name="preferred" type="checkbox" className="h-4 w-4" /></Field>
      </div>
    </FormShell>
  );
}

// ─── Warehouses ─────────────────────────────────────────────────────────────

export function WarehouseForm({ action }: { action: Act }) {
  const { state, formAction, saved } = useFormAction(action);
  return (
    <FormShell formAction={formAction} state={state} saved={saved} submitLabel="Create warehouse">
      <div className={grid2}>
        <Field label="Code"><input name="code" required maxLength={16} placeholder="MI-02" className={inputCls} /></Field>
        <Field label="Name"><input name="name" required maxLength={120} className={inputCls} /></Field>
      </div>
      <Field label="Address"><input name="address" maxLength={240} className={inputCls} /></Field>
    </FormShell>
  );
}

export function LocationForm({ action, warehouseId }: { action: Act; warehouseId: string }) {
  const { state, formAction, saved } = useFormAction(action);
  return (
    <FormShell formAction={formAction} state={state} saved={saved} submitLabel="Add location">
      <input type="hidden" name="warehouseId" value={warehouseId} />
      <div className={grid2}>
        <Field label="Location code"><input name="code" required placeholder="A-01-02" className={inputCls} /></Field>
        <Field label="Zone"><input name="zone" className={inputCls} /></Field>
      </div>
    </FormShell>
  );
}

// ─── Users & roles ──────────────────────────────────────────────────────────

export function UserForm({ action, roles }: { action: Act; roles: { id: string; name: string }[] }) {
  const { state, formAction, saved } = useFormAction(action);
  return (
    <FormShell formAction={formAction} state={state} saved={saved} submitLabel="Create user">
      <div className={grid2}>
        <Field label="Name"><input name="name" required className={inputCls} /></Field>
        <Field label="Email"><input name="email" type="email" required className={inputCls} /></Field>
        <Field label="Password (min 8 chars)"><input name="password" type="password" required minLength={8} className={inputCls} /></Field>
        <Field label="Role">
          <select name="roleId" required defaultValue="" className={inputCls}>
            <option value="" disabled>Select role…</option>
            {roles.map((r) => (<option key={r.id} value={r.id}>{r.name}</option>))}
          </select>
        </Field>
      </div>
    </FormShell>
  );
}

export function RoleForm({ action }: { action: Act }) {
  const { state, formAction, saved } = useFormAction(action);
  return (
    <FormShell formAction={formAction} state={state} saved={saved} submitLabel="Create role">
      <div className={grid2}>
        <Field label="Code"><input name="code" required placeholder="STORE_MANAGER" className={inputCls} /></Field>
        <Field label="Name"><input name="name" required className={inputCls} /></Field>
      </div>
      <p className="text-xs text-slate-400">Permissions can be edited after creation.</p>
    </FormShell>
  );
}
