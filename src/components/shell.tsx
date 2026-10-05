import Link from "next/link";
import { hasPermission } from "@/server/auth/permissions";
import type { SessionUser } from "@/server/auth/session";
import { unreadCount } from "@/server/services/platformRead";
import { pendingApprovalsCount, canSeeApprovals } from "@/server/services/approvals";
import { logout } from "@/server/actions/auth";
import { CommandPalette } from "./client";
import type { Permission } from "@/domain/constants";

interface NavItem {
  href: string;
  label: string;
  perm?: Permission;
  section: "Operate" | "Inventory" | "Procurement" | "Fulfilment" | "Finance" | "Intelligence" | "System";
  approvalGate?: boolean;
}

const NAV: NavItem[] = [
  { href: "/", label: "Home", section: "Operate" },
  { href: "/orders", label: "Orders", perm: "orders.view", section: "Operate" },
  { href: "/customers", label: "Customers", perm: "customers.view", section: "Operate" },
  { href: "/suppliers", label: "Suppliers", perm: "suppliers.view", section: "Operate" },
  { href: "/products", label: "Products", perm: "products.view", section: "Operate" },
  { href: "/categories", label: "Categories", perm: "products.view", section: "Operate" },
  { href: "/pricing", label: "Pricing", perm: "pricing.view", section: "Operate" },
  { href: "/warehouses", label: "Warehouses", perm: "warehouses.view", section: "Operate" },
  { href: "/inventory", label: "Stock overview", perm: "inventory.view", section: "Inventory" },
  { href: "/inventory/low-stock", label: "Low stock", perm: "inventory.view", section: "Inventory" },
  { href: "/inventory/receiving", label: "Receiving", perm: "inventory.view", section: "Inventory" },
  { href: "/inventory/movements", label: "Movements", perm: "inventory.view", section: "Inventory" },
  { href: "/inventory/transfers", label: "Transfers", perm: "inventory.view", section: "Inventory" },
  { href: "/inventory/adjustments", label: "Adjustments", perm: "inventory.view", section: "Inventory" },
  { href: "/inventory/counts", label: "Counts", perm: "inventory.view", section: "Inventory" },
  { href: "/inventory/reservations", label: "Reservations", perm: "inventory.view", section: "Inventory" },
  { href: "/procurement/requirements", label: "Requirements", perm: "procurement.view", section: "Procurement" },
  { href: "/procurement", label: "Purchase orders", perm: "procurement.view", section: "Procurement" },
  { href: "/fulfilment", label: "Fulfilment", perm: "orders.view", section: "Fulfilment" },
  { href: "/fulfilment/returns", label: "Returns", perm: "orders.view", section: "Fulfilment" },
  { href: "/finance", label: "Invoices", perm: "finance.view", section: "Finance" },
  { href: "/finance/receivables", label: "Receivables", perm: "finance.view", section: "Finance" },
  { href: "/finance/credit-notes", label: "Credit notes", perm: "finance.view", section: "Finance" },
  { href: "/finance/margins", label: "Margins", perm: "finance.view", section: "Finance" },
  { href: "/intelligence", label: "Command centre", perm: "intelligence.view", section: "Intelligence" },
  { href: "/intelligence/ask", label: "Ask AI", perm: "intelligence.view", section: "Intelligence" },
  { href: "/intelligence/activity", label: "AI activity", perm: "intelligence.view", section: "Intelligence" },
  { href: "/approvals", label: "Approvals", section: "System", approvalGate: true },
  { href: "/admin/automation", label: "Automation", perm: "intelligence.manage", section: "System" },
  { href: "/users", label: "Users", perm: "users.manage", section: "System" },
  { href: "/roles", label: "Roles", perm: "roles.manage", section: "System" },
  { href: "/audit", label: "Audit log", perm: "audit.view", section: "System" },
];

export async function Shell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  const [unread, showApprovals, pending] = await Promise.all([
    unreadCount(user.orgId, user),
    canSeeApprovals(),
    pendingApprovalsCount(user.orgId),
  ]);
  const visible = NAV.filter(
    (n) => (!n.perm || hasPermission(user, n.perm)) && (!n.approvalGate || showApprovals),
  );
  const sections: ("Operate" | "Inventory" | "Procurement" | "Fulfilment" | "Finance" | "Intelligence" | "System")[] = ["Operate", "Inventory", "Procurement", "Fulfilment", "Finance", "Intelligence", "System"];

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="border-b border-slate-200 px-5 py-4">
          <p className="text-lg font-bold tracking-tight">Doner<span className="text-indigo-700">ERP</span></p>
          <p className="text-xs text-slate-400">Distribution OS</p>
        </div>
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {sections.map((s) => {
            const items = visible.filter((n) => n.section === s);
            if (items.length === 0) return null;
            return (
              <div key={s}>
                <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{s}</p>
                <ul className="space-y-0.5">
                  {items.map((n) => (
                    <li key={n.href}>
                      <Link href={n.href} className="flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
                        <span>{n.label}</span>
                        {n.href === "/approvals" && pending > 0 && (
                          <span className="rounded-full bg-amber-100 px-2 text-xs font-bold text-amber-800">{pending}</span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
        <div className="border-t border-slate-200 px-5 py-3 text-xs text-slate-500">
          <p className="truncate font-medium text-slate-700">{user.name}</p>
          <p className="truncate">{user.roleCode.replace(/_/g, " ")}</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="flex items-center gap-3 px-4 py-2.5 md:px-6">
            <Link href="/" className="font-bold md:hidden">Doner<span className="text-indigo-700">ERP</span></Link>
            <div className="md:hidden">
              <MobileNav items={visible} />
            </div>
            <div className="ml-auto flex items-center gap-2">
              <CommandPalette />
              <Link
                href="/notifications"
                className="relative rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm hover:bg-slate-50"
                aria-label="Notifications"
              >
                Alerts
                {unread > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 rounded-full bg-red-600 px-1.5 text-[11px] font-bold text-white">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </Link>
              <form action={logout}>
                <button type="submit" className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100">
                  Sign out
                </button>
              </form>
              <Link
                href="/account/password"
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm hover:bg-slate-50"
              >
                Password
              </Link>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-4 pb-2 md:hidden">
            {visible.map((n) => (
              <Link key={n.href} href={n.href} className="whitespace-nowrap rounded-lg bg-slate-100 px-3 py-1.5 text-sm">
                {n.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-6">{children}</main>
      </div>
    </div>
  );
}

function MobileNav({ items }: { items: { href: string; label: string }[] }) {
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded-lg border border-slate-300 px-3 py-1.5 text-sm">Menu</summary>
      <div className="absolute left-0 top-full z-20 mt-1 w-48 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
        {items.map((n) => (
          <Link key={n.href} href={n.href} className="block rounded-lg px-3 py-2 text-sm hover:bg-slate-100">
            {n.label}
          </Link>
        ))}
      </div>
    </details>
  );
}
