import { describe, expect, it } from "vitest";
import { hasPermission, ROLE_PERMISSIONS, PERMISSIONS, type Permission } from "@/domain/constants";

const user = (permissions: Permission[]) => ({ permissions });

describe("RBAC", () => {
  it("grants listed permissions and denies everything else", () => {
    expect(hasPermission(user(["products.view"]), "products.view")).toBe(true);
    expect(hasPermission(user(["products.view"]), "products.manage")).toBe(false);
    expect(hasPermission(null, "products.view")).toBe(false);
  });

  it("owner holds every permission", () => {
    for (const p of PERMISSIONS) {
      expect(ROLE_PERMISSIONS.OWNER).toContain(p);
    }
  });

  it("warehouse staff cannot see finance or manage users", () => {
    expect(ROLE_PERMISSIONS.WAREHOUSE).not.toContain("finance.view");
    expect(ROLE_PERMISSIONS.WAREHOUSE).not.toContain("users.manage");
    expect(ROLE_PERMISSIONS.WAREHOUSE).toContain("inventory.manage");
  });

  it("viewer is read-only across the board", () => {
    const manage = (PERMISSIONS as readonly string[]).filter((p) => p.endsWith(".manage") || p.endsWith(".approve"));
    for (const p of manage) {
      expect(ROLE_PERMISSIONS.VIEWER).not.toContain(p);
    }
  });
});
