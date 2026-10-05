"use client";

import type { ActionResult } from "@/server/platform";
import { PAYMENT_METHODS } from "@/domain/finance";
import { Field, inputCls, ErrorText, SavedNote } from "./ui";
import { SubmitButton, useFormAction } from "./client";

type Act = (prev: ActionResult, fd: FormData) => Promise<ActionResult>;

export function PaymentForm({ action, invoiceId, balanceCents }: {
  action: Act;
  invoiceId: string;
  balanceCents: number;
}) {
  const { state, formAction, saved } = useFormAction(action);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={`Amount (€, open ${(balanceCents / 100).toFixed(2)})`}>
          <input name="amount" required inputMode="decimal" placeholder="0.00" className={inputCls} />
        </Field>
        <Field label="Method">
          <select name="method" defaultValue="BANK_TRANSFER" className={inputCls}>
            {PAYMENT_METHODS.map((m) => (<option key={m} value={m}>{m.replace(/_/g, " ")}</option>))}
          </select>
        </Field>
        <Field label="Paid on"><input name="paidAt" type="date" defaultValue={today} className={inputCls} /></Field>
        <Field label="Reference"><input name="reference" maxLength={120} placeholder="e.g. bank ref" className={inputCls} /></Field>
      </div>
      <ErrorText message={state.error} />
      <SavedNote show={saved} />
      <SubmitButton label="Record payment" />
    </form>
  );
}

export function DueDateForm({ action, invoiceId, dueDate }: {
  action: Act;
  invoiceId: string;
  dueDate: string;
}) {
  const { state, formAction, saved } = useFormAction(action);
  return (
    <form action={formAction} className="flex items-end gap-2">
      <input type="hidden" name="id" value={invoiceId} />
      <Field label="Due date">
        <input name="dueDate" type="date" required defaultValue={dueDate} className={inputCls} />
      </Field>
      <SubmitButton label="Save" />
      {state.error && <ErrorText message={state.error} />}
      <SavedNote show={saved} />
    </form>
  );
}
