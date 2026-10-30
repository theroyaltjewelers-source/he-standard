"use client";

import { useEffect } from "react";

/**
 * Shown instead of a blank crash screen when a page in the app fails.
 * Journal writing is backed up on this device as you type, so reopening the
 * form brings it back.
 */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="serif text-2xl">Something went wrong on this page.</h1>
      <p className="mt-3 text-ivory-dim">
        Nothing you were writing in Reflection is lost — it is kept on this device and comes back when you open the form again.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <button type="button" className="btn btn-primary" onClick={() => retry()}>Try again</button>
        <a href="/today" className="btn btn-quiet">Go to Today</a>
      </div>
      {error.digest && <p className="mt-6 text-xs text-ivory-faint">Reference: {error.digest}</p>}
    </div>
  );
}
