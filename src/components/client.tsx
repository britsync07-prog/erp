"use client";

import { useActionState, useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/server/platform";
import { ErrorText } from "./ui";

export function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
    >
      {pending ? (pendingLabel ?? "Saving…") : label}
    </button>
  );
}

/**
 * Server actions passed from Server Components to Client Components must be
 * direct `"use server"` references — inline closures and `.bind()` results are
 * not serializable. Pass the action plus its primitive arguments instead:
 *   <ConfirmAction action={submitPOAction} args={[po.id]} …>
 */
export type ActionArg = string | number | boolean | null | undefined;
/**
 * `never[]` params make the prop accept any server-action signature
 * (params are contravariant), so concrete actions like
 * `(id: string, active: boolean) => …` are assignable. Arguments arrive via
 * the separate serializable `args` prop and are cast back at the call site.
 */
export type BoundAction = (...args: never[]) => Promise<ActionResult>;

function callBound(action: BoundAction, args: ActionArg[] | undefined): Promise<ActionResult> {
  return (action as unknown as (...a: ActionArg[]) => Promise<ActionResult>)(...(args ?? []));
}

/** Button that runs a server action after a confirm dialog. Shows errors inline. */
export function ConfirmAction({
  action,
  args,
  confirmText,
  children,
  danger,
}: {
  action: BoundAction;
  args?: ActionArg[];
  confirmText: string;
  children: React.ReactNode;
  danger?: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(confirmText)) return;
          setError(null);
          start(async () => {
            const r = await callBound(action, args);
            if (!r.ok) setError(r.error ?? "Action failed.");
          });
        }}
        className={`rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
          danger ? "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200 hover:bg-red-100" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
        }`}
      >
        {pending ? "Working…" : children}
      </button>
      {error && <ErrorText message={error} />}
    </span>
  );
}

/** List-page search box: updates ?q= (keeps other params), debounced. */
export function SearchBox({ defaultValue, placeholder }: { defaultValue?: string; placeholder?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(defaultValue ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <input
      type="search"
      value={value}
      placeholder={placeholder ?? "Search…"}
      onChange={(e) => {
        const v = e.target.value;
        setValue(v);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          const params = new URLSearchParams(window.location.search);
          if (v) params.set("q", v);
          else params.delete("q");
          params.delete("page");
          router.replace(`${window.location.pathname}?${params.toString()}`);
        }, 350);
      }}
      className="w-64 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
    />
  );
}

interface Hit {
  group: string;
  label: string;
  sub?: string;
  link: string;
}

/** ⌘K / Ctrl+K command palette backed by /api/search (§27 + global search §26). */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
    setHits([]);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open ]);

  useEffect(() => {
    if (!open || q.trim().length < 2) return;
    const t = setTimeout(async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = (await res.json()) as { hits: Hit[] };
        setHits(data.hits);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, open ]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-500 shadow-sm hover:bg-slate-50 md:block"
      >
        Search or command… <kbd className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs">⌘K</kbd>
      </button>
    );
  }

  const groups = [...new Set(hits.map((h) => h.group))];
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4" onClick={close}>
      <div className="mt-20 w-full max-w-xl overflow-hidden rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            const v = e.target.value;
            setQ(v);
            if (v.trim().length < 2) setHits([]);
          }}
          placeholder="Search products, orders, customers…"
          className="w-full border-b border-slate-200 px-4 py-3 text-sm focus:outline-none"
        />
        <div className="max-h-80 overflow-y-auto p-2">
          {hits.length === 0 && <p className="px-3 py-6 text-center text-sm text-slate-400">Type at least 2 characters to search.</p>}
          {groups.map((g) => (
            <div key={g} className="mb-2">
              <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{g}</p>
              {hits.filter((h) => h.group === g).map((h) => (
                <button
                  key={h.link}
                  type="button"
                  onClick={() => {
                    close();
                    router.push(h.link);
                  }}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100"
                >
                  <span className="font-medium text-slate-800">{h.label}</span>
                  {h.sub && <span className="text-xs text-slate-400">{h.sub}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Shared useActionState plumbing: tracks submit so edit forms can show "Saved." */
export function useFormAction(action: (prev: ActionResult, fd: FormData) => Promise<ActionResult>) {
  const initial: ActionResult = { ok: true };
  const [state, formAction] = useActionState(action, initial);
  const saved = state !== initial && state.ok;
  return { state, formAction, saved };
}

/** GET-filter select: updates a single query param, drops ?page=. */
export function QuerySelect({ name, value, options, placeholder }: {
  name: string;
  value?: string;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  const router = useRouter();
  return (
    <select
      value={value ?? ""}
      onChange={(e) => {
        const params = new URLSearchParams(window.location.search);
        if (e.target.value) params.set(name, e.target.value);
        else params.delete(name);
        params.delete("page");
        router.replace(`${window.location.pathname}?${params.toString()}`);
      }}
      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none"
    >
      <option value="">{placeholder ?? "All"}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

/** Fire-and-forget server action button (no confirm dialog). */
export function InlineAction({ action, args, children, title }: {
  action: BoundAction;
  args?: ActionArg[];
  children: React.ReactNode;
  title?: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        title={title}
        disabled={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            const r = await callBound(action, args);
            if (!r.ok) setError(r.error ?? "Action failed.");
          });
        }}
        className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-200 disabled:opacity-50"
      >
        {pending ? "…" : children}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
