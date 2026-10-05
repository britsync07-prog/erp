"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { fail, friendlyError, type ActionResult } from "@/server/platform";
import * as svc from "@/server/services/finance";

async function actor() {
  const s = await getSession();
  if (!s) return fail("You are not signed in.");
  return s;
}

function touchInvoice(id: string, orderId?: string | null) {
  revalidatePath(`/finance/${id}`);
  revalidatePath("/finance");
  revalidatePath("/finance/receivables");
  revalidatePath("/");
  if (orderId) revalidatePath(`/orders/${orderId}`);
}

function form(raw: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  raw.forEach((v, k) => {
    if (typeof v === "string") out[k] = v;
  });
  return out;
}

export async function createInvoiceAction(orderId: string): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    const id = await svc.createInvoiceFromOrder(me as never, orderId);
    revalidatePath("/finance");
    revalidatePath(`/orders/${orderId}`);
    redirect(`/finance/${id}`);
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function issueInvoiceAction(id: string, orderId?: string | null): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    await svc.issueInvoice(me as never, id);
    touchInvoice(id, orderId);
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function setInvoiceDueDateAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  const id = String(formData.get("id") ?? "");
  try {
    await svc.setInvoiceDueDate(me as never, id, String(formData.get("dueDate") ?? ""));
    touchInvoice(id);
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function deleteInvoiceAction(id: string, orderId?: string | null): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    await svc.deleteInvoice(me as never, id);
    revalidatePath("/finance");
    if (orderId) revalidatePath(`/orders/${orderId}`);
    redirect("/finance");
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function voidInvoiceAction(id: string, orderId?: string | null): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    await svc.voidInvoice(me as never, id);
    touchInvoice(id, orderId);
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function recordPaymentAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  const id = String(formData.get("invoiceId") ?? "");
  try {
    const f = form(formData);
    const euros = Number(String(f.amount ?? "").replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(euros) || euros <= 0) return fail("Enter a positive payment amount.");
    await svc.recordPayment(me as never, { ...f, amountCents: Math.round(euros * 100) });
    touchInvoice(id);
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function createCreditNoteAction(returnId: string): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    const id = await svc.createCreditNoteFromReturn(me as never, returnId);
    revalidatePath("/finance/credit-notes");
    redirect(`/finance/credit-notes/${id}`);
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function issueCreditNoteAction(id: string): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    await svc.issueCreditNote(me as never, id);
    revalidatePath(`/finance/credit-notes/${id}`);
    revalidatePath("/finance/credit-notes");
    revalidatePath("/finance/receivables");
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}

export async function voidCreditNoteAction(id: string): Promise<ActionResult> {
  const me = await actor();
  if ("ok" in me && !me.ok) return me;
  try {
    await svc.voidCreditNote(me as never, id);
    revalidatePath(`/finance/credit-notes/${id}`);
    revalidatePath("/finance/credit-notes");
    return { ok: true };
  } catch (e) {
    return fail(friendlyError(e));
  }
}
