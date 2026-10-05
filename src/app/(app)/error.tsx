"use client";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="rounded-xl border border-red-200 bg-white p-8 text-center shadow-sm">
      <h1 className="text-lg font-semibold">Something went wrong.</h1>
      <p className="mt-1 text-sm text-slate-500">Please try again. If it persists, contact your administrator.</p>
      <button onClick={reset} className="mt-4 rounded-lg bg-indigo-700 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-800">
        Try again
      </button>
    </div>
  );
}
