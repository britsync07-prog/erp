// Unit conversion. All stock math happens in salesUnit (base unit).
// conversionFactor = salesUnits per 1 purchaseUnit (e.g. 24 for CTN→PCS).

export function toBaseQty(qty: number, conversionFactor: number): number {
  if (!Number.isFinite(qty) || !Number.isFinite(conversionFactor) || conversionFactor <= 0) {
    throw new Error("Invalid quantity or conversion factor.");
  }
  return round3(qty * conversionFactor);
}

export function fromBaseQty(baseQty: number, conversionFactor: number): number {
  if (!Number.isFinite(baseQty) || !Number.isFinite(conversionFactor) || conversionFactor <= 0) {
    throw new Error("Invalid quantity or conversion factor.");
  }
  return round3(baseQty / conversionFactor);
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Cents formatting for EUR (integer-cents model, no float money). */
export function formatCents(cents: number, currency = "EUR", locale = "en-IE"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}
