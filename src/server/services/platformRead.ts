import "server-only";
import { db } from "@/server/db";
import { assertPermission, hasPermission } from "@/server/auth/permissions";
import type { SessionUser } from "@/server/auth/session";
import { PAGE_SIZE, paged } from "./util";
import { getLowStock } from "./catalog";
import { orderStats } from "./orders";
import { procurementStats } from "./procurement";
import { receivingStats } from "./receiving";
import { fulfilmentStats } from "./fulfilment";
import { financeStats } from "./finance";
import { latestBrief } from "@/server/ai/brief";

export interface SearchHit {
  group: string;
  label: string;
  sub?: string;
  link: string;
}

/** Global search foundation (§26): products, orders, customers, suppliers, POs, invoices. */
export async function searchAll(orgId: string, rawQ: string): Promise<SearchHit[]> {
  await assertPermission("products.view");
  const q = rawQ.trim().slice(0, 80);
  if (q.length < 2) return [];
  const [products, customers, suppliers, orders, pos, invoices] = await Promise.all([
    db.product.findMany({ where: { organisationId: orgId, OR: [{ name: { contains: q } }, { sku: { contains: q } }, { barcode: { contains: q } }] }, take: 6, orderBy: { name: "asc" } }),
    db.customer.findMany({ where: { organisationId: orgId, OR: [{ company: { contains: q } }, { code: { contains: q } }] }, take: 5, orderBy: { company: "asc" } }),
    db.supplier.findMany({ where: { organisationId: orgId, OR: [{ company: { contains: q } }, { code: { contains: q } }] }, take: 5, orderBy: { company: "asc" } }),
    db.salesOrder.findMany({ where: { number: { contains: q } }, take: 4, orderBy: { createdAt: "desc" } }),
    db.purchaseOrder.findMany({ where: { number: { contains: q } }, take: 4, orderBy: { createdAt: "desc" } }),
    db.invoice.findMany({ where: { number: { contains: q } }, take: 4, orderBy: { createdAt: "desc" } }),
  ]);
  return [
    ...products.map((p): SearchHit => ({ group: "Products", label: `${p.sku} — ${p.name}`, link: `/products/${p.id}` })),
    ...orders.map((o): SearchHit => ({ group: "Orders", label: o.number, sub: o.status, link: `/orders/${o.id}` })),
    ...customers.map((c): SearchHit => ({ group: "Customers", label: `${c.code} — ${c.company}`, link: `/customers/${c.id}` })),
    ...suppliers.map((s): SearchHit => ({ group: "Suppliers", label: `${s.code} — ${s.company}`, link: `/suppliers/${s.id}` })),
    ...pos.map((p): SearchHit => ({ group: "Purchase orders", label: p.number, sub: p.status, link: `/procurement/${p.id}` })),
    ...invoices.map((i): SearchHit => ({ group: "Invoices", label: i.number, sub: i.status, link: `/finance/${i.id}` })),
  ];
}

/** Home command centre snapshot: only real, actionable figures — no filler charts. */
export async function dashboard(orgId: string, user: SessionUser) {
  const [customers, suppliers, products, users, recentActivity, unread] = await Promise.all([
    db.customer.count({ where: { organisationId: orgId, status: "ACTIVE" } }),
    db.supplier.count({ where: { organisationId: orgId, status: "ACTIVE" } }),
    db.product.count({ where: { organisationId: orgId, status: "ACTIVE" } }),
    db.user.count({ where: { organisationId: orgId, isActive: true } }),
    db.activityEvent.findMany({ where: { orgId }, orderBy: { createdAt: "desc" }, take: 8 }),
    unreadCount(orgId, user),
  ]);
  // Low-stock is a product permission-gated extra, not a home-page requirement.
  const lowStock = hasPermission(user, "products.view") ? await getLowStock(orgId, 8) : [];
  const orders = hasPermission(user, "orders.view") ? await orderStats(orgId) : { today: 0, waiting: 0, ready: 0 };
  const procurement = hasPermission(user, "procurement.view") ? await procurementStats(orgId) : { openReqs: 0, pendingPOs: 0 };
  const receiving = hasPermission(user, "inventory.view") ? await receivingStats(orgId) : { incoming: 0, overdue: 0 };
  const fulfilment = hasPermission(user, "orders.view") ? await fulfilmentStats(orgId) : { toPick: 0, toDispatch: 0, inTransit: 0 };
  const finance = hasPermission(user, "finance.view") ? await financeStats(orgId) : { outstanding: 0, overdueCount: 0 };
  const brief = hasPermission(user, "intelligence.view")
    ? await latestBrief(orgId).then((b) => (b ? { title: b.brief.title, at: b.brief.createdAt, open: b.findings.filter((f) => f.status === "OPEN").length } : null)).catch(() => null)
    : null;
  return { customers, suppliers, products, users, recentActivity, lowStock, unread, orders, procurement, receiving, fulfilment, finance, brief };
}

export async function listNotifications(orgId: string, user: SessionUser, page = 1) {
  const where = {
    orgId,
    OR: [{ userId: user.id }, { userId: null, roleCode: null }, { userId: null, roleCode: user.roleCode }],
  };
  const [total, items] = await Promise.all([
    db.notification.count({ where }),
    db.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
  ]);
  return paged(items, total, page);
}

export async function unreadCount(orgId: string, user: SessionUser) {
  return db.notification.count({
    where: {
      orgId,
      isRead: false,
      OR: [{ userId: user.id }, { userId: null, roleCode: null }, { userId: null, roleCode: user.roleCode }],
    },
  });
}

export async function markNotificationRead(orgId: string, user: SessionUser, id: string) {
  const note = await db.notification.findFirst({ where: { id, orgId } });
  if (!note) return;
  if (note.userId && note.userId !== user.id) return;
  await db.notification.update({ where: { id }, data: { isRead: true } });
}

export async function markAllNotificationsRead(orgId: string, user: SessionUser) {
  await db.notification.updateMany({
    where: {
      orgId,
      isRead: false,
      OR: [{ userId: user.id }, { userId: null, roleCode: null }, { userId: null, roleCode: user.roleCode }],
    },
    data: { isRead: true },
  });
}

export async function listAudit(orgId: string, sp?: { entity?: string; action?: string; page?: string }) {
  await assertPermission("audit.view");
  const entity = sp?.entity?.trim();
  const action = sp?.action?.trim();
  const page = Math.max(1, Number.parseInt(sp?.page ?? "1", 10) || 1);
  const where = { orgId, ...(entity ? { entityType: entity } : {}), ...(action ? { action } : {}) };
  const [total, items] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
  ]);
  return paged(items, total, page);
}
