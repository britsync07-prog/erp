import { describe, expect, it } from "vitest";
import { validateReceiptLine, receiptStatusFor } from "@/domain/receiving";

describe("receipt line validation", () => {
  it("splits arrived goods into good vs damaged", () => {
    expect(validateReceiptLine({ orderedQty: 10, alreadyReceivedQty: 0, receivedQty: 8, damagedQty: 2 }))
      .toEqual({ goodQty: 6, damagedQty: 2, overdeliveredBy: 0 });
  });

  it("flags overdelivery instead of blocking it", () => {
    const r = validateReceiptLine({ orderedQty: 10, alreadyReceivedQty: 8, receivedQty: 5, damagedQty: 0 });
    expect(r).toEqual({ goodQty: 5, damagedQty: 0, overdeliveredBy: 3 });
  });

  it("rejects damaged exceeding received and negative input", () => {
    expect(() => validateReceiptLine({ orderedQty: 10, alreadyReceivedQty: 0, receivedQty: 3, damagedQty: 4 })).toThrow();
    expect(() => validateReceiptLine({ orderedQty: 10, alreadyReceivedQty: 0, receivedQty: -1, damagedQty: 0 })).toThrow();
  });
});

describe("PO receipt status", () => {
  it("marks RECEIVED only when every line is complete", () => {
    expect(receiptStatusFor([{ orderedQty: 10, receivedQty: 10 }])).toBe("RECEIVED");
    expect(receiptStatusFor([
      { orderedQty: 10, receivedQty: 10 },
      { orderedQty: 4, receivedQty: 2 },
    ])).toBe("PARTIALLY_RECEIVED");
  });
});
