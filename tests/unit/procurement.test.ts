import { describe, expect, it } from "vitest";
import {
  calculateReorderRequirement,
  toPurchaseQty,
  canTransitionPO,
} from "@/domain/procurement";

describe("procurement calculation", () => {
  it("recommends nothing when covered", () => {
    const r = calculateReorderRequirement({
      available: 100, incoming: 0, outstandingDemand: 20,
      safetyStock: 40, forecastDemand: 10, minOrderQtyBase: 1, packSizeBase: 1,
    });
    expect(r.recommendedQty).toBe(0);
    expect(r.shortage).toBe(false);
  });

  it("flags shortage and explains the arithmetic", () => {
    const r = calculateReorderRequirement({
      available: 25, incoming: 0, outstandingDemand: 0,
      safetyStock: 40, forecastDemand: 30, minOrderQtyBase: 1, packSizeBase: 1,
    });
    expect(r.shortage).toBe(true);
    expect(r.recommendedQty).toBe(45);
    expect(r.reason).toContain("safety 40");
  });

  it("rounds up to MOQ and pack size", () => {
    const r = calculateReorderRequirement({
      available: 0, incoming: 0, outstandingDemand: 0,
      safetyStock: 10, forecastDemand: 0, minOrderQtyBase: 48, packSizeBase: 24,
    });
    expect(r.recommendedQty).toBe(48);
  });
});

describe("purchase-unit conversion", () => {
  it("converts base units up to whole purchase units", () => {
    // 72 pcs at 24 pcs/carton = exactly 3 cartons
    expect(toPurchaseQty(72, 24)).toBe(3);
    // 50 pcs → 2.09 cartons (rounded UP to 2dp, never short the delivery)
    expect(toPurchaseQty(50, 24)).toBe(2.09);
  });

  it("enforces the supplier minimum", () => {
    expect(toPurchaseQty(10, 24, 2)).toBe(2);
  });

  it("rejects nonsense input", () => {
    expect(() => toPurchaseQty(0, 24)).toThrow();
    expect(() => toPurchaseQty(10, 0)).toThrow();
  });
});

describe("purchase-order lifecycle", () => {
  it("allows the approval chain and blocks jumps", () => {
    expect(canTransitionPO("DRAFT", "PENDING_APPROVAL")).toBe(true);
    expect(canTransitionPO("PENDING_APPROVAL", "APPROVED")).toBe(true);
    expect(canTransitionPO("PENDING_APPROVAL", "DRAFT")).toBe(true);
    expect(canTransitionPO("DRAFT", "APPROVED")).toBe(false);
    expect(canTransitionPO("RECEIVED", "CLOSED")).toBe(true);
    expect(canTransitionPO("CLOSED", "DRAFT")).toBe(false);
  });
});
