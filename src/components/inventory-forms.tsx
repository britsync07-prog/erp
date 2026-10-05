"use client";

import type { ActionResult } from "@/server/platform";
import { Field, inputCls, ErrorText, SavedNote } from "./ui";
import { SubmitButton, useFormAction } from "./client";

type Act = (prev: ActionResult, fd: FormData) => Promise<ActionResult>;

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

interface ProductOpt {
  id: string;
  sku: string;
  name: string;
  salesUnit: string;
}
interface WarehouseOpt {
  id: string;
  name: string;
}

export function AdjustmentForm({ action, products, warehouses, defaultWarehouseId }: {
  action: Act;
  products: ProductOpt[];
  warehouses: WarehouseOpt[];
  defaultWarehouseId?: string;
}) {
  const { state, formAction, saved } = useFormAction(action);
  return (
    <FormShell formAction={formAction} state={state} saved={saved} submitLabel="Post adjustment">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Product">
          <select name="productId" required defaultValue="" className={inputCls}>
            <option value="" disabled>Select product…</option>
            {products.map((p) => (<option key={p.id} value={p.id}>{p.sku} — {p.name} ({p.salesUnit})</option>))}
          </select>
        </Field>
        <Field label="Warehouse">
          <select name="warehouseId" defaultValue={defaultWarehouseId ?? ""} className={inputCls}>
            <option value="">Default warehouse</option>
            {warehouses.map((w) => (<option key={w.id} value={w.id}>{w.name}</option>))}
          </select>
        </Field>
        <Field label="Quantity (+ in / − out, sales units)" hint="Over 50 units needs a second person's approval.">
          <input name="qty" required inputMode="decimal" placeholder="e.g. 10 or -4" className={inputCls} />
        </Field>
        <Field label="Reason (required)">
          <input name="reason" required maxLength={300} placeholder="e.g. Damaged carton found during picking" className={inputCls} />
        </Field>
      </div>
    </FormShell>
  );
}

export function TransferForm({ action, products, warehouses }: {
  action: Act;
  products: ProductOpt[];
  warehouses: WarehouseOpt[];
}) {
  const { state, formAction, saved } = useFormAction(action);
  return (
    <FormShell formAction={formAction} state={state} saved={saved} submitLabel="Transfer stock">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Product">
          <select name="productId" required defaultValue="" className={inputCls}>
            <option value="" disabled>Select product…</option>
            {products.map((p) => (<option key={p.id} value={p.id}>{p.sku} — {p.name}</option>))}
          </select>
        </Field>
        <Field label="Quantity (sales units)"><input name="qty" required inputMode="decimal" className={inputCls} /></Field>
        <Field label="From warehouse">
          <select name="fromWarehouseId" required defaultValue="" className={inputCls}>
            <option value="" disabled>Select source…</option>
            {warehouses.map((w) => (<option key={w.id} value={w.id}>{w.name}</option>))}
          </select>
        </Field>
        <Field label="To warehouse">
          <select name="toWarehouseId" required defaultValue="" className={inputCls}>
            <option value="" disabled>Select destination…</option>
            {warehouses.map((w) => (<option key={w.id} value={w.id}>{w.name}</option>))}
          </select>
        </Field>
      </div>
    </FormShell>
  );
}

export function CountCreateForm({ action, warehouses }: { action: Act; warehouses: WarehouseOpt[] }) {
  const { state, formAction, saved } = useFormAction(action);
  return (
    <FormShell formAction={formAction} state={state} saved={saved} submitLabel="Start count">
      <Field label="Warehouse to count">
        <select name="warehouseId" required defaultValue="" className={inputCls}>
          <option value="" disabled>Select warehouse…</option>
          {warehouses.map((w) => (<option key={w.id} value={w.id}>{w.name}</option>))}
        </select>
      </Field>
    </FormShell>
  );
}

export function CountEntryForm({ action, countId, lines }: {
  action: Act;
  countId: string;
  lines: { productId: string; sku: string; name: string; expectedQty: number; countedQty: number | null }[];
}) {
  const { state, formAction, saved } = useFormAction(action);
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="countId" value={countId} />
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Product</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Expected</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Counted (scan or type)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map((l) => (
              <tr key={l.productId}>
                <td className="px-4 py-2.5 font-medium">{l.sku} — {l.name}</td>
                <td className="px-4 py-2.5">{l.expectedQty}</td>
                <td className="px-4 py-2.5">
                  <input
                    name={`qty_${l.productId}`}
                    inputMode="decimal"
                    defaultValue={l.countedQty ?? ""}
                    placeholder="—"
                    className="w-32 rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ErrorText message={state.error} />
      <SavedNote show={saved} />
      <SubmitButton label="Save counted quantities" />
    </form>
  );
}

export function ApprovalRejectForm({ action, id }: { action: Act; id: string }) {
  const { state, formAction, saved } = useFormAction(action);
  return (
    <form action={formAction} className="mt-2 flex gap-2">
      <input type="hidden" name="id" value={id} />
      <input name="comment" required placeholder="Rejection reason…" className={`${inputCls} flex-1`} />
      <button type="submit" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 ring-1 ring-inset ring-red-200 hover:bg-red-100">
        Reject
      </button>
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
      {saved && <span className="text-xs text-emerald-700">Rejected.</span>}
    </form>
  );
}
