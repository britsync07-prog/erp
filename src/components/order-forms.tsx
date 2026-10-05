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

export function DraftForm({ action, customers, initial, submitLabel, lockCustomer }: {
  action: Act;
  customers: { id: string; company: string; code: string }[];
  initial?: Record<string, string | null>;
  submitLabel: string;
  lockCustomer?: boolean;
}) {
  const { state, formAction, saved } = useFormAction(action);
  const v = (k: string) => initial?.[k] ?? "";
  const today = new Date().toISOString().slice(0, 10);
  return (
    <FormShell formAction={formAction} state={state} saved={saved} submitLabel={submitLabel}>
      {initial?.id && <input type="hidden" name="id" value={initial.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Customer">
          {lockCustomer ? (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm font-medium">{v("customerName")}</p>
          ) : (
            <select name="customerId" required defaultValue="" className={inputCls}>
              <option value="" disabled>Select customer…</option>
              {customers.map((c) => (<option key={c.id} value={c.id}>{c.code} — {c.company}</option>))}
            </select>
          )}
        </Field>
        <Field label="Payment terms">
          <select name="paymentTerms" defaultValue={v("paymentTerms") || ""} className={inputCls}>
            <option value="">Customer default</option>
            <option value="IMMEDIATE">Immediate</option>
            <option value="30_DAYS">30 days</option>
            <option value="60_DAYS">60 days</option>
            <option value="90_DAYS">90 days</option>
            <option value="CUSTOM">Custom</option>
          </select>
        </Field>
        <Field label="Order date"><input name="orderDate" type="date" defaultValue={v("orderDate") || today} className={inputCls} /></Field>
        <Field label="Requested delivery date"><input name="requestedDate" type="date" defaultValue={v("requestedDate")} className={inputCls} /></Field>
      </div>
      <Field label="Delivery address" hint="Prefilled from the customer's default delivery address."><input name="deliveryAddress" defaultValue={v("deliveryAddress")} className={inputCls} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Internal notes"><textarea name="internalNotes" defaultValue={v("internalNotes")} rows={2} className={inputCls} /></Field>
        <Field label="Customer notes (printed on documents)"><textarea name="customerNotes" defaultValue={v("customerNotes")} rows={2} className={inputCls} /></Field>
      </div>
    </FormShell>
  );
}

interface LineRow {
  productId: string;
  quantity: string;
  discountPct: string;
}

export function OrderLinesEditor({ action, orderId, products, initialLines }: {
  action: Act;
  orderId: string;
  products: { id: string; sku: string; name: string; salesUnit: string; standardPriceCents: number }[];
  initialLines: { productId: string; quantity: number; discountPct: number }[];
}) {
  const { state, formAction, saved } = useFormAction(action);
  const [rows, setRows] = useState<LineRow[]>(
    initialLines.length > 0
      ? initialLines.map((l) => ({ productId: l.productId, quantity: String(l.quantity), discountPct: String(l.discountPct) }))
      : [{ productId: "", quantity: "1", discountPct: "0" }],
  );

  const set = (i: number, patch: Partial<LineRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const estimate = rows.reduce((sum, r) => {
    const p = products.find((x) => x.id === r.productId);
    const qty = Number(r.quantity) || 0;
    const disc = Math.min(100, Math.max(0, Number(r.discountPct) || 0));
    if (!p || qty <= 0) return sum;
    return sum + Math.round(qty * p.standardPriceCents * (1 - disc / 100));
  }, 0);

  return (
    <form
      action={(fd) => {
        fd.set("id", orderId);
        fd.set("linesJson", JSON.stringify(
          rows
            .filter((r) => r.productId && Number(r.quantity) > 0)
            .map((r) => ({ productId: r.productId, quantity: Number(r.quantity), discountPct: Number(r.discountPct) || 0 })),
        ));
        formAction(fd);
      }}
      className="space-y-3"
    >
      {rows.map((r, i) => (
        <div key={i} className="grid items-end gap-2 sm:grid-cols-[1fr_110px_110px_auto]">
          <Field label={i === 0 ? "Product" : ""}>
            <select value={r.productId} onChange={(e) => set(i, { productId: e.target.value })} className={inputCls} required>
              <option value="" disabled>Select…</option>
              {products.map((p) => (<option key={p.id} value={p.id}>{p.sku} — {p.name}</option>))}
            </select>
          </Field>
          <Field label={i === 0 ? "Qty" : ""}>
            <input value={r.quantity} onChange={(e) => set(i, { quantity: e.target.value })} inputMode="decimal" required className={inputCls} />
          </Field>
          <Field label={i === 0 ? "Discount %" : ""}>
            <input value={r.discountPct} onChange={(e) => set(i, { discountPct: e.target.value })} inputMode="decimal" className={inputCls} />
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
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setRows((rs) => [...rs, { productId: "", quantity: "1", discountPct: "0" }])}
          className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium hover:bg-slate-200"
        >
          + Add line
        </button>
        <p className="text-sm text-slate-500">Estimate at standard prices: <span className="font-semibold text-slate-800">{formatCents(estimate)}</span> (final prices resolve at confirm)</p>
      </div>
      <ErrorText message={state.error} />
      <SavedNote show={saved} />
      <SubmitButton label="Save lines" />
    </form>
  );
}
