// Operational finance math (§19). Pure functions: due dates from payment
// terms, payment application, receivables aging. Persistence in services.

export const PAYMENT_METHODS = ["BANK_TRANSFER", "CASH", "CARD", "CHEQUE", "OTHER"] as const;

const TERMS_DAYS: Record<string, number> = {
  IMMEDIATE: 0,
  "30_DAYS": 30,
  "60_DAYS": 60,
  "90_DAYS": 90,
  CUSTOM: 30, // CUSTOM terms are negotiated per invoice; 30 is the fallback until edited
};

export function dueDateFor(issueDate: Date, paymentTerms: string): Date {
  const days = TERMS_DAYS[paymentTerms] ?? 30;
  const due = new Date(issueDate);
  due.setDate(due.getDate() + days);
  return due;
}

export interface PaymentApplication {
  newPaidCents: number;
  remainingCents: number;
  invoiceStatus: "PARTIAL" | "PAID";
}

/** Apply a payment to an invoice balance. Throws on over/under-payment. */
export function applyPayment(totalCents: number, paidCents: number, amountCents: number): PaymentApplication {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error("Payment amount must be positive.");
  }
  const remaining = totalCents - paidCents;
  if (amountCents > remaining) {
    throw new Error(`Payment exceeds the open balance (${remaining / 100}).`);
  }
  const newPaid = paidCents + amountCents;
  return {
    newPaidCents: newPaid,
    remainingCents: totalCents - newPaid,
    invoiceStatus: newPaid >= totalCents ? "PAID" : "PARTIAL",
  };
}

export type AgingBucket = "CURRENT" | "D1_30" | "D31_60" | "D60_PLUS";

/** Which aging bucket an open invoice falls into, relative to today. */
export function agingBucket(dueDate: Date | null, now = new Date()): AgingBucket | null {
  if (!dueDate) return null;
  const days = Math.floor((now.getTime() - dueDate.getTime()) / 86400000);
  if (days <= 0) return "CURRENT";
  if (days <= 30) return "D1_30";
  if (days <= 60) return "D31_60";
  return "D60_PLUS";
}

export function isOverdue(dueDate: Date | null, balanceCents: number, now = new Date()): boolean {
  return balanceCents > 0 && !!dueDate && dueDate.getTime() < new Date(now.toDateString()).getTime();
}
