import Link from "next/link";
import type { ReactNode } from "react";

// Server-safe presentational primitives. No server-only imports here so client
// components may import from this module too.

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>{children}</section>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, link }: { label: string; value: ReactNode; link?: string }) {
  const inner = (
    <>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </>
  );
  return (
    <Card className="py-4">
      {link ? <Link href={link} className="block hover:opacity-80">{inner}</Link> : inner}
    </Card>
  );
}

const PILL: Record<string, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  READY: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  PAID: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  RECEIVED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  DELIVERED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  APPROVED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  CONFIRMED: "bg-blue-50 text-blue-700 ring-blue-200",
  PROCESSING: "bg-blue-50 text-blue-700 ring-blue-200",
  DISPATCHED: "bg-blue-50 text-blue-700 ring-blue-200",
  INFO: "bg-blue-50 text-blue-700 ring-blue-200",
  SENT: "bg-blue-50 text-blue-700 ring-blue-200",
  DRAFT: "bg-slate-100 text-slate-600 ring-slate-200",
  NEW: "bg-slate-100 text-slate-600 ring-slate-200",
  OPEN: "bg-slate-100 text-slate-600 ring-slate-200",
  PENDING: "bg-slate-100 text-slate-600 ring-slate-200",
  PENDING_APPROVAL: "bg-amber-50 text-amber-800 ring-amber-200",
  WAITING_FOR_STOCK: "bg-amber-50 text-amber-800 ring-amber-200",
  ACTION_REQUIRED: "bg-amber-50 text-amber-800 ring-amber-200",
  WARNING: "bg-amber-50 text-amber-800 ring-amber-200",
  PARTIAL: "bg-amber-50 text-amber-800 ring-amber-200",
  PARTIALLY_RECEIVED: "bg-amber-50 text-amber-800 ring-amber-200",
  OVERDUE: "bg-red-50 text-red-700 ring-red-200",
  CRITICAL: "bg-red-50 text-red-700 ring-red-200",
  CANCELLED: "bg-red-50 text-red-700 ring-red-200",
  SUSPENDED: "bg-red-50 text-red-700 ring-red-200",
  ARCHIVED: "bg-slate-100 text-slate-500 ring-slate-200",
  DISCONTINUED: "bg-slate-100 text-slate-500 ring-slate-200",
  STANDARD: "bg-slate-100 text-slate-600 ring-slate-200",
};

export function StatusPill({ value }: { value: string }) {
  const cls = PILL[value] ?? "bg-slate-100 text-slate-600 ring-slate-200";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}>
      {value.replace(/_/g, " ")}
    </span>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <p className="font-medium text-slate-700">{title}</p>
      {hint && <p className="mt-1 text-sm text-slate-500">{hint}</p>}
    </div>
  );
}

export function ErrorText({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-200">
      {message}
    </p>
  );
}

export function SavedNote({ show }: { show: boolean }) {
  if (!show) return null;
  return <p className="text-sm text-emerald-700">Saved.</p>;
}

export function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            {headers.map((h) => (
              <th key={h} scope="col" className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <td className={`px-4 py-2.5 align-top ${className}`}>{children}</td>;
}

export function Pagination({ page, pages, base }: { page: number; pages: number; base: string }) {
  if (pages <= 1) return null;
  const link = (p: number, label: string, disabled = false) =>
    disabled ? (
      <span key={label} className="rounded-lg px-3 py-1.5 text-sm text-slate-300">{label}</span>
    ) : (
      <Link key={label} href={`${base}${base.includes("?") ? "&" : "?"}page=${p}`} className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
        {label}
      </Link>
    );
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
      <span>Page {page} of {pages}</span>
      <div className="flex gap-1">
        {link(page - 1, "← Prev", page <= 1)}
        {link(page + 1, "Next →", page >= pages)}
      </div>
    </div>
  );
}

export function Timeline({ events }: { events: { id: string; message: string; actorName: string | null; source: string; createdAt: Date }[] }) {
  if (events.length === 0) return <p className="text-sm text-slate-500">No activity yet.</p>;
  return (
    <ol className="space-y-3">
      {events.map((e) => (
        <li key={e.id} className="flex gap-3 text-sm">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-indigo-500" aria-hidden />
          <div>
            <p className="text-slate-800">{e.message}</p>
            <p className="text-xs text-slate-400">
              {e.createdAt.toLocaleString("en-IE")} · {e.actorName ?? "system"} · {e.source}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

// Form field primitives (no interactivity — safe for server and client use).
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-slate-50";
