/** Skeleton matching the Personal Evolution bento grid. */
export default function Loading() {
  return (
    <div className="bleed space-y-6" aria-busy="true" aria-label="Loading progress">
      <div className="flex items-end justify-between"><div className="space-y-2"><div className="skeleton h-8 w-64" /><div className="skeleton h-4 w-80" /></div><div className="skeleton h-9 w-56 rounded-full" /></div>
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="card h-96 lg:col-span-8"><div className="skeleton h-3 w-40" /><div className="skeleton mt-3 h-14 w-24" /><div className="skeleton mt-6 h-56 w-full" /></div>
        <div className="card h-96 lg:col-span-4"><div className="skeleton mx-auto mt-6 size-48 rounded-full" /></div>
        {[0, 1, 2].map((k) => <div key={k} className="card h-56 lg:col-span-4"><div className="skeleton h-3 w-32" /><div className="skeleton mt-3 h-12 w-28" /><div className="skeleton mt-6 h-3 w-full" /></div>)}
        <div className="card h-64 lg:col-span-8" /><div className="card h-64 lg:col-span-4" />
      </div>
    </div>
  );
}
