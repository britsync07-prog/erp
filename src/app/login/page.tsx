"use client";

import { useActionState } from "react";
import { login } from "@/server/actions/auth";
import { ErrorText } from "@/components/ui";
import { inputCls } from "@/components/ui";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, { ok: true });

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-2xl font-bold tracking-tight">Doner<span className="text-indigo-700">ERP</span></p>
        <p className="mt-1 text-sm text-slate-500">Sign in to your distribution workspace.</p>
        <form action={formAction} className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Email</span>
            <input name="email" type="email" required autoComplete="username" className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Password</span>
            <input name="password" type="password" required autoComplete="current-password" className={inputCls} />
          </label>
          <ErrorText message={state.error} />
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-indigo-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
          >
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="mt-4 text-xs text-slate-400">Demo login: admin@demo.local / ChangeMe123!</p>
      </div>
    </main>
  );
}
