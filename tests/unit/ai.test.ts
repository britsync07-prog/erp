import { describe, expect, it } from "vitest";
import { toolsFor, runTool } from "@/server/ai/tools";
import { ruleComposeBrief } from "@/server/ai/brief";
import { PERMISSIONS } from "@/domain/constants";

describe("tool governance", () => {
  it("exposes all tools to fully-permissioned callers", () => {
    expect(toolsFor([...PERMISSIONS]).length).toBeGreaterThanOrEqual(7);
  });

  it("hides finance tools from order-only callers", () => {
    const names = toolsFor(["orders.view"]).map((t) => t.name);
    expect(names).toContain("operations_attention");
    expect(names).toContain("product_demand");
    expect(names).not.toContain("receivables_snapshot");
    expect(names).not.toContain("margin_snapshot");
  });

  it("rejects unknown tools and out-of-permission calls without touching data", async () => {
    await expect(runTool({ orgId: "x", userId: "y", permissions: [] }, "nope", {})).rejects.toThrow("Unknown tool");
    await expect(
      runTool({ orgId: "x", userId: "y", permissions: ["orders.view"] }, "receivables_snapshot", {}),
    ).rejects.toThrow("permission");
  });
});

describe("rule-composed brief", () => {
  const data = {
    date: "2026-09-13",
    attention: { orders: { today: 3, waiting: 2, ready: 1 }, pendingApprovals: 1, overduePurchaseOrders: 1 },
    stock: [
      { sku: "LOW-1", name: "Low Item", available: 5, reorderPoint: 20, suggestedTopUp: 30, link: "/products/p1" },
    ],
    receivables: { outstandingCents: 50000, overdueCount: 2 },
    suppliers: [{ company: "Late Ltd", lateDeliveries: 2, avgDelayDays: 3, link: "/suppliers/s1" }],
    margins: { marginPct: 12 },
  };

  it("builds a deterministic headline, findings and reorders", () => {
    const doc = ruleComposeBrief(data);
    expect(doc.headline).toContain("3 orders today");
    expect(doc.kpis.waiting).toBe(2);
    const kinds = doc.findings.map((f) => f.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(["ORDER_RISK", "STOCK_RISK", "RECEIVABLE_RISK", "SUPPLIER_RISK", "MARGIN_WATCH", "INFO"]),
    );
    for (const f of doc.findings) {
      if (f.actionLink) expect(f.actionLink.startsWith("/")).toBe(true);
    }
    expect(doc.reorders).toEqual([{ sku: "LOW-1", name: "Low Item", suggested: 30, link: "/inventory/low-stock" }]);
  });

  it("stays quiet when the business is healthy", () => {
    const doc = ruleComposeBrief({
      date: "2026-09-13",
      attention: { orders: { today: 1, waiting: 0, ready: 0 }, pendingApprovals: 0, overduePurchaseOrders: 0 },
      stock: [],
      receivables: { outstandingCents: 0, overdueCount: 0 },
      suppliers: [],
      margins: { marginPct: 40 },
    });
    expect(doc.findings).toHaveLength(0);
    expect(doc.reorders).toHaveLength(0);
  });
});
