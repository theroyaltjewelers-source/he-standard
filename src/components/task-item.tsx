"use client";

import { useState, useTransition } from "react";
import { completeTask, deleteTask, missTask, postponeTask, setTaskDone, toggleTopPriority } from "@/app/actions/tasks";
import { haptic } from "@/lib/haptics";
import { toast } from "@/components/ui/toast";
import type { Task } from "@/lib/types";

export function TaskItem({ t, dueLabel, overdue, tomorrow, showDate }: {
  t: Task; dueLabel: string | null; overdue: boolean; tomorrow: string; showDate?: string | null;
}) {
  const [open, setOpen] = useState<null | "done" | "missed" | "move">(null);
  const [pending, start] = useTransition();
  const [justDone, setJustDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = t.status === "done";
  const missed = t.status === "missed";

  function toggle() {
    const next = !(done || missed);
    setError(null);
    start(async () => {
      const r = await setTaskDone(t.id, next);
      if (r.error) { setError(r.error); toast({ text: `Not saved: ${r.error}`, tone: "error" }); return; }
      if (next) {
        setJustDone(true);
        haptic(12);
        toast({ text: "Marked done", action: { label: "Undo", run: async () => { await setTaskDone(t.id, false); setJustDone(false); } } });
      } else setJustDone(false);
    });
  }

  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          aria-busy={pending}
          aria-pressed={done}
          aria-label={done ? `Mark “${t.title}” not done` : `Mark “${t.title}” done`}
          className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-[7px] border transition-colors duration-200 ${done ? "border-emerald bg-emerald text-ground" : missed ? "border-brass" : "border-ivory-faint hover:border-ivory-dim"} ${justDone && done ? "pop" : ""}`}
        >
          {pending ? <span className="size-3 animate-spin rounded-full border-2 border-current border-r-transparent text-ivory-dim" aria-hidden />
            : done && <svg className={justDone ? "check-draw" : ""} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden><path d="M5 12.5l4 4 10-10" /></svg>}
        </button>
        <div className="min-w-0 flex-1">
          <button onClick={() => setOpen(open ? null : done || missed ? null : "done")} className={`text-left ${done ? "text-ivory-dim line-through decoration-ivory-faint" : missed ? "text-ivory-dim" : ""}`}>
            {t.is_top_priority && <span className="mr-1.5 text-emerald" aria-label="Priority">●</span>}
            {t.title}
          </button>
          <p className="text-xs text-ivory-faint">
            {[
              showDate,
              dueLabel && `due ${dueLabel}`,
              overdue && !done && !missed ? "overdue" : null,
              t.postponed_count > 0 ? `postponed ${t.postponed_count}×` : null,
              done ? (t.verification === "evidence" ? "done, with evidence" : "done, self-reported") : null,
              missed ? "not done" : null,
            ].filter(Boolean).join(", ")}
          </p>
          {t.evidence && <p className="text-xs text-ivory-dim">Evidence: {t.evidence}</p>}
          {t.miss_reason && <p className="text-xs text-ivory-dim">Reason: {t.miss_reason}</p>}
          {error && <p role="alert" className="text-xs text-brass">Couldn&apos;t save: {error}</p>}
        </div>
        {t.status === "pending" && (
          <button onClick={() => setOpen(open ? null : "move")} className="text-xs text-ivory-faint hover:text-ivory-dim" aria-label="More actions">More</button>
        )}
      </div>

      {open === "done" && t.status === "pending" && (
        <form action={completeTask} className="mt-3 flex gap-2 pl-9">
          <input type="hidden" name="id" value={t.id} />
          <input name="evidence" className="field" placeholder="Evidence (optional)" aria-label="Evidence" />
          <button className="btn btn-primary shrink-0">Done</button>
        </form>
      )}
      {open === "move" && (
        <div className="mt-3 space-y-3 pl-9">
          <form action={postponeTask} className="flex gap-2">
            <input type="hidden" name="id" value={t.id} />
            <input type="date" name="to" defaultValue={tomorrow} className="field" aria-label="Move to date" />
            <button className="btn btn-quiet shrink-0">Move</button>
          </form>
          <form action={missTask} className="flex gap-2">
            <input type="hidden" name="id" value={t.id} />
            <input name="reason" className="field" placeholder="Why it didn't happen" aria-label="Reason" />
            <button className="btn btn-quiet shrink-0">Not done</button>
          </form>
          <div className="flex gap-4 text-xs">
            <form action={toggleTopPriority}><input type="hidden" name="id" value={t.id} /><button className="text-ivory-dim hover:text-ivory">{t.is_top_priority ? "Remove from priorities" : "Make a priority"}</button></form>
            <form action={deleteTask}><input type="hidden" name="id" value={t.id} /><button className="text-ivory-faint hover:text-ivory-dim" onClick={(e) => { if (!confirm("Delete this task? Deleting removes it from your record; marking it not done keeps an honest history.")) e.preventDefault(); }}>Delete</button></form>
          </div>
        </div>
      )}
    </li>
  );
}
