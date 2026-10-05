// Central domain constants. Single source of truth for statuses, roles,
// permissions and movement types. UI, services and tests must import from here
// — never hardcode these strings elsewhere.
//
// SQLite note: Prisma/SQLite has no native enums, so status/type columns are
// String in the schema with these constants enforced by Zod in the service
// layer. POSTGRES MIGRATION: convert these to native PG enums (see
// docs/POSTGRES_MIGRATION.md).

export const ROLES = [
  "OWNER",
  "ADMIN",
  "OPS_MANAGER",
  "SALES",
  "WAREHOUSE",
  "PROCUREMENT",
  "FINANCE",
  "VIEWER",
] as const;
export type RoleCode = (typeof ROLES)[number];

export const PERMISSIONS = [
  "users.manage",
  "roles.manage",
  "customers.view",
  "customers.manage",
  "suppliers.view",
  "suppliers.manage",
  "products.view",
  "products.manage",
  "pricing.view",
  "pricing.manage",
  "warehouses.view",
  "warehouses.manage",
  "inventory.view",
  "inventory.manage",
  "orders.view",
  "orders.manage",
  "procurement.view",
  "procurement.manage",
  "procurement.approve",
  "finance.view",
  "finance.manage",
  "audit.view",
  "intelligence.view",
  "intelligence.manage",
  "admin.view",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Default permission matrix (Phase 0, section 7). Stored on Role.permissions (JSON). */
export const ROLE_PERMISSIONS: Record<RoleCode, Permission[]> = {
  OWNER: [...PERMISSIONS],
  ADMIN: [...PERMISSIONS],
  OPS_MANAGER: [
    "customers.view", "suppliers.view", "products.view", "pricing.view",
    "warehouses.view", "inventory.view", "inventory.manage",
    "orders.view", "orders.manage", "procurement.view", "procurement.manage",
    "procurement.approve", "finance.view", "audit.view", "intelligence.view", "intelligence.manage", "admin.view",
  ],
  SALES: ["customers.view", "customers.manage", "products.view", "pricing.view", "orders.view", "orders.manage", "intelligence.view"],
  WAREHOUSE: ["products.view", "warehouses.view", "inventory.view", "inventory.manage", "orders.view"],
  PROCUREMENT: ["suppliers.view", "suppliers.manage", "products.view", "warehouses.view", "inventory.view", "procurement.view", "procurement.manage", "intelligence.view"],
  FINANCE: ["customers.view", "suppliers.view", "products.view", "orders.view", "finance.view", "finance.manage", "intelligence.view"],
  VIEWER: ["customers.view", "suppliers.view", "products.view", "pricing.view", "warehouses.view", "inventory.view", "orders.view", "procurement.view", "finance.view", "intelligence.view"],
};

export const ORDER_STATUSES = [
  "DRAFT", "CONFIRMED", "PROCESSING", "WAITING_FOR_STOCK", "READY",
  "DISPATCHED", "DELIVERED", "INVOICED", "PAID",
  "CANCELLED", "PARTIALLY_FULFILLED", "RETURNED", "PARTIALLY_RETURNED",
] as const;

export const PO_STATUSES = [
  "DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT", "SUPPLIER_CONFIRMED",
  "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED", "CANCELLED",
] as const;

export const MOVEMENT_TYPES = [
  "PURCHASE_RECEIPT", "SALE_RESERVATION", "SALE_RESERVATION_RELEASE",
  "SALE_DISPATCH", "CUSTOMER_RETURN", "SUPPLIER_RETURN",
  "TRANSFER_IN", "TRANSFER_OUT", "ADJUSTMENT_IN", "ADJUSTMENT_OUT",
  "STOCK_COUNT_CORRECTION", "DAMAGED", "EXPIRED",
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

/** Movements that change physical stock (vs reservation-only accounting). */
export const PHYSICAL_MOVEMENTS: MovementType[] = [
  "PURCHASE_RECEIPT", "SALE_DISPATCH", "CUSTOMER_RETURN", "SUPPLIER_RETURN",
  "TRANSFER_IN", "TRANSFER_OUT", "ADJUSTMENT_IN", "ADJUSTMENT_OUT",
  "STOCK_COUNT_CORRECTION", "DAMAGED", "EXPIRED",
];

export const NOTIFICATION_SEVERITY = ["INFO", "ACTION_REQUIRED", "WARNING", "CRITICAL"] as const;

export const AUDIT_SOURCES = ["USER", "SYSTEM", "AUTOMATION", "AI", "API"] as const;

/** AI action classes (§22). C requires human approval, D never autonomous. */
export const AI_ACTION_LEVELS = ["A_READ", "B_DRAFT", "C_APPROVAL_REQUIRED", "D_RESTRICTED"] as const;

export const ACTIVE_CUSTOMER = "ACTIVE";
export const DEFAULT_CURRENCY = "EUR";
export const DEFAULT_LOCALE = "en";

/** Pure permission check — safe to use in UI, services, tests and (later) AI tools. */
export function hasPermission(
  user: { permissions: readonly string[] } | null | undefined,
  perm: Permission,
): boolean {
  return !!user && user.permissions.includes(perm);
}
