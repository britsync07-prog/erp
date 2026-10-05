"use client";

import { useState } from "react";
import type { ActionResult } from "@/server/platform";
import { Field, inputCls, ErrorText, SavedNote } from "./ui";
import { SubmitButton, useFormAction } from "./client";
import { formatCents } from "@/domain/units";

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

export function POHeaderForm({ action, suppliers, warehouses, initial, submitLabel }: {
  action: Act;
  suppliers: { id: string; company: string; code: string }[];
  warehouses: { id: string; name: string }[];
  initial?: Record<string, string | null>;
  submitLabel: string;
}) {
  const { state, formAction, saved } = useFormAction(action);
  const v = (k: string) => initial?.[k] ?? "";
  return (
    <FormShell formAction={formAction} state={state} saved={saved} submitLabel={submitLabel}>
      {initial?.id && <input type="hidden" name="id" value={initial.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Supplier">
          <select name="supplierId" required defaultValue={v("supplierId")} className={inputCls} disabled={!!initial?.id}>
            <option value="" disabled>Select supplier…</option>
            {suppliers.map((s) => (<option key={s.id} value={s.id}>{s.code} — {s.company}</option>))}
          </select>
        </Field>
        <Field label="Warehouse">
          <select name="warehouseId" defaultValue={v("warehouseId")} className={inputCls}>
            <option value="">Default warehouse</option>
            {warehouses.map((w) => (<option key={w.id} value={w.id}>{w.name}</option>))}
          </select>
        </Field>
        <Field label="Expected date"><input name="expectedDate" type="date" defaultValue={v("expectedDate")} className={inputCls} /></Field>
        <Field label="Notes"><input name="notes" defaultValue={v("notes")} maxLength={2000} className={inputCls} /></Field>
      </div>
      {initial?.id && <p className="text-xs text-slate-400">Supplier is fixed after creation — cancel and recreate to change it.</p>}
    </FormShell>
  );
}

interface POLineRow {
  productId: string;
  quantity: string;
  unitCost: string; // € per sales unit, empty = supplier default
}

export function POLinesEditor({ action, poId, products, initialLines }: {
  action: Act;
  poId: string;
  products: { id: string; sku: string; name: string; purchaseUnit: string; conversionFactor: number; defaultCostCents: number }[];
  initialLines: { productId: string; quantity: number; unitCostCents: number }[];
}) {
  const { state, formAction, saved } = useFormAction(action);
  const [rows, setRows] = useState<POLineRow[]>(
    initialLines.length > 0
      ? initialLines.map((l) => ({ productId: l.productId, quantity: String(l.quantity), unitCost: String(l.unitCostCents / 100) }))
      : [{ productId: "", quantity: "1", unitCost: "" }],
  );
  const set = (i: number, patch: Partial<POLineRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const pickCost = (row: POLineRow): number => {
    if (row.unitCost.trim() !== "" && Number.isFinite(Number(row.unitCost))) return Math.round(Number(row.unitCost) * 100);
    return products.find((p) => p.id === row.productId)?.defaultCostCents ?? 0;
  };

  const estimate = rows.reduce((sum, r) => {
    const p = products.find((x) => x.id === r.productId);
    const qty = Number(r.quantity) || 0;
    if (!p || qty <= 0) return sum;
    return sum + Math.round(qty * p.conversionFactor * pickCost(r));
  }, 0);

  return (
    <form
      action={(fd) => {
        fd.set("id", poId);
        fd.set("linesJson", JSON.stringify(
          rows
            .filter((r) => r.productId && Number(r.quantity) > 0)
            .map((r) => {
              const out: Record<string, unknown> = { productId: r.productId, quantity: Number(r.quantity) };
              if (r.unitCost.trim() !== "") out.unitCostCents = Math.round(Number(r.unitCost) * 100);
              return out;
            }),
        ));
        formAction(fd);
      }}
      className="space-y-3"
    >
      {rows.map((r, i) => {
        const p = products.find((x) => x.id === r.productId);
        return (
          <div key={i} className="grid items-end gap-2 sm:grid-cols-[1fr_120px_140px_auto]">
            <Field label={i === 0 ? "Product" : ""}>
              <select value={r.productId} onChange={(e) => set(i, { productId: e.target.value })} className={inputCls} required>
                <option value="" disabled>Select…</option>
                {products.map((x) => (<option key={x.id} value={x.id}>{x.sku} — {x.name} ({x.purchaseUnit})</option>))}
              </select>
            </Field>
            <Field label={i === 0 ? `Qty (${p?.purchaseUnit ?? "unit"})` : ""}>
              <input value={r.quantity} onChange={(e) => set(i, { quantity: e.target.value })} inputMode="decimal" required className={inputCls} />
            </Field>
            <Field label={i === 0 ? "Cost €/sales-u. (blank=default)" : ""}>
              <input value={r.unitCost} onChange={(e) => set(i, { unitCost: e.target.value })} inputMode="decimal" placeholder={p ? (p.defaultCostCents / 100).toFixed(2) : ""} className={inputCls} />
            </Field>
            <button
              type="button"
              onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
              disabled={rows.length <= 1}
              className="rounded-lg px-2 py-2 text-sm text-slate-400 hover:bg-slate-100 disabled:opacity-30"
              title="Remove line"
            >
              ✕
            </button>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setRows((rs) => [...rs, { productId: "", quantity: "1", unitCost: "" }])}
          className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium hover:bg-slate-200"
        >
          + Add line
        </button>
        <p className="text-sm text-slate-500">Estimate: <span className="font-semibold text-slate-800">{formatCents(estimate)}</span></p>
      </div>
      <ErrorText message={state.error} />
      <SavedNote show={saved} />
      <SubmitButton label="Save lines" />
    </form>
  );
}

export function RequirementsConvertForm({ action, requirements }: {
  action: Act;
  requirements: { id: string; productSku: string; requiredQty: number; salesUnit: string }[];
}) {
  const { state, formAction, saved } = useFormAction(action);
  const [selected, setSelected] = useState<string[]>(requirements.map((r) => r.id));
  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  if (requirements.length === 0) return null;
  return (
    <form action={formAction} className="space-y-3">
      {requirements.map((r) => (
        <label key={r.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 hover:border-indigo-300">
          <input
            type="checkbox"
            name="ids"
            value={r.id}
            checked={selected.includes(r.id)}
            onChange={() => toggle(r.id)}
            className="h-4 w-4"
          />
          <span className="text-sm font-medium">{r.productSku}</span>
          <span className="text-sm text-slate-500">× {r.requiredQty} {r.salesUnit}</span>
        </label>
      ))}
      <div className="flex items-center gap-3">
        <SubmitButton label={selected.length === 0 ? "Select requirements" : `Create purchase order${selected.length > 1 ? "s" : ""} (${selected.length})`} />
        {saved && <span className="text-sm text-emerald-700">Created.</span>}
      </div>
      <ErrorText message={state.error} />
      <p className="text-xs text-slate-400">Grouped automatically by preferred supplier. Requirements flip to ORDERED.</p>
    </form>
  );
}
