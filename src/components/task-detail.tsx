"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { getTaskDetail, saveTaskNotes, setTaskDone, startTask, completeTask, toggleTopPriority, deleteTask, type TaskDetail } from "@/app/actions/tasks";
import { taskAction } from "@/app/actions/timeline";
import { haptic } from "@/lib/haptics";
import { toast } from "@/components/ui/toast";

const FIELD: Record<string, string> = {
  status: "Status", scheduled_for: "Day", due_at: "Deadline", title: "Title", notes: "Notes", priority: "Priority", is_top_priority: "Top priority",
  completed_at: "Completed", verification: "Verification", evidence: "Evidence", miss_reason: "Reason", postponed_count: "Postponed", started_at: "Started",
  original_due_at: "Original deadline", original_scheduled_for: "Original day", retrospective: "Reported later", goal_id: "Goal",
};

function fmtVal(v: unknown, tz: string) {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).toLocaleString("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}

/**
 * Task detail panel: everything about one task — schedule, deadline, goal,
 * reminders, notes, completion history — with Start, Complete and Reschedule.
 * Every action waits for the database to confirm before the UI shows success.
 */
export function TaskDetailPanel({ id, tz, onClose }: { id: string; tz: string; onClose: () => void }) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [notes, setNotes] = useState("");
  const [evidence, setEvidence] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [conflicts, setConflicts] = useState<string[] | null>(null);
  const [mode, setMode] = useState<null | "reschedule" | "skip">(null);
  const panel = useRef<HTMLDivElement>(null);

  const load = () => getTaskDetail(id).then((d) => {
    if ("error" in d) { setError(d.error); return; }
    setDetail(d); setNotes(d.task.notes ?? "");
  });
  useEffect(() => { void load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const run = (fn: () => Promise<{ ok?: true; error?: string; conflicts?: string[]; message?: string }>, success: string) => start(async () => {
    const r = await fn();
    if (r.conflicts?.length) { setConflicts(r.conflicts); return; }
    if (r.error) { toast({ text: `Not saved: ${r.error}`, tone: "error" }); return; }
    haptic(12);
    toast({ text: r.message ?? success });
    setMode(null); setConflicts(null);
    await load();
  });

  const t = detail?.task;
  const open = t?.status === "pending";
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 sm:items-stretch sm:justify-end" onClick={onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={t ? `Task: ${t.title}` : "Task"}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="toast-in max-h-[88dvh] w-full overflow-y-auto rounded-t-[28px] border border-line-strong bg-surface p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] outline-none sm:max-h-none sm:w-[440px] sm:rounded-none sm:rounded-l-[28px]"
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line-strong sm:hidden" aria-hidden />
        {error && <p role="alert" className="text-brass">{error}</p>}
        {!t && !error && <div className="space-y-3"><div className="skeleton h-6 w-2/3" /><div className="skeleton h-4 w-1/2" /><div className="skeleton h-24 w-full" /></div>}
        {t && detail && (
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="eyebrow">{detail.series ? `Repeating · ${detail.series.recurrence}` : "Task"}{t.retrospective ? " · reported later" : ""}</p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight">{t.title}</h2>
              </div>
              <button onClick={onClose} className="chip" aria-label="Close">Close</button>
            </div>

            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-xs text-ivory-faint">Status</dt><dd className={t.status === "done" ? "text-emerald" : t.status === "missed" ? "text-brass" : ""}>{t.status === "pending" ? (t.started_at ? "In progress" : "Open") : t.status === "done" ? "Done" : t.status === "missed" ? "Not done" : t.status}</dd></div>
              <div><dt className="text-xs text-ivory-faint">Day</dt><dd>{t.scheduled_for ?? "Someday"}{t.original_scheduled_for && t.original_scheduled_for !== t.scheduled_for ? <span className="text-ivory-faint"> (was {t.original_scheduled_for})</span> : null}</dd></div>
              <div><dt className="text-xs text-ivory-faint">Deadline</dt><dd>{fmtVal(t.due_at, tz)}{t.original_due_at && t.original_due_at !== t.due_at ? <span className="block text-xs text-ivory-faint">original {fmtVal(t.original_due_at, tz)}</span> : null}</dd></div>
              <div><dt className="text-xs text-ivory-faint">Priority</dt><dd>{t.is_top_priority ? "Top priority" : ["", "High", "Normal", "Low"][t.priority]}</dd></div>
              <div className="col-span-2"><dt className="text-xs text-ivory-faint">Goal</dt><dd>{detail.goal ?? "—"}</dd></div>
              {t.completed_at && <div className="col-span-2"><dt className="text-xs text-ivory-faint">Completed</dt><dd>{fmtVal(t.completed_at, tz)}{t.retrospective && t.confirmed_at ? <span className="block text-xs text-ivory-faint">reported {fmtVal(t.confirmed_at, tz)} — after the day ended</span> : null}</dd></div>}
              {t.evidence && <div className="col-span-2"><dt className="text-xs text-ivory-faint">Evidence</dt><dd>{t.evidence}</dd></div>}
              {t.miss_reason && <div className="col-span-2"><dt className="text-xs text-ivory-faint">Reason</dt><dd>{t.miss_reason}</dd></div>}
            </dl>

            {open && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {!t.started_at && <button className="chip" disabled={pending} onClick={() => run(() => startTask(t.id), "Started")}>Start</button>}
                  <button className="chip" disabled={pending} onClick={() => setMode(mode === "reschedule" ? null : "reschedule")}>Reschedule</button>
                  <button className="chip" disabled={pending} onClick={() => setMode(mode === "skip" ? null : "skip")}>Not doing it…</button>
                  <button className="chip" disabled={pending} onClick={() => run(async () => { const f = new FormData(); f.set("id", t.id); await toggleTopPriority(f); return { ok: true }; }, t.is_top_priority ? "Removed from priorities" : "Made a priority")}>{t.is_top_priority ? "Remove priority" : "Make a priority"}</button>
                </div>
                <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(async () => { const f = new FormData(); f.set("id", t.id); f.set("evidence", evidence); await completeTask(f); return { ok: true }; }, "Marked done"); }}>
                  <input value={evidence} onChange={(e) => setEvidence(e.target.value)} className="field" placeholder="Evidence (optional)" aria-label="Evidence" />
                  <button className="btn btn-primary shrink-0" disabled={pending} data-state={pending ? "loading" : undefined}>Complete</button>
                </form>
                {mode === "reschedule" && (
                  <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (to) run(() => taskAction({ id: t.id, type: "reschedule", to }), "Moved"); }}>
                    <input type="datetime-local" value={to} onChange={(e) => { setTo(e.target.value); setConflicts(null); }} className="field max-w-64" aria-label="New time" required />
                    <button className="btn btn-quiet" disabled={pending}>Move</button>
                    <p className="w-full text-xs text-ivory-faint">The original day and deadline stay on record.</p>
                  </form>
                )}
                {mode === "skip" && (
                  <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(() => taskAction({ id: t.id, type: "skip", reason }), "Recorded as not done"); }}>
                    <input value={reason} onChange={(e) => setReason(e.target.value)} className="field" placeholder="Why isn't it happening?" aria-label="Reason" required />
                    <button className="btn btn-quiet shrink-0" disabled={pending || !reason.trim()}>Record</button>
                  </form>
                )}
                {conflicts && (
                  <div role="alert" className="space-y-2 rounded-[14px] border border-brass/60 bg-brass-deep/40 p-3 text-sm">
                    <p className="font-medium text-brass">That time overlaps:</p>
                    <ul className="list-disc pl-5">{conflicts.map((c) => <li key={c}>{c}</li>)}</ul>
                    <button className="chip" onClick={() => run(() => taskAction({ id: t.id, type: "reschedule", to, ack: true }), "Moved")}>Keep it anyway</button>
                  </div>
                )}
              </div>
            )}
            {!open && (
              <button className="chip" disabled={pending} onClick={() => run(() => setTaskDone(t.id, false), "Reopened")}>Reopen</button>
            )}

            <div>
              <label className="label" htmlFor="task-notes">Notes</label>
              <textarea id="task-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="field min-h-20" />
              {notes !== (t.notes ?? "") && <button className="chip mt-2" disabled={pending} onClick={() => run(() => saveTaskNotes(t.id, notes), "Notes saved")}>Save notes</button>}
            </div>

            <section>
              <h3 className="text-sm text-ivory-dim">Reminders</h3>
              {detail.reminders.length ? (
                <ul className="mt-1 space-y-1 text-sm">{detail.reminders.map((r, i) => <li key={i} className="flex justify-between gap-3"><span>{fmtVal(r.send_at, tz)}</span><span className="text-xs text-ivory-faint">{r.status}</span></li>)}</ul>
              ) : <p className="text-sm text-ivory-faint">{t.due_at ? "No reminders pending." : "Add a deadline (Reschedule) to get reminders."}</p>}
            </section>

            {detail.seriesHistory.length > 1 && (
              <section>
                <h3 className="text-sm text-ivory-dim">Recent days</h3>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {detail.seriesHistory.slice().reverse().map((h) => (
                    <span key={h.date} title={`${h.date}: ${h.status}${h.retrospective ? " (reported later)" : ""}`} className={`grid size-7 place-items-center rounded-[8px] text-[0.65rem] tabular ${h.status === "done" ? "bg-emerald text-ground" : h.status === "missed" ? "bg-brass text-ground" : "border border-line-strong text-ivory-faint"}`}>{h.date.slice(8)}</span>
                  ))}
                </div>
                <p className="mt-1 text-xs text-ivory-faint">Open days without an outcome are unknown — not counted as missed.</p>
              </section>
            )}

            <section>
              <h3 className="text-sm text-ivory-dim">History</h3>
              {detail.history.length ? (
                <ol className="mt-1 space-y-2 border-l border-line pl-3 text-xs">
                  {detail.history.map((h, i) => (
                    <li key={i}>
                      <p className="text-ivory-dim">{fmtVal(h.at, tz)} · {h.actor} · {h.op === "insert" ? "created" : h.op === "delete" ? "deleted" : "changed"}</p>
                      {h.op === "update" && <ul className="text-ivory-faint">{h.changes.map((c) => <li key={c.field}>{FIELD[c.field] ?? c.field}: {fmtVal(c.from, tz)} → {fmtVal(c.to, tz)}</li>)}</ul>}
                    </li>
                  ))}
                </ol>
              ) : <p className="text-sm text-ivory-faint">No changes recorded yet.</p>}
            </section>

            <form action={async (f) => { if (!confirm("Delete this task? Marking it not done keeps an honest record; deleting removes it.")) return; await deleteTask(f); onClose(); }}>
              <input type="hidden" name="id" value={t.id} />
              <button className="text-xs text-ivory-faint hover:text-ivory-dim">Delete task</button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
