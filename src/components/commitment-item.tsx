"use client";

import { useActionState, useState, type ReactNode } from "react";
import { resolveCommitment, type ActionState } from "@/app/actions/tasks";
import type { Commitment } from "@/lib/types";

const LABEL: Record<Commitment["status"], string> = {
  open: "Open", kept: "Kept", kept_late: "Kept late", broken: "Not kept", released: "Released",
};

export function CommitmentItem({ c, time, overdue, children }: { c: Commitment; time: string | null; overdue: boolean; children?: ReactNode }) {
  const [mode, setMode] = useState<null | "kept" | "kept_late" | "broken" | "released">(null);
  const [state, action, pending] = useActionState<ActionState, FormData>(async (p, f) => {
    const r = await resolveCommitment(p, f);
    if (r?.ok) setMode(null);
    return r;
  }, undefined);
  const resolved = c.status !== "open";

  return (
    <li className="py-4">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={`mt-2 size-2.5 shrink-0 rounded-full ${c.status === "kept" ? "bg-emerald" : c.status === "kept_late" ? "bg-emerald/60" : c.status === "broken" ? "bg-brass" : c.status === "released" ? "bg-ivory-faint" : overdue ? "border border-brass" : "border border-ivory-dim"}`}
        />
        <div className="min-w-0 flex-1">
          <p className={`serif text-lg leading-snug ${resolved && c.status !== "kept" && c.status !== "kept_late" ? "text-ivory-dim" : ""}`}>{c.title}</p>
          <p className="mt-0.5 text-sm text-ivory-faint">
            {time ? `By ${time}` : "No time set"}
            {c.made_to !== "self" && `, promised to ${c.made_to}`}
            {resolved && <span className="text-ivory-dim">. {LABEL[c.status]}{c.verification === "evidence" ? ", with evidence" : c.verification === "self_reported" ? ", self-reported" : ""}</span>}
            {!resolved && overdue && <span className="text-brass">. Past the promised time</span>}
          </p>
          {c.evidence && <p className="mt-1 text-sm text-ivory-dim">Evidence: {c.evidence}</p>}
          {c.failure_context && <p className="mt-1 text-sm text-ivory-dim">Before it slipped: {c.failure_context}</p>}
          {children}
        </div>
      </div>

      {!resolved && !mode && (
        <div className="mt-3 flex flex-wrap gap-2 pl-5">
          <button className="chip" onClick={() => setMode(overdue ? "kept_late" : "kept")}>{overdue ? "Kept, late" : "Kept"}</button>
          {overdue && <button className="chip" onClick={() => setMode("kept")}>Kept on time</button>}
          <button className="chip" onClick={() => setMode("broken")}>Not kept</button>
          <button className="chip" onClick={() => setMode("released")}>Released by agreement</button>
        </div>
      )}
      {resolved && (
        <form action={action} className="mt-2 pl-5">
          <input type="hidden" name="id" value={c.id} />
          <input type="hidden" name="status" value="open" />
          <button className="text-xs text-ivory-faint hover:text-ivory-dim" disabled={pending}>Undo</button>
        </form>
      )}

      {mode && (
        <form action={action} className="mt-3 space-y-3 rounded-[14px] bg-surface p-4">
          <input type="hidden" name="id" value={c.id} />
          <input type="hidden" name="status" value={mode} />
          {(mode === "kept" || mode === "kept_late") && (
            <div>
              <label className="label" htmlFor={`ev-${c.id}`}>Evidence (optional, but it counts for more)</label>
              <input id={`ev-${c.id}`} name="evidence" className="field" placeholder="e.g. Sent the proposal at 2:40, filed in Drive" />
            </div>
          )}
          {mode === "broken" && (
            <div>
              <label className="label" htmlFor={`fc-${c.id}`}>What happened immediately before?</label>
              <textarea id={`fc-${c.id}`} name="failure_context" className="field min-h-20" required placeholder="Where you were, what you were doing, what you felt." />
            </div>
          )}
          {mode === "released" && (
            <p className="text-sm text-ivory-dim">Use this only when the other person agreed to cancel or the commitment genuinely no longer applies. Released items aren&apos;t scored.</p>
          )}
          {state?.error && <p role="alert" className="text-sm text-brass">{state.error}</p>}
          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : "Record"}</button>
            <button type="button" className="btn btn-quiet" onClick={() => setMode(null)}>Cancel</button>
          </div>
        </form>
      )}
    </li>
  );
}
