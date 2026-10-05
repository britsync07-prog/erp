"use client";

import { useMemo, useState } from "react";
import type { ActionResult } from "@/server/platform";
import { Field, inputCls, ErrorText, SavedNote } from "./ui";
import { SubmitButton, useFormAction } from "./client";

type Act = (prev: ActionResult, fd: FormData) => Promise<ActionResult>;

interface PickRow {
  productId: string;
  sku: string;
  name: string;
  salesUnit: string;
  requiredQty: number;
  pickedQty: number;
}

/** Warehouse pick screen: big inputs, scan-to-filter, absolute picked counts. */
export function PickForm({ action, fulfilmentId, lines }: {
  action: Act;
  fulfilmentId: string;
  lines: PickRow[];
}) {
  const { state, formAction, saved } = useFormAction(action);
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>(
    Object.fromEntries(lines.map((l) => [l.productId, String(l.pickedQty)])),
  );

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return lines;
    return lines.filter((l) => l.sku.toLowerCase().includes(q) || l.name.toLowerCase().includes(q));
  }, [lines, filter]);

  return (
    <form
      action={(fd) => {
        fd.set("id", fulfilmentId);
        fd.set("picksJson", JSON.stringify(
          lines.map((l) => ({ productId: l.productId, pickedQty: Number(picked[l.productId] ?? 0) })),
        ));
        formAction(fd);
      }}
      className="space-y-4"
    >
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Scan barcode or type to filter…"
        autoFocus
        className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base shadow-sm focus:border-indigo-500 focus:outline-none"
      />
      <ul className="space-y-3">
        {visible.map((l) => {
          const done = Number(picked[l.productId] ?? 0) + 1e-9 >= l.requiredQty;
          return (
            <li key={l.productId} className={`rounded-xl border bg-white p-4 shadow-sm ${done ? "border-emerald-300" : "border-slate-200"}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-1">
                <p className="font-semibold">{l.sku}</p>
                <p className="text-sm text-slate-500">need <span className="font-semibold text-slate-800">{l.requiredQty}</span> {l.salesUnit}</p>
              </div>
              <p className="mb-3 text-sm text-slate-500">{l.name}</p>
              <div className="flex items-center gap-3">
                <input
                  value={picked[l.productId] ?? ""}
                  onChange={(e) => setPicked((m) => ({ ...m, [l.productId]: e.target.value }))}
                  inputMode="decimal"
                  aria-label={`Picked quantity for ${l.sku}`}
                  className="w-36 rounded-xl border border-slate-300 px-4 py-3 text-lg focus:border-indigo-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setPicked((m) => ({ ...m, [l.productId]: String(l.requiredQty) }))}
                  className="text-sm font-medium text-indigo-700 hover:underline"
                >
                  Pick all
                </button>
                {done && <span className="text-sm font-medium text-emerald-700">Done</span>}
              </div>
            </li>
          );
        })}
      </ul>
      <ErrorText message={state.error} />
      <SavedNote show={saved} />
      <div className="sticky bottom-0 bg-slate-100 py-3">
        <SubmitButton label="Confirm pick" pendingLabel="Saving…" />
      </div>
    </form>
  );
}

export function DispatchForm({ action, fulfilmentId }: { action: Act; fulfilmentId: string }) {
  const { state, formAction, saved } = useFormAction(action);
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="id" value={fulfilmentId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Carrier (optional)"><input name="carrier" maxLength={120} placeholder="e.g. DHL, BRT" className={inputCls} /></Field>
        <Field label="Tracking code (optional)"><input name="tracking" maxLength={120} className={inputCls} /></Field>
      </div>
      <ErrorText message={state.error} />
      <SavedNote show={saved} />
      <SubmitButton label="Dispatch order" pendingLabel="Dispatching…" />
    </form>
  );
}

interface ReturnRow {
  productId: string;
  sku: string;
  name: string;
  returnable: number;
  salesUnit: string;
}

export function ReturnForm({ action, orderId, rows, orderLabel }: {
  action: Act;
  orderId: string;
  rows: ReturnRow[];
  orderLabel: string;
}) {
  const { state, formAction, saved } = useFormAction(action);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [cond, setCond] = useState<Record<string, string>>({});

  return (
    <form
      action={(fd) => {
        fd.set("orderId", orderId);
        fd.set("linesJson", JSON.stringify(
          rows
            .filter((r) => Number(qty[r.productId] || 0) > 0)
            .map((r) => ({
              productId: r.productId,
              quantity: Number(qty[r.productId]),
              condition: cond[r.productId] || "RESTOCK",
            })),
        ));
        formAction(fd);
      }}
      className="space-y-4"
    >
      <Field label="Reason"><input name="reason" maxLength={500} placeholder="e.g. Customer refused 2 cartons" className={inputCls} /></Field>
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.productId} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-1">
              <p className="font-semibold">{r.sku} — {r.name}</p>
              <p className="text-sm text-slate-500">returnable: {r.returnable} {r.salesUnit}</p>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">Qty back</span>
                <input
                  value={qty[r.productId] ?? ""}
                  onChange={(e) => setQty((m) => ({ ...m, [r.productId]: e.target.value }))}
                  inputMode="decimal"
                  placeholder="0"
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-lg focus:border-indigo-500 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">Condition</span>
                <select
                  value={cond[r.productId] ?? "RESTOCK"}
                  onChange={(e) => setCond((m) => ({ ...m, [r.productId]: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 focus:border-indigo-500 focus:outline-none"
                >
                  <option value="RESTOCK">Restock (sellable)</option>
                  <option value="DAMAGED">Damaged (waste)</option>
                </select>
              </label>
            </div>
          </li>
        ))}
      </ul>
      <ErrorText message={state.error} />
      <SavedNote show={saved} />
      <p className="text-xs text-slate-400">
        Restocked quantities re-enter inventory immediately. A credit note may be due — finance is notified ({orderLabel} stays linked).
      </p>
      <SubmitButton label="Complete return" pendingLabel="Posting…" />
    </form>
  );
}
