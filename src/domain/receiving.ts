// Goods-receiving math (§14). Pure functions: split arrived goods into
// sellable vs damaged, validate against the ordered line. All quantities here
// are in PURCHASE units; conversion to base units happens in the service.

export interface ReceiptLineInput {
  orderedQty: number;
  alreadyReceivedQty: number;
  receivedQty: number; // total arrived this delivery (good + damaged)
  damagedQty: number; // of the arrived goods, unusable
}

export interface ReceiptLineResult {
  goodQty: number;
  damagedQty: number;
  overdeliveredBy: number; // > 0 when cumulative good exceeds ordered
}

export function validateReceiptLine(input: ReceiptLineInput): ReceiptLineResult {
  const { orderedQty, alreadyReceivedQty, receivedQty, damagedQty } = input;
  if (!(receivedQty >= 0)) throw new Error("Received quantity cannot be negative.");
  if (!(damagedQty >= 0)) throw new Error("Damaged quantity cannot be negative.");
  if (damagedQty > receivedQty + 1e-9) {
    throw new Error("Damaged quantity cannot exceed the received quantity.");
  }
  const goodQty = Math.round((receivedQty - damagedQty) * 100) / 100;
  const cumulative = alreadyReceivedQty + goodQty;
  return {
    goodQty,
    damagedQty: Math.round(damagedQty * 100) / 100,
    overdeliveredBy: Math.round(Math.max(0, cumulative - orderedQty) * 100) / 100,
  };
}

/** PO receipt status from per-line completion (all quantities in purchase units). */
export function receiptStatusFor(
  lines: { orderedQty: number; receivedQty: number }[],
): "PARTIALLY_RECEIVED" | "RECEIVED" {
  const complete = lines.every((l) => l.receivedQty + 1e-9 >= l.orderedQty);
  return complete ? "RECEIVED" : "PARTIALLY_RECEIVED";
}
