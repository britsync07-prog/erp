// Fulfilment domain rules (§16). Pure functions: pick completeness, dispatch
// readiness, returnable quantities. Money and stock writes live in services.

export interface PickLine {
  requiredQty: number;
  pickedQty: number;
}

/** Every line must be fully picked before dispatch. Returns the first gap, if any. */
export function firstUnpickedLine(lines: PickLine[]): number {
  return lines.findIndex((l) => l.pickedQty + 1e-9 < l.requiredQty);
}

export function isFullyPicked(lines: PickLine[]): boolean {
  return firstUnpickedLine(lines) === -1;
}

export function validatePickQuantity(requiredQty: number, pickedQty: number): void {
  if (!(pickedQty >= 0)) throw new Error("Picked quantity cannot be negative.");
  if (pickedQty - 1e-9 > requiredQty) {
    throw new Error(`Cannot pick more than required (${requiredQty}).`);
  }
}

export interface ReturnableLine {
  fulfilledQty: number;
  alreadyReturnedQty: number;
}

/** How much of a delivered line can still be returned. */
export function returnableQty(line: ReturnableLine): number {
  return Math.max(0, Math.round((line.fulfilledQty - line.alreadyReturnedQty) * 1000) / 1000);
}

export function validateReturnQuantity(line: ReturnableLine, requested: number): void {
  if (!(requested > 0)) throw new Error("Return quantity must be positive.");
  if (requested - 1e-9 > returnableQty(line)) {
    throw new Error(`Only ${returnableQty(line)} can still be returned from this line.`);
  }
}
