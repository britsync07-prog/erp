// Order domain logic (§7). Pure functions: allocation math, totals, and the
// lifecycle state machine. Persistence + locking live in services/orders.ts.

export interface RequestedLine {
  productId: string;
  quantity: number;
}

export interface LineAllocation {
  productId: string;
  requested: number;
  allocated: number;
  shortage: number;
}

/**
 * Allocate requested quantities against per-product availability.
 * Lines for the same product are filled in order; never allocates more than
 * available. The caller persists reservations for `allocated` and raises
 * purchase requirements for `shortage`.
 */
export function allocateLines(
  lines: RequestedLine[],
  availability: Map<string, number> | Record<string, number>,
): LineAllocation[] {
  const avail: Record<string, number> = availability instanceof Map ? Object.fromEntries(availability) : { ...availability };
  const remaining: Record<string, number> = { ...avail };
  return lines.map((l) => {
    if (!(l.quantity > 0)) throw new Error("Order quantities must be positive.");
    const have = Math.max(0, remaining[l.productId] ?? 0);
    const allocated = Math.min(l.quantity, have);
    remaining[l.productId] = Math.round((have - allocated) * 1000) / 1000;
    return {
      productId: l.productId,
      requested: l.quantity,
      allocated: Math.round(allocated * 1000) / 1000,
      shortage: Math.round((l.quantity - allocated) * 1000) / 1000,
    };
  });
}

export interface PricedLine {
  quantity: number;
  unitPriceCents: number;
  discountPct?: number;
  taxRate?: number;
}

export interface OrderTotals {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
}

/** Integer-cents totals: discount per line, then tax on the discounted net. */
export function computeOrderTotals(lines: PricedLine[]): OrderTotals {
  let subtotal = 0;
  let discount = 0;
  let tax = 0;
  for (const l of lines) {
    const gross = Math.round(l.quantity * l.unitPriceCents);
    const disc = Math.round(gross * ((l.discountPct ?? 0) / 100));
    const net = gross - disc;
    subtotal += gross;
    discount += disc;
    tax += Math.round(net * ((l.taxRate ?? 0) / 100));
  }
  return { subtotalCents: subtotal, discountCents: discount, taxCents: tax, totalCents: subtotal - discount + tax };
}

// ─── Lifecycle (§7) ─────────────────────────────────────────────────────────

export const ORDER_FLOW = [
  "DRAFT",
  "CONFIRMED",
  "PROCESSING",
  "WAITING_FOR_STOCK",
  "READY",
  "DISPATCHED",
  "DELIVERED",
  "INVOICED",
  "PAID",
] as const;

const TERMINAL_SIDE: Record<string, string[]> = {
  DRAFT: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["READY", "WAITING_FOR_STOCK", "CANCELLED"],
  WAITING_FOR_STOCK: ["READY", "CANCELLED"],
  READY: ["DISPATCHED", "CANCELLED"],
  DISPATCHED: ["DELIVERED", "PARTIALLY_FULFILLED"],
  DELIVERED: ["INVOICED", "RETURNED", "PARTIALLY_RETURNED"],
  PARTIALLY_FULFILLED: ["DISPATCHED", "DELIVERED"],
  INVOICED: ["PAID", "DELIVERED"],
  PAID: [],
  CANCELLED: [],
  RETURNED: [],
  PARTIALLY_RETURNED: ["RETURNED"],
};

export function canTransition(from: string, to: string): boolean {
  return TERMINAL_SIDE[from]?.includes(to) ?? false;
}

export function assertTransition(from: string, to: string): void {
  if (!canTransition(from, to)) {
    throw new Error(`Order cannot move from ${from} to ${to}.`);
  }
}
