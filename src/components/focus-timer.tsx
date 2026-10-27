"use client";

import { useEffect, useRef, useState } from "react";
import { endFocus, logDistraction, startFocus } from "@/app/actions/rhythm";
import { haptic } from "@/lib/haptics";
import type { FocusSession } from "@/lib/types";

const PRESETS = [25, 45, 60, 90];

function mmss(ms: number) {
  const t = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

/** Focus block with a live countdown and a one-tap distraction log. */
export function FocusTimer({ active, tasks }: { active: FocusSession | null; tasks: { id: string; title: string }[] }) {
  const [now, setNow] = useState(() => Date.now());
  const [minutes, setMinutes] = useState(25);
  const [noting, setNoting] = useState(false);
  const notified = useRef(false);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  useEffect(() => {
    if (active && now >= Date.parse(active.ends_at) && !notified.current) { notified.current = true; haptic([30, 60, 30]); }
  }, [active, now]);

  if (!active) {
    return (
      <form action={startFocus} onSubmit={() => haptic()} className="space-y-4 rounded-[14px] border border-line p-5">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Length">
          {PRESETS.map((m) => (
            <button type="button" key={m} role="radio" aria-checked={minutes === m} data-on={minutes === m} className="chip" onClick={() => setMinutes(m)}>{m} min</button>
          ))}
        </div>
        <input type="hidden" name="minutes" value={minutes} />
        <input name="intention" className="field" placeholder="What will you finish in this block?" maxLength={200} aria-label="Intention" />
        {tasks.length > 0 && (
          <select name="task_id" defaultValue="" className="field" aria-label="Task">
            <option value="">No linked task</option>
            {tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        )}
        <p className="text-sm text-ivory-faint">Before you start: phone face down, notifications for other apps off, one tab.</p>
        <button className="btn btn-primary w-full">Start {minutes}-minute focus</button>
      </form>
    );
  }

  const end = Date.parse(active.ends_at);
  const total = active.planned_minutes * 60_000;
  const left = end - now;
  const done = left <= 0;
  const pct = Math.min(100, Math.max(0, ((total - left) / total) * 100));

  return (
    <div className="space-y-5 rounded-[14px] border border-emerald/50 p-5">
      <div className="text-center">
        <p className="text-sm text-ivory-dim">{active.intention || "Focus block"}</p>
        <p className="serif mt-2 text-display tabular-nums" aria-live="off">{done ? "Done" : mmss(left)}</p>
        <div className="mt-4 h-1 rounded-full bg-surface-2"><div className="h-1 rounded-full bg-emerald transition-[width] duration-1000" style={{ width: `${pct}%` }} /></div>
        <p className="mt-2 text-xs text-ivory-faint">{active.distractions.length} distraction{active.distractions.length === 1 ? "" : "s"} logged</p>
      </div>
      {!done && (noting ? (
        <form action={async (f) => { await logDistraction(f); setNoting(false); }} className="flex gap-2">
          <input type="hidden" name="id" value={active.id} />
          <input name="note" className="field" placeholder="What pulled you away?" autoFocus maxLength={200} aria-label="Distraction" />
          <button className="btn btn-quiet">Log</button>
        </form>
      ) : (
        <button className="btn btn-quiet w-full" onClick={() => { haptic(); setNoting(true); }}>I got distracted</button>
      ))}
      <form action={endFocus} className="space-y-2">
        <input type="hidden" name="id" value={active.id} />
        {done && <input name="note" className="field" placeholder="What did you finish? (optional)" maxLength={300} aria-label="Note" />}
        <div className="flex gap-2">
          <button name="status" value="completed" className="btn btn-primary flex-1">{done ? "Record session" : "Finished early"}</button>
          {!done && <button name="status" value="abandoned" className="btn btn-quiet">Stop</button>}
        </div>
      </form>
    </div>
  );
}
