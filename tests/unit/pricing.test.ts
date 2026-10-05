import { describe, expect, it } from "vitest";
import { resolvePrice, lineTotalCents, type PriceCandidate } from "@/domain/pricing";

const D = (s: string) => new Date(s);
const base: PriceCandidate[] = [
  { kind: "GROUP", priceCents: 500, minQty: 1, priceGroup: "WHOLESALE", validFrom: D("2020-01-01"), validTo: null },
  { kind: "CUSTOMER", priceCents: 450, minQty: 1, validFrom: D("2020-01-01"), validTo: null, customerId: "c1" },
  { kind: "PROMO", priceCents: 400, minQty: 10, validFrom: D("2020-01-01"), validTo: null },
  { kind: "CONTRACT", priceCents: 380, minQty: 1, validFrom: D("2030-01-01"), validTo: null },
];

describe("pricing engine", () => {
  it("falls back to standard price with no matching rules", () => {
    expect(resolvePrice(600, [], { customerId: null, customerPriceGroup: null, quantity: 1 }).priceCents).toBe(600);
  });

  it("applies group pricing for members", () => {
    const r = resolvePrice(600, base, { customerId: "x", customerPriceGroup: "WHOLESALE", quantity: 1 });
    expect(r).toEqual({ priceCents: 500, source: "GROUP" });
  });

  it("customer price beats group price", () => {
    const r = resolvePrice(600, base, { customerId: "c1", customerPriceGroup: "WHOLESALE", quantity: 1 });
    expect(r).toEqual({ priceCents: 450, source: "CUSTOMER" });
  });

  it("promo wins on quantity break, future contracts are ignored", () => {
    const r = resolvePrice(600, base, { customerId: "c1", customerPriceGroup: null, quantity: 10, at: D("2025-06-01") });
    expect(r).toEqual({ priceCents: 400, source: "PROMO" });
  });

  it("expired rules never apply", () => {
    const expired: PriceCandidate[] = [
      { kind: "PROMO", priceCents: 100, minQty: 1, validFrom: D("2020-01-01"), validTo: D("2021-01-01") },
    ];
    const r = resolvePrice(600, expired, { customerId: null, customerPriceGroup: null, quantity: 1, at: D("2025-01-01") });
    expect(r.source).toBe("STANDARD");
  });

  it("computes integer line totals with discount and tax", () => {
    // 2 × €5.00 − 10% + 22% = €10.98 → 1098 cents
    expect(lineTotalCents(2, 500, 10, 22)).toBe(1098);
  });
});
