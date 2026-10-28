"use client";

import { useActionState, useRef, useState } from "react";
import { createCommitment, type ActionState } from "@/app/actions/tasks";

/** Make a promise on the record: what, by when, to whom. */
export function CommitmentForm({ date }: { date: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<ActionState, FormData>(async (p, f) => {
    const r = await createCommitment(p, f);
    if (r?.ok) { ref.current?.reset(); setOpen(false); }
    return r;
  }, undefined);
  if (!open) return <button className="btn btn-quiet w-full" onClick={() => setOpen(true)}>Give your word on something</button>;
  return (
    <form ref={ref} action={action} className="space-y-3 rounded-[14px] border border-line p-4">
      <input type="hidden" name="date" value={date} />
      <input name="title" className="field" placeholder="I will…" aria-label="Commitment" maxLength={200} autoFocus required />
      <div className="grid grid-cols-2 gap-2">
        <label className="text-sm text-ivory-dim">Done by<input type="time" name="time" className="field mt-1" required /></label>
        <label className="text-sm text-ivory-dim">Promised to<input name="made_to" className="field mt-1" placeholder="Myself" maxLength={80} /></label>
      </div>
      {state?.error && <p role="alert" className="text-sm text-brass">{state.error}</p>}
      <div className="flex gap-2">
        <button className="btn btn-primary flex-1" disabled={pending} data-state={pending ? "loading" : undefined}>{pending ? "Recording…" : "Put it on record"}</button>
        <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
