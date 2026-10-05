// Pricing engine (§9). Resolution order (lowest priority first):
//   STANDARD → GROUP → CUSTOMER → quantity break → PROMO/CONTRACT (date-valid)
// Historical order prices are snapshotted onto order lines and never re-resolved.

export interface PriceCandidate {
  kind: "STANDARD" | "GROUP" | "CUSTOMER" | "PROMO" | "CONTRACT";
  priceCents: number;
  minQty: number;
  priceGroup?: string | null;
  validFrom: Date;
  validTo: Date | null;
  customerId?: string | null;
}

export interface PriceContext {
  customerId: string | null;
  customerPriceGroup: string | null;
  quantity: number;
  at?: Date;
}

const RANK: Record<PriceCandidate["kind"], number> = {
  STANDARD: 0,
  GROUP: 1,
  CUSTOMER: 2,
  PROMO: 3,
  CONTRACT: 4,
};

export function resolvePrice(
  standardPriceCents: number,
  candidates: PriceCandidate[],
  ctx: PriceContext,
): { priceCents: number; source: PriceCandidate["kind"] } {
  const at = ctx.at ?? new Date();
  let best: { priceCents: number; source: PriceCandidate["kind"] } = {
    priceCents: standardPriceCents,
    source: "STANDARD",
  };
  let bestRank = -1;

  for (const c of candidates) {
    if (c.validFrom > at) continue;
    if (c.validTo && c.validTo < at) continue;
    if (ctx.quantity < c.minQty) continue;
    if (c.kind === "CUSTOMER" && c.customerId !== ctx.customerId) continue;
    if (c.kind === "GROUP" && c.priceGroup !== ctx.customerPriceGroup) continue;
    const rank = RANK[c.kind];
    // Higher rank wins; within same rank the lowest price wins (deterministic).
    if (rank > bestRank || (rank === bestRank && c.priceCents < best.priceCents)) {
      best = { priceCents: c.priceCents, source: c.kind };
      bestRank = rank;
    }
  }
  return best;
}

/** Line total in cents, discount applied before tax. Integer math only. */
export function lineTotalCents(qty: number, unitPriceCents: number, discountPct = 0, taxRate = 0): number {
  const gross = Math.round(qty * unitPriceCents);
  const net = Math.round(gross * (1 - discountPct / 100));
  return Math.round(net * (1 + taxRate / 100));
}
