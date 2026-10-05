import Link from "next/link";

export default function AppNotFound() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <h1 className="text-lg font-semibold">Record not found.</h1>
      <p className="mt-1 text-sm text-slate-500">It may have been deleted or you followed an old link.</p>
      <Link href="/" className="mt-4 inline-block rounded-lg bg-indigo-700 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-800">
        Back to home
      </Link>
    </div>
  );
}
