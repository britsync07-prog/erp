import { describe, expect, it } from "vitest";
import { dueDateFor, applyPayment, agingBucket, isOverdue } from "@/domain/finance";

describe("payment terms", () => {
  it("computes due dates from terms", () => {
    expect(dueDateFor(new Date("2026-01-01"), "30_DAYS")).toEqual(new Date("2026-01-31"));
    expect(dueDateFor(new Date("2026-01-01"), "IMMEDIATE")).toEqual(new Date("2026-01-01"));
  });
});

describe("payment application", () => {
  it("tracks partial then full payment in integer cents", () => {
    const p1 = applyPayment(1098, 0, 500);
    expect(p1).toEqual({ newPaidCents: 500, remainingCents: 598, invoiceStatus: "PARTIAL" });
    const p2 = applyPayment(1098, 500, 598);
    expect(p2.invoiceStatus).toBe("PAID");
  });

  it("refuses overpayment and nonsense amounts", () => {
    expect(() => applyPayment(1000, 600, 500)).toThrow();
    expect(() => applyPayment(1000, 0, 0)).toThrow();
  });
});

describe("receivables aging", () => {
  const now = new Date("2026-09-13T12:00:00");
  it("buckets open invoices by days overdue", () => {
    expect(agingBucket(new Date("2026-09-20"), now)).toBe("CURRENT");
    expect(agingBucket(new Date("2026-09-10"), now)).toBe("D1_30");
    expect(agingBucket(new Date("2026-08-01"), now)).toBe("D31_60");
    expect(agingBucket(new Date("2026-06-01"), now)).toBe("D60_PLUS");
    expect(agingBucket(null, now)).toBeNull();
  });

  it("flags overdue only with an open balance past due", () => {
    expect(isOverdue(new Date("2026-09-01"), 100, now)).toBe(true);
    expect(isOverdue(new Date("2026-09-01"), 0, now)).toBe(false);
    expect(isOverdue(new Date("2026-09-20"), 100, now)).toBe(false);
  });
});
