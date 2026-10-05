"use client";

import { useMemo, useState } from "react";
import type { ActionResult } from "@/server/platform";
import { ErrorText } from "./ui";
import { SubmitButton, useFormAction } from "./client";

type Act = (prev: ActionResult, fd: FormData) => Promise<ActionResult>;

interface ReceiveRow {
  productId: string;
  sku: string;
  name: string;
  purchaseUnit: string;
  ordered: number;
  alreadyReceived: number;
}

/**
 * Warehouse-first receiving form: oversized touch inputs, one-hand friendly,
 * with a scan/type filter (USB scanner wedges and phone keyboards just type).
 */
export function ReceiveForm({ action, poId, rows }: {
  action: Act;
  poId: string;
  rows: ReceiveRow[];
}) {
  const { state, formAction, saved } = useFormAction(action);
  const [filter, setFilter] = useState("");
  const [qty, setQty] = useState<Record<string, { received: string; damaged: string }>>({});

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.sku.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
  }, [rows, filter]);

  const set = (id: string, patch: Partial<{ received: string; damaged: string }>) =>
    setQty((m) => {
      const cur = m[id] ?? { received: "", damaged: "" };
      return { ...m, [id]: { ...cur, ...patch } };
    });

  const remaining = (r: ReceiveRow) => Math.max(0, Math.round((r.ordered - r.alreadyReceived) * 100) / 100);

  return (
    <form
      action={(fd) => {
        fd.set("poId", poId);
        fd.set("linesJson", JSON.stringify(
          rows.map((r) => ({
            productId: r.productId,
            receivedQty: Number(qty[r.productId]?.received || 0),
            damagedQty: Number(qty[r.productId]?.damaged || 0),
          })),
        ));
        formAction(fd);
      }}
      className="space-y-4"
    >
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Scan barcode or type to filter lines…"
        autoFocus
        className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base shadow-sm focus:border-indigo-500 focus:outline-none"
      />
      <ul className="space-y-3">
        {visible.map((r) => (
          <li key={r.productId} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-1">
              <p className="font-semibold">{r.sku}</p>
              <p className="text-xs text-slate-400">
                expected {remaining(r)} {r.purchaseUnit}
                {r.alreadyReceived > 0 && ` (${r.alreadyReceived} already in)`}
              </p>
            </div>
            <p className="mb-3 text-sm text-slate-500">{r.name}</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">Received ({r.purchaseUnit})</span>
                <input
                  value={qty[r.productId]?.received ?? ""}
                  onChange={(e) => set(r.productId, { received: e.target.value })}
                  inputMode="decimal"
                  placeholder="0"
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-lg focus:border-indigo-500 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">Damaged</span>
                <input
                  value={qty[r.productId]?.damaged ?? ""}
                  onChange={(e) => set(r.productId, { damaged: e.target.value })}
                  inputMode="decimal"
                  placeholder="0"
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-lg focus:border-indigo-500 focus:outline-none"
                />
              </label>
            </div>
            <button
              type="button"
              onClick={() => set(r.productId, { received: String(remaining(r)), damaged: "" })}
              className="mt-2 text-sm font-medium text-indigo-700 hover:underline"
            >
              Fill remaining ({remaining(r)})
            </button>
          </li>
        ))}
      </ul>
      {visible.length === 0 && <p className="text-center text-sm text-slate-400">No lines match “{filter}”.</p>}
      <ErrorText message={state.error} />
      {saved && <p className="text-sm text-emerald-700">Saved.</p>}
      <div className="sticky bottom-0 bg-slate-100 py-3">
        <SubmitButton label="Post receipt" pendingLabel="Posting…" />
      </div>
    </form>
  );
}
