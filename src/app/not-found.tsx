import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-sm font-medium uppercase tracking-wide text-slate-400">404</p>
        <h1 className="mt-1 text-xl font-semibold">We could not find that page</h1>
        <p className="mt-2 text-sm text-slate-500">
          The link may be out of date, or the record may have been removed.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Link
            href="/"
            className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-800"
          >
            Go to dashboard
          </Link>
          <Link
            href="/search"
            className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200"
          >
            Search
          </Link>
        </div>
      </div>
    </main>
  );
}