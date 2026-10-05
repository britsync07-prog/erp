import { describe, expect, it } from "vitest";
import { toBaseQty, fromBaseQty } from "@/domain/units";

describe("unit conversion", () => {
  it("converts purchase units to base units (1 CTN = 24 PCS)", () => {
    expect(toBaseQty(6, 24)).toBe(144);
  });

  it("converts base units back to purchase units", () => {
    expect(fromBaseQty(144, 24)).toBe(6);
  });

  it("handles fractional quantities (kg)", () => {
    expect(toBaseQty(2.5, 1)).toBe(2.5);
    expect(fromBaseQty(7.5, 3)).toBe(2.5);
  });

  it("rejects zero or negative conversion factors", () => {
    expect(() => toBaseQty(1, 0)).toThrow();
    expect(() => fromBaseQty(1, -2)).toThrow();
  });

  it("rejects non-finite input", () => {
    expect(() => toBaseQty(NaN, 24)).toThrow();
    expect(() => toBaseQty(1, Infinity)).toThrow();
  });
});
