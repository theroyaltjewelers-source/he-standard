/** Real loading state for the food log (never the empty state while data loads). */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading food log">
      <div className="mb-6 space-y-2"><div className="skeleton h-8 w-28" /><div className="skeleton h-4 w-44" /></div>
      <div className="mb-5 flex items-center gap-2"><div className="skeleton size-11 rounded-full" /><div className="skeleton h-5 w-32" /><div className="skeleton size-11 rounded-full" /></div>
      <div className="flex items-center justify-between"><div className="skeleton h-4 w-20" /><div className="skeleton h-11 w-28 rounded-full" /></div>
      <div className="mt-4 space-y-2">{[0, 1, 2].map((k) => <div key={k} className="card flex gap-3 !py-3.5"><div className="skeleton h-4 w-14" /><div className="flex-1 space-y-2"><div className="skeleton h-4 w-3/4" /><div className="skeleton h-3 w-1/3" /></div></div>)}</div>
    </div>
  );
}
