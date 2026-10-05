import { describe, expect, it } from "vitest";
import {
  isFullyPicked,
  firstUnpickedLine,
  validatePickQuantity,
  returnableQty,
  validateReturnQuantity,
} from "@/domain/fulfilment";

describe("picking", () => {
  it("detects the first incomplete line", () => {
    const lines = [
      { requiredQty: 4, pickedQty: 4 },
      { requiredQty: 6, pickedQty: 2 },
    ];
    expect(firstUnpickedLine(lines)).toBe(1);
    expect(isFullyPicked(lines)).toBe(false);
    expect(isFullyPicked([{ requiredQty: 4, pickedQty: 4 }])).toBe(true);
  });

  it("rejects over-picking and negative picks", () => {
    expect(() => validatePickQuantity(4, 5)).toThrow();
    expect(() => validatePickQuantity(4, -1)).toThrow();
    expect(() => validatePickQuantity(4, 4)).not.toThrow();
  });
});

describe("returns", () => {
  it("computes returnable stock per line", () => {
    expect(returnableQty({ fulfilledQty: 10, alreadyReturnedQty: 4 })).toBe(6);
    expect(returnableQty({ fulfilledQty: 10, alreadyReturnedQty: 10 })).toBe(0);
  });

  it("blocks returns beyond what was delivered", () => {
    expect(() => validateReturnQuantity({ fulfilledQty: 10, alreadyReturnedQty: 8 }, 3)).toThrow();
    expect(() => validateReturnQuantity({ fulfilledQty: 10, alreadyReturnedQty: 8 }, 2)).not.toThrow();
  });
});
