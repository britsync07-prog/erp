// Deterministic procurement calculation (§12). AI may present this, never invent it:
// every recommendation carries the full arithmetic breakdown in `reason`.

export interface ReorderInput {
  available: number; // base unit
  incoming: number; // confirmed, not yet received
  outstandingDemand: number; // reserved but unfulfilled
  safetyStock: number;
  forecastDemand: number; // expected demand before next delivery
  minOrderQtyBase: number; // MOQ converted to base unit
  packSizeBase: number; // rounding pack in base unit (>= 1 base unit effectively)
}

export interface ReorderResult {
  recommendedQty: number; // base unit, pack-rounded
  reason: string;
  shortage: boolean;
}

export function calculateReorderRequirement(input: ReorderInput): ReorderResult {
  const { available, incoming, outstandingDemand, safetyStock, forecastDemand } = input;
  const coverNeeded = safetyStock + outstandingDemand + forecastDemand;
  const onHand = available + incoming;
  const rawGap = coverNeeded - onHand;
  const shortage = available < safetyStock;

  if (rawGap <= 0) {
    return {
      recommendedQty: 0,
      reason:
        `No reorder needed. Available ${fmt(available)} + incoming ${fmt(incoming)} ` +
        `covers safety ${fmt(safetyStock)} + demand ${fmt(outstandingDemand)} + forecast ${fmt(forecastDemand)}.`,
      shortage,
    };
  }

  const moq = Math.max(0, input.minOrderQtyBase);
  const pack = Math.max(1e-9, input.packSizeBase);
  let qty = Math.max(rawGap, moq);
  qty = Math.ceil(qty / pack) * pack;
  qty = Math.round(qty * 1000) / 1000;

  return {
    recommendedQty: qty,
    reason:
      `Gap ${fmt(rawGap)} = (safety ${fmt(safetyStock)} + demand ${fmt(outstandingDemand)} ` +
      `+ forecast ${fmt(forecastDemand)}) − (available ${fmt(available)} + incoming ${fmt(incoming)}). ` +
      `MOQ ${fmt(moq)}, pack ${fmt(pack)} → recommend ${fmt(qty)} (base unit).` +
      (shortage ? " Available is below safety stock." : ""),
    shortage,
  };
}

function fmt(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

// ─── Purchase-unit conversion ───────────────────────────────────────────────
// Requirements are tracked in sales (base) units; purchase orders are placed in
// supplier purchase units. Always round UP — a short delivery is worse than a
// small overstock — then enforce the supplier minimum.

export function toPurchaseQty(baseQty: number, conversionFactor: number, minOrderQty = 0): number {
  if (!(baseQty > 0)) throw new Error("Required quantity must be positive.");
  if (!(conversionFactor > 0)) throw new Error("Invalid conversion factor.");
  const units = baseQty / conversionFactor;
  const rounded = Math.ceil(units * 100 - 1e-9) / 100;
  return Math.max(rounded, Math.max(0, minOrderQty));
}

// ─── Purchase-order lifecycle (§13) ─────────────────────────────────────────

const PO_FLOW: Record<string, string[]> = {
  DRAFT: ["PENDING_APPROVAL", "CANCELLED"],
  PENDING_APPROVAL: ["APPROVED", "DRAFT", "CANCELLED"],
  APPROVED: ["SENT", "CANCELLED"],
  SENT: ["SUPPLIER_CONFIRMED", "CANCELLED"],
  SUPPLIER_CONFIRMED: ["PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"],
  PARTIALLY_RECEIVED: ["RECEIVED", "CANCELLED"],
  RECEIVED: ["CLOSED"],
  CLOSED: [],
  CANCELLED: [],
};

export function canTransitionPO(from: string, to: string): boolean {
  return PO_FLOW[from]?.includes(to) ?? false;
}

export function assertTransitionPO(from: string, to: string): void {
  if (!canTransitionPO(from, to)) {
    throw new Error(`Purchase order cannot move from ${from} to ${to}.`);
  }
}
