import { describe, expect, it } from "vitest";
import { computeStockLevels, canReserve } from "@/domain/stock";

describe("stock ledger derivations", () => {
  it("derives physical/available/projected from movements", () => {
    const s = computeStockLevels({
      movements: [
        { type: "ADJUSTMENT_IN", quantity: 100 },
        { type: "PURCHASE_RECEIPT", quantity: 50 },
        { type: "SALE_DISPATCH", quantity: -30 },
      ],
      reserved: 40,
      incoming: 20,
    });
    expect(s).toEqual({ physical: 120, reserved: 40, available: 80, incoming: 20, projected: 100 });
  });

  it("ignores reservation-only entries in the physical sum", () => {
    const s = computeStockLevels({
      movements: [{ type: "SALE_RESERVATION", quantity: 999 }],
      reserved: 0,
      incoming: 0,
    });
    expect(s.physical).toBe(0);
  });

  it("never allows reserving more than available", () => {
    expect(canReserve(20, 20)).toBe(true);
    expect(canReserve(20, 21)).toBe(false);
    expect(canReserve(0, 1)).toBe(false);
    expect(canReserve(20, 0)).toBe(false);
  });
});
