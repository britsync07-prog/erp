import { describe, expect, it } from "vitest";
import {
  requiresAdjustmentApproval,
  adjustmentTypeFor,
  validateTransfer,
  countCorrections,
} from "@/domain/inventory";
import { levelsFromAggregates } from "@/domain/stock";

describe("inventory rules", () => {
  it("routes small adjustments directly, large ones to approval", () => {
    expect(requiresAdjustmentApproval(50)).toBe(false);
    expect(requiresAdjustmentApproval(-50)).toBe(false);
    expect(requiresAdjustmentApproval(50.001)).toBe(true);
  });

  it("picks movement direction from the sign", () => {
    expect(adjustmentTypeFor(3)).toBe("ADJUSTMENT_IN");
    expect(adjustmentTypeFor(-2)).toBe("ADJUSTMENT_OUT");
    expect(() => adjustmentTypeFor(0)).toThrow();
  });

  it("rejects same-warehouse and non-positive transfers", () => {
    expect(() => validateTransfer({ fromWarehouseId: "a", toWarehouseId: "a", qty: 5 })).toThrow();
    expect(() => validateTransfer({ fromWarehouseId: "a", toWarehouseId: "b", qty: 0 })).toThrow();
    expect(() => validateTransfer({ fromWarehouseId: "a", toWarehouseId: "b", qty: 5 })).not.toThrow();
  });

  it("emits corrections only for real count differences", () => {
    const out = countCorrections([
      { productId: "p1", expectedQty: 10, countedQty: 12 },
      { productId: "p2", expectedQty: 5, countedQty: 5 },
      { productId: "p3", expectedQty: 7, countedQty: null },
    ]);
    expect(out).toEqual([{ productId: "p1", diff: 2 }]);
  });

  it("derives levels from aggregates without ledger filtering", () => {
    expect(levelsFromAggregates(120, 40, 20)).toEqual({
      physical: 120, reserved: 40, available: 80, incoming: 20, projected: 100,
    });
  });
});
