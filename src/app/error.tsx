"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Root error boundary. Catches render failures anywhere in the app so a bug
 * shows a recoverable message instead of the browser's blank page.
 *
 * Kept deliberately plain: no stack traces or error internals reach the user.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Server-side detail is already logged by Next.js; this is the client hook.
    console.error("[app] render error", error.digest ?? error.message);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-slate-500">
          The page could not be displayed. Your data has not been changed. Please try again.
        </p>
        {error.digest && (
          <p className="mt-2 text-xs text-slate-400">
            Reference: <span className="font-mono">{error.digest}</span>
          </p>
        )}
        <div className="mt-6 flex justify-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-800"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200"
          >
            Go to dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}