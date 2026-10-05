export default function AppLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-64 animate-pulse rounded-lg bg-slate-200" />
      <div className="h-64 animate-pulse rounded-xl bg-slate-200" />
    </div>
  );
}
