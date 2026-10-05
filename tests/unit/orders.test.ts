import { describe, expect, it } from "vitest";
import { allocateLines, computeOrderTotals, canTransition } from "@/domain/orders";

describe("order allocation", () => {
  it("fully allocates when stock covers demand", () => {
    const out = allocateLines(
      [{ productId: "a", quantity: 5 }],
      { a: 20 },
    );
    expect(out).toEqual([{ productId: "a", requested: 5, allocated: 5, shortage: 0 }]);
  });

  it("splits partial allocation and reports shortage", () => {
    const out = allocateLines(
      [{ productId: "a", quantity: 30 }],
      { a: 20 },
    );
    expect(out[0]).toMatchObject({ allocated: 20, shortage: 10 });
  });

  it("fills same-product lines in order without over-allocating", () => {
    const out = allocateLines(
      [
        { productId: "a", quantity: 12 },
        { productId: "a", quantity: 12 },
      ],
      { a: 20 },
    );
    expect(out[0]).toMatchObject({ allocated: 12, shortage: 0 });
    expect(out[1]).toMatchObject({ allocated: 8, shortage: 4 });
    expect(out[0].allocated + out[1].allocated).toBe(20);
  });

  it("never double-allocates the final units across sequential confirms (race model)", () => {
    // Two orders race for the last 20 units: the second sees only the remainder.
    const first = allocateLines([{ productId: "a", quantity: 20 }], { a: 20 });
    const second = allocateLines([{ productId: "a", quantity: 20 }], { a: 20 - first[0].allocated });
    expect(first[0].allocated).toBe(20);
    expect(second[0].allocated).toBe(0);
    expect(second[0].shortage).toBe(20);
  });

  it("rejects non-positive quantities", () => {
    expect(() => allocateLines([{ productId: "a", quantity: 0 }], { a: 5 })).toThrow();
  });
});

describe("order totals", () => {
  it("computes integer totals with discount then tax", () => {
    // 2 × €5.00 = €10.00 gross, −10% = €9.00 net, +22% = €10.98
    const t = computeOrderTotals([{ quantity: 2, unitPriceCents: 500, discountPct: 10, taxRate: 22 }]);
    expect(t).toEqual({ subtotalCents: 1000, discountCents: 100, taxCents: 198, totalCents: 1098 });
  });
});

describe("order lifecycle", () => {
  it("allows the happy path and cancellation, blocks jumps", () => {
    expect(canTransition("DRAFT", "CONFIRMED")).toBe(true);
    expect(canTransition("WAITING_FOR_STOCK", "READY")).toBe(true);
    expect(canTransition("DRAFT", "READY")).toBe(false);
    expect(canTransition("PAID", "CANCELLED")).toBe(false);
    expect(canTransition("READY", "DISPATCHED")).toBe(true);
  });
});
