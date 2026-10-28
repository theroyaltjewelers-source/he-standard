/** Skeleton matching the Command Center layout (no layout shift when content arrives). */
export default function Loading() {
  return (
    <div className="bleed space-y-6" aria-busy="true" aria-label="Loading today">
      <div className="space-y-2"><div className="skeleton h-4 w-40" /><div className="skeleton h-8 w-72" /><div className="skeleton h-3 w-32" /></div>
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="card h-44 lg:col-span-7"><div className="skeleton h-3 w-24" /><div className="skeleton mt-3 h-7 w-56" /><div className="skeleton mt-6 h-11 w-36 rounded-full" /></div>
        <div className="card h-44 lg:col-span-5"><div className="skeleton h-3 w-24" /><div className="skeleton mt-3 h-7 w-48" /></div>
        <div className="grid grid-cols-3 gap-3 lg:col-span-7">{[0, 1, 2].map((k) => <div key={k} className="card h-20" />)}</div>
        <div className="card h-20 lg:col-span-5" />
      </div>
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="card space-y-4 lg:col-span-7">{Array.from({ length: 6 }, (_, k) => <div key={k} className="flex gap-3"><div className="skeleton h-4 w-12" /><div className="flex-1 space-y-2"><div className="skeleton h-4 w-2/3" /><div className="skeleton h-3 w-1/3" /></div></div>)}</div>
        <div className="space-y-6 lg:col-span-5"><div className="card h-48" /><div className="card h-40" /></div>
      </div>
    </div>
  );
}
