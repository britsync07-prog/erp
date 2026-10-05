// Inventory domain rules (§10–11, §22). Pure functions — the service layer adds
// persistence, permissions and audit.

/**
 * Significant adjustments need a second pair of eyes (AI Level C principle
 * applied to humans too). Threshold is a business policy: intentionally a named
 * constant so the future automation-rule UI (Phase 10) has one place to take over.
 */
export const ADJUSTMENT_APPROVAL_THRESHOLD = 50; // absolute base units

export function requiresAdjustmentApproval(absQty: number): boolean {
  return Math.abs(absQty) > ADJUSTMENT_APPROVAL_THRESHOLD;
}

export function adjustmentTypeFor(signedQty: number): "ADJUSTMENT_IN" | "ADJUSTMENT_OUT" {
  if (signedQty === 0) throw new Error("Adjustment quantity cannot be zero.");
  return signedQty > 0 ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT";
}

export interface TransferInput {
  fromWarehouseId: string;
  toWarehouseId: string;
  qty: number;
}

export function validateTransfer(input: TransferInput): void {
  if (!input.fromWarehouseId || !input.toWarehouseId) throw new Error("Both warehouses are required.");
  if (input.fromWarehouseId === input.toWarehouseId) {
    throw new Error("Source and destination warehouses must differ. Use an adjustment for corrections.");
  }
  if (!(input.qty > 0)) throw new Error("Transfer quantity must be positive.");
}

export interface CountLine {
  productId: string;
  expectedQty: number;
  countedQty: number | null;
}

/** Posting a count emits a correction movement per line with a real difference. */
export function countCorrections(lines: CountLine[]): { productId: string; diff: number }[] {
  return lines
    .filter((l) => l.countedQty !== null && Math.abs(round3(l.countedQty) - round3(l.expectedQty)) > 1e-9)
    .map((l) => ({ productId: l.productId, diff: round3((l.countedQty as number) - l.expectedQty) }));
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
