"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { commitmentAction, confirmPrayerTimeline, occurrenceAction, previewMove, taskAction, type TimelineResult } from "@/app/actions/timeline";
import { haptic } from "@/lib/haptics";
import { toast } from "@/components/ui/toast";
import type { ItemState, TimelineItem } from "@/lib/timeline";
import { TaskDetailPanel } from "@/components/task-detail";

/* ------------------------------- formatting ------------------------------- */

function fmtTime(iso: string, tz: string) {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
}
/** "YYYY-MM-DDTHH:mm" in the user's time zone (for datetime-local inputs and server actions). */
function localInput(d: Date, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
function minutesOfDay(iso: string, tz: string) {
  const [h, m] = new Date(iso).toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).split(":").map(Number);
  return h * 60 + m;
}

const STATE: Record<ItemState, { label: string; dot: string; text: string }> = {
  upcoming: { label: "Upcoming", dot: "border border-ivory-faint", text: "text-ivory-faint" },
  active: { label: "Now", dot: "bg-lime shadow-[0_0_0_4px_color-mix(in_oklab,var(--color-lime)_22%,transparent)]", text: "text-accent" },
  completed: { label: "Done", dot: "bg-emerald", text: "text-emerald" },
  late: { label: "Done late", dot: "bg-emerald/60", text: "text-emerald" },
  awaiting: { label: "Awaiting confirmation", dot: "border-2 border-brass", text: "text-brass" },
  skipped: { label: "Skipped", dot: "bg-brass", text: "text-brass" },
  rescheduled: { label: "Rescheduled", dot: "border border-dashed border-ivory-faint", text: "text-ivory-faint" },
  excused: { label: "Excused", dot: "bg-ivory-faint", text: "text-ivory-faint" },
};
const TYPE_LABEL: Record<string, string> = { event: "", buffer: "Buffer", task: "Task", commitment: "Commitment", prayer: "Prayer", focus: "Focus", checkin: "Check-in" };
const KIND_LABEL: Record<string, string> = { appointment: "Appointment", workout: "Workout", call: "Call", deadline: "Deadline", routine: "Routine", obligation: "Obligation", focus_block: "Focus block" };

/* --------------------------------- actions -------------------------------- */

type Runner = (fn: () => Promise<TimelineResult>, onConflict?: (conflicts: string[]) => void) => void;

function useRunner(): [boolean, Runner] {
  const [pending, start] = useTransition();
  const run: Runner = (fn, onConflict) => start(async () => {
    const r = await fn();
    if (r.conflicts?.length) { onConflict?.(r.conflicts); return; }
    if (r.error) { toast({ text: r.error, tone: "error" }); return; }
    haptic(12);
    toast({ text: r.message ?? "Saved" });
  });
  return [pending, run];
}

function ActionPanel({ item, tz, date, initialMode, onClose }: { item: TimelineItem; tz: string; date: string; initialMode?: string | null; onClose: () => void }) {
  const [pending, run] = useRunner();
  const [mode, setMode] = useState<null | "skip" | "excuse" | "reschedule" | "note" | "complete">((initialMode as "skip" | "reschedule") ?? null);
  const [text, setText] = useState("");
  const [to, setTo] = useState(() => localInput(new Date(Math.max(Date.parse(item.start) + 60 * 60_000, Date.now() + 30 * 60_000)), tz));
  const [conflicts, setConflicts] = useState<string[] | null>(null);
  const [duration, setDuration] = useState<string>("");
  const [wtype, setWtype] = useState("other");
  const [intensity, setIntensity] = useState<string>("");
  const resolved = ["completed", "late", "skipped", "rescheduled", "excused"].includes(item.state);
  const [details, setDetails] = useState(false);
  const isPast = date < localInput(new Date(), tz).slice(0, 10);
  const [actualTime, setActualTime] = useState(() => localInput(new Date(item.start), tz).slice(11, 16));
  const isWorkout = item.kind === "workout";
  const coachQ = encodeURIComponent(`Help me with "${item.title}" at ${fmtTime(item.start, tz)}.`);

  const ev = (type: Parameters<typeof occurrenceAction>[0]["type"], extra: Partial<Parameters<typeof occurrenceAction>[0]> = {}, ack = false) =>
    run(() => occurrenceAction({ eventId: item.ref, start: item.occStart!, type, ...extra, ack }), (c) => setConflicts(c));
  const task = (type: Parameters<typeof taskAction>[0]["type"], extra: Partial<Parameters<typeof taskAction>[0]> = {}, ack = false) =>
    run(() => taskAction({ id: item.ref, type, ...extra, ack }), (c) => setConflicts(c));
  const com = (type: Parameters<typeof commitmentAction>[0]["type"], extra: Partial<Parameters<typeof commitmentAction>[0]> = {}, ack = false) =>
    run(() => commitmentAction({ id: item.ref, type, ...extra, ack }), (c) => setConflicts(c));

  const reschedule = (ack = false) => {
    if (item.type === "event") ev("reschedule", { to }, ack);
    else if (item.type === "task") task("reschedule", { to }, ack);
    else com("reschedule", { to }, ack);
  };

  const btn = "chip disabled:opacity-50";
  return (
    <div className="mt-3 space-y-3 rounded-[18px] border border-line bg-surface-2/60 p-3" aria-busy={pending}>
      {item.type === "event" && !resolved && (
        <div className="flex flex-wrap gap-2">
          {!item.meta?.started && <button className={btn} disabled={pending} onClick={() => ev("start")}>Start</button>}
          <button className={btn} disabled={pending} onClick={() => (isWorkout ? setMode(mode === "complete" ? null : "complete") : ev("complete", isPast ? { actualTime } : {}))}>Complete</button>
          <button className={btn} disabled={pending} onClick={() => ev("late", { minutes: 15 })}>Running late</button>
          <button className={btn} disabled={pending} onClick={() => setMode(mode === "reschedule" ? null : "reschedule")}>Reschedule</button>
          <button className={btn} disabled={pending} onClick={() => setMode(mode === "skip" ? null : "skip")}>Skip…</button>
          <button className={btn} disabled={pending} onClick={() => setMode(mode === "excuse" ? null : "excuse")}>Excused…</button>
          <button className={btn} disabled={pending} onClick={() => setMode(mode === "note" ? null : "note")}>Note</button>
        </div>
      )}
      {item.type === "event" && resolved && item.state !== "rescheduled" && (
        <div className="flex flex-wrap gap-2">
          <button className={btn} disabled={pending} onClick={() => ev("reopen")}>Undo outcome</button>
          <button className={btn} disabled={pending} onClick={() => setMode(mode === "note" ? null : "note")}>Note</button>
        </div>
      )}
      {details && item.type === "task" && <TaskDetailPanel id={item.ref} tz={tz} onClose={() => setDetails(false)} />}
      {isPast && !resolved && ["event", "task", "commitment"].includes(item.type) && (
        <div className="rounded-[12px] bg-surface-3/60 p-2.5 text-xs text-ivory-dim">
          <p>You&apos;re recording this after the day ended. It will be saved as <b>reported later</b> — with the time it happened and the time you reported it.</p>
          <label className="mt-2 flex items-center gap-2">When did it happen?
            <input type="time" value={actualTime} onChange={(e) => setActualTime(e.target.value)} className="field max-w-32 py-1" aria-label="Actual time" />
          </label>
        </div>
      )}
      {item.type === "task" && (
        <button className="chip" onClick={() => setDetails(true)} aria-haspopup="dialog">Details & history</button>
      )}
      {item.type === "task" && !resolved && (
        <div className="flex flex-wrap gap-2">
          <button className={btn} disabled={pending} onClick={() => task("complete", isPast ? { actualTime } : {})}>Complete</button>
          <button className={btn} disabled={pending} onClick={() => task("delay", { minutes: 30 })}>Delay 30 min</button>
          <button className={btn} disabled={pending} onClick={() => setMode(mode === "reschedule" ? null : "reschedule")}>Reschedule</button>
          <button className={btn} disabled={pending} onClick={() => setMode(mode === "skip" ? null : "skip")}>Not doing it…</button>
          <button className={btn} disabled={pending} onClick={() => setMode(mode === "note" ? null : "note")}>Note</button>
        </div>
      )}
      {item.type === "commitment" && !resolved && (
        <div className="flex flex-wrap gap-2">
          <button className={btn} disabled={pending} onClick={() => com("complete", isPast ? { actualTime } : {})}>Kept</button>
          <button className={btn} disabled={pending} onClick={() => com("delay", { minutes: 30 })}>Delay 30 min</button>
          <button className={btn} disabled={pending} onClick={() => setMode(mode === "reschedule" ? null : "reschedule")}>Reschedule</button>
          <button className={btn} disabled={pending} onClick={() => setMode(mode === "skip" ? null : "skip")}>Not kept…</button>
          <button className={btn} disabled={pending} onClick={() => setMode(mode === "excuse" ? null : "excuse")}>Released…</button>
        </div>
      )}
      {item.type === "prayer" && item.state !== "completed" && (
        <button className="btn btn-primary" disabled={pending} data-state={pending ? "loading" : undefined} onClick={() => run(() => confirmPrayerTimeline(item.ref, date))}>I prayed {item.title}</button>
      )}
      {item.type === "checkin" && <Link href={item.href!} className="btn btn-primary">{item.state === "completed" ? "Review" : "Open"} {item.title.toLowerCase()}</Link>}
      {item.type === "focus" && <Link href="/rhythm" className="btn btn-quiet">Open Rhythm</Link>}

      {mode === "complete" && (
        <form className="grid grid-cols-2 gap-2 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); ev("complete", { durationMinutes: duration ? Number(duration) : undefined, workoutType: wtype as "other", intensity: intensity ? Number(intensity) : undefined, notes: text || undefined, ...(isPast ? { actualTime } : {}) }); }}>
          <label className="text-xs text-ivory-dim">Minutes<input type="number" min={1} max={600} value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="auto" className="field mt-1" aria-label="Workout minutes" /></label>
          <label className="text-xs text-ivory-dim">Type
            <select value={wtype} onChange={(e) => setWtype(e.target.value)} className="field mt-1" aria-label="Workout type">
              {["strength", "cardio", "mobility", "sport", "recovery", "other"].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="text-xs text-ivory-dim">Intensity
            <select value={intensity} onChange={(e) => setIntensity(e.target.value)} className="field mt-1"><option value="">—</option>{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select>
          </label>
          <button className="btn btn-primary self-end" disabled={pending} data-state={pending ? "loading" : undefined}>Save workout</button>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Details (optional)" className="field col-span-2 sm:col-span-4" aria-label="Workout details" />
        </form>
      )}
      {(mode === "skip" || mode === "excuse") && (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (item.type === "event") ev(mode, { reason: text }); else if (item.type === "task") task("skip", { reason: text }); else com(mode, { reason: text }); }}>
          <input value={text} onChange={(e) => setText(e.target.value)} autoFocus className="field" aria-label="Reason"
            placeholder={mode === "excuse" ? "Who released you, or what changed?" : item.type === "commitment" ? "What happened immediately before?" : "Why isn't it happening?"} />
          <button className="btn btn-quiet shrink-0" disabled={pending || !text.trim()} data-state={pending ? "loading" : undefined}>Record</button>
        </form>
      )}
      {mode === "note" && (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (item.type === "event") ev("note", { notes: text }); else task("note", { notes: text }); }}>
          <input value={text} onChange={(e) => setText(e.target.value)} autoFocus className="field" aria-label="Note" placeholder={String(item.meta?.notes ?? "Add a note")} />
          <button className="btn btn-quiet shrink-0" disabled={pending}>Save</button>
        </form>
      )}
      {mode === "reschedule" && (
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); setConflicts(null); reschedule(false); }}>
          <input type="datetime-local" value={to} onChange={(e) => { setTo(e.target.value); setConflicts(null); }} className="field max-w-64" aria-label="New time" />
          <button className="btn btn-quiet" disabled={pending} data-state={pending ? "loading" : undefined}>Move</button>
          <p className="w-full text-xs text-ivory-faint">The original time stays on your record.</p>
        </form>
      )}
      {conflicts && (
        <div role="alert" className="space-y-2 rounded-[14px] border border-brass/60 bg-brass-deep/40 p-3 text-sm">
          <p className="font-medium text-brass">That time overlaps:</p>
          <ul className="list-disc pl-5">{conflicts.map((c) => <li key={c}>{c}</li>)}</ul>
          <div className="flex gap-2">
            <button className="chip" disabled={pending} onClick={() => { setConflicts(null); reschedule(true); }}>Keep it anyway</button>
            <button className="chip" onClick={() => setConflicts(null)}>Pick another time</button>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between text-xs">
        <Link href={`/coach?q=${coachQ}`} className="text-accent hover:underline">Ask the Coach about this</Link>
        <button onClick={onClose} className="text-ivory-faint hover:text-ivory-dim">Close</button>
      </div>
    </div>
  );
}

/* ------------------------------- list view ------------------------------- */

function Row({ item, tz, date, open, onToggle, initialMode }: { item: TimelineItem; tz: string; date: string; open: boolean; onToggle: () => void; initialMode?: string | null }) {
  const st = STATE[item.state];
  const actionable = item.type !== "buffer";
  const muted = item.state === "rescheduled" || item.state === "excused" || item.type === "buffer";
  return (
    <li id={item.type === "event" ? `occ-${item.ref}` : undefined} className="relative grid grid-cols-[3.4rem_1rem_1fr] gap-x-1.5 scroll-mt-24 sm:grid-cols-[3.9rem_1.25rem_1fr] sm:gap-x-2">
      <time className="pt-3 text-right text-[0.8rem] tabular text-ivory-faint" dateTime={item.start}>{item.meta?.allDay ? "All day" : fmtTime(item.start, tz)}</time>
      <div className="relative flex justify-center">
        <span aria-hidden className="absolute inset-y-0 w-px bg-line" />
        <span aria-hidden className={`relative mt-[1.05rem] size-2.5 rounded-full bg-ground ${st.dot}`} />
      </div>
      <div className={`min-w-0 py-2 ${item.type === "buffer" ? "py-1" : ""}`}>
        <button
          disabled={!actionable}
          onClick={onToggle}
          aria-expanded={open}
          className={`group w-full rounded-[14px] px-3 py-2 text-left transition-colors ${actionable ? "hover:bg-surface-2" : ""} ${open ? "bg-surface-2" : ""}`}
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className={`line-clamp-2 ${muted ? "text-ivory-dim" : ""} ${item.type === "buffer" ? "text-sm" : "font-medium"} ${item.state === "rescheduled" ? "line-through decoration-ivory-faint" : ""}`}>{item.title}</span>
            {item.type !== "buffer" && <span className={`shrink-0 text-[0.7rem] sm:text-xs ${st.text}`}>{item.state === "awaiting" && item.type === "prayer" ? "Not confirmed" : st.label}</span>}
          </div>
          <p className="truncate text-xs text-ivory-faint">
            {[item.type === "event" ? KIND_LABEL[item.kind ?? "appointment"] : TYPE_LABEL[item.type], item.end && item.type !== "prayer" && !item.meta?.allDay ? `until ${fmtTime(item.end, tz)}` : null, item.meta?.delay ? `${item.meta.delay} min late` : null, item.subtitle].filter(Boolean).join(" · ")}
          </p>
        </button>
        {open && actionable && <ActionPanel item={item} tz={tz} date={date} initialMode={initialMode} onClose={onToggle} />}
      </div>
    </li>
  );
}

/* ------------------------------ canvas view ------------------------------ */

const HOUR = 60; // px per hour
const SNAP = 15;

function Canvas({ items, tz, date, nowIso }: { items: TimelineItem[]; tz: string; date: string; nowIso: string }) {
  const timed = items.filter((i) => !i.meta?.allDay && i.type !== "buffer");
  const mins = timed.map((i) => minutesOfDay(i.start, tz));
  const startHour = Math.max(0, Math.min(6, ...mins.map((m) => Math.floor(m / 60))));
  const endHour = Math.min(24, Math.max(23, ...mins.map((m) => Math.ceil(m / 60) + 1)));
  const height = (endHour - startHour) * HOUR;
  const [drag, setDrag] = useState<{ id: string; dy: number; y0: number } | null>(null);
  const [proposal, setProposal] = useState<{ item: TimelineItem; to: string; conflicts: string[] | null } | null>(null);
  const [pending, run] = useRunner();
  const nowMin = date === localInput(new Date(nowIso), tz).slice(0, 10) ? minutesOfDay(nowIso, tz) : null;

  const top = (iso: string) => ((minutesOfDay(iso, tz) - startHour * 60) / 60) * HOUR;
  const len = (i: TimelineItem) => (i.end ? Math.max(24, ((Date.parse(i.end) - Date.parse(i.start)) / 3_600_000) * HOUR) : 26);

  // Overlapping items share the row side by side (lanes), so nothing hides another.
  const lanes = (() => {
    const px = timed.map((i) => ({ id: i.id, a: top(i.start), b: top(i.start) + len(i) })).sort((x, y) => x.a - y.a || x.b - y.b);
    const out = new Map<string, { lane: number; of: number }>();
    let cluster: { id: string; lane: number }[] = [], laneEnds: number[] = [], clusterEnd = -1;
    const flush = () => { for (const c of cluster) out.set(c.id, { lane: c.lane, of: laneEnds.length }); cluster = []; laneEnds = []; };
    for (const r of px) {
      if (r.a >= clusterEnd) flush();
      let lane = laneEnds.findIndex((e) => e <= r.a);
      if (lane < 0) { lane = laneEnds.length; laneEnds.push(r.b); } else laneEnds[lane] = r.b;
      cluster.push({ id: r.id, lane });
      clusterEnd = Math.max(clusterEnd, r.b);
    }
    flush();
    return out;
  })();

  async function drop(item: TimelineItem, dy: number) {
    const deltaMin = Math.round((dy / HOUR) * 60 / SNAP) * SNAP;
    if (!deltaMin) return;
    const to = localInput(new Date(Date.parse(item.start) + deltaMin * 60_000), tz);
    setProposal({ item, to, conflicts: null });
    const dur = item.end ? Math.round((Date.parse(item.end) - Date.parse(item.start)) / 60_000) : 15;
    const r = await previewMove({ to, durationMinutes: dur, ignoreEventId: item.type === "event" ? item.ref : null });
    setProposal({ item, to, conflicts: r.conflicts });
  }

  function confirm() {
    if (!proposal) return;
    const { item, to } = proposal;
    const fn = item.type === "event" ? () => occurrenceAction({ eventId: item.ref, start: item.occStart!, type: "reschedule", to, ack: true })
      : item.type === "task" ? () => taskAction({ id: item.ref, type: "reschedule", to, ack: true })
      : () => commitmentAction({ id: item.ref, type: "reschedule", to, ack: true });
    run(fn);
    setProposal(null);
  }

  return (
    <div className="bleed">
      <p className="mb-2 text-xs text-ivory-faint">Drag an upcoming item to move it (15-minute steps). You&apos;ll see any conflicts before anything is saved. On a phone or with a keyboard, use Reschedule in the list view.</p>
      <div className="relative select-none overflow-hidden rounded-[22px] border border-line bg-surface" style={{ height }}>
        {Array.from({ length: endHour - startHour }, (_, k) => (
          <div key={k} className="absolute inset-x-0 border-t border-line/70" style={{ top: k * HOUR }}>
            <span className="absolute left-2 top-1 text-[0.7rem] tabular text-ivory-faint">{new Date(2000, 0, 1, startHour + k).toLocaleTimeString("en-US", { hour: "numeric" })}</span>
          </div>
        ))}
        {nowMin !== null && nowMin >= startHour * 60 && nowMin <= endHour * 60 && (
          <div aria-hidden className="absolute inset-x-0 z-10 h-px bg-lime" style={{ top: ((nowMin - startHour * 60) / 60) * HOUR }}>
            <span className="absolute -top-1 left-12 size-2 rounded-full bg-lime" />
          </div>
        )}
        {timed.map((i) => {
          const isDrag = drag?.id === i.id;
          const st = STATE[i.state];
          const color = i.type === "prayer" ? "border-violet/50 bg-violet/15" : i.kind === "workout" ? "border-lime/50 bg-lime-deep" : i.type === "checkin" ? "border-line-strong bg-surface-2" : i.type === "commitment" ? "border-sky/50 bg-sky/10" : i.type === "task" ? "border-line-strong bg-surface-3" : "border-emerald/40 bg-emerald-deep";
          return (
            <div
              key={i.id}
              role={i.draggable ? "button" : undefined}
              aria-label={i.draggable ? `${i.title} at ${fmtTime(i.start, tz)}. Drag to move.` : undefined}
              className={`absolute overflow-hidden rounded-[12px] border px-2.5 py-1 text-xs transition-shadow ${color} ${i.draggable ? "cursor-grab touch-none active:cursor-grabbing" : ""} ${isDrag ? "z-20 shadow-[0_18px_40px_-12px_rgb(0_0_0/0.7)] ring-1 ring-lime" : ""} ${i.state === "rescheduled" ? "opacity-50" : ""}`}
              style={{ top: top(i.start) + (isDrag ? drag.dy : 0), height: len(i), ...(() => { const l = lanes.get(i.id) ?? { lane: 0, of: 1 }; return { left: `calc(3.5rem + (100% - 4rem) * ${l.lane / l.of})`, width: `calc((100% - 4rem) / ${l.of} - ${l.of > 1 ? 2 : 0}px)` }; })() }}
              onPointerDown={(e) => { if (!i.draggable) return; (e.target as HTMLElement).setPointerCapture(e.pointerId); setDrag({ id: i.id, dy: 0, y0: e.clientY }); }}
              onPointerMove={(e) => { if (!isDrag) return; const step = HOUR / (60 / SNAP); const dy = Math.round((e.clientY - drag.y0) / step) * step; setDrag({ ...drag, dy }); }}
              onPointerUp={(e) => { if (!isDrag) return; const step = HOUR / (60 / SNAP); const dy = Math.round((e.clientY - drag.y0) / step) * step; setDrag(null); void drop(i, dy); }}
              onPointerCancel={() => setDrag(null)}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-medium text-ivory">{i.title}</span>
                <span className={`shrink-0 ${st.text}`}>{isDrag ? fmtTime(new Date(Date.parse(i.start) + Math.round((drag.dy / HOUR) * 60) * 60_000).toISOString(), tz) : fmtTime(i.start, tz)}</span>
              </div>
            </div>
          );
        })}
      </div>
      {proposal && (
        <div role="dialog" aria-label="Confirm move" className="toast-in fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-40 mx-auto max-w-md space-y-3 rounded-[22px] border border-line-strong bg-surface-2 p-4 shadow-2xl lg:bottom-8">
          <p className="font-medium">Move “{proposal.item.title}” to {new Date(`${proposal.to}:00`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}?</p>
          {proposal.conflicts === null ? <p className="text-sm text-ivory-faint">Checking your schedule…</p>
            : proposal.conflicts.length ? <div className="text-sm text-brass"><p>Overlaps:</p><ul className="list-disc pl-5">{proposal.conflicts.map((c) => <li key={c}>{c}</li>)}</ul></div>
            : <p className="text-sm text-emerald">No conflicts.</p>}
          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={pending || proposal.conflicts === null} data-state={pending ? "loading" : undefined} onClick={confirm}>{proposal.conflicts?.length ? "Move anyway" : "Move"}</button>
            <button className="btn btn-quiet" onClick={() => setProposal(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* --------------------------------- root ---------------------------------- */

export function CommandCenter({ items, tz, date, nowIso, focusOcc, focusMode }: { items: TimelineItem[]; tz: string; date: string; nowIso: string; focusOcc?: string | null; focusMode?: string | null }) {
  const [view, setView] = useState<"list" | "canvas">("list");
  const initialOpen = useMemo(() => {
    if (!focusOcc) return null;
    const [id, ms] = focusOcc.split(".");
    return items.find((i) => i.type === "event" && i.ref === id && String(i.occStart) === ms)?.id ?? null;
  }, [focusOcc, items]);
  const [open, setOpen] = useState<string | null>(initialOpen);
  const scrolled = useRef(false);
  useEffect(() => {
    if (scrolled.current) return;
    scrolled.current = true;
    if (initialOpen) document.getElementById(`occ-${initialOpen.slice(3).split(":")[0]}`)?.scrollIntoView({ block: "center" });
  }, [initialOpen]);

  const counts = useMemo(() => {
    const actionable = items.filter((i) => i.type !== "buffer" && i.type !== "focus");
    return { done: actionable.filter((i) => i.state === "completed" || i.state === "late").length, total: actionable.filter((i) => i.state !== "rescheduled" && i.state !== "excused").length, awaiting: actionable.filter((i) => i.state === "awaiting").length };
  }, [items]);

  return (
    <section aria-labelledby="tl-h" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="tl-h" className="h-section">Today&apos;s timeline</h2>
          <p className="text-xs text-ivory-faint tabular">{counts.done} of {counts.total} done{counts.awaiting ? ` · ${counts.awaiting} awaiting confirmation` : ""}</p>
        </div>
        <div className="seg" role="tablist" aria-label="View">
          <button role="tab" aria-selected={view === "list"} data-on={view === "list"} onClick={() => setView("list")}>List</button>
          <button role="tab" aria-selected={view === "canvas"} data-on={view === "canvas"} onClick={() => setView("canvas")}>Day</button>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="card text-center text-ivory-dim">Nothing scheduled. <Link href={`/plan/new?date=${date}`} className="text-accent hover:underline">Add an activity</Link></div>
      ) : view === "list" ? (
        <ol className="card px-2 py-2 sm:px-3">
          {items.map((i) => (
            <Row key={i.id} item={i} tz={tz} date={date} open={open === i.id} onToggle={() => setOpen(open === i.id ? null : i.id)} initialMode={i.id === initialOpen ? focusMode : null} />
          ))}
        </ol>
      ) : (
        <Canvas items={items} tz={tz} date={date} nowIso={nowIso} />
      )}
    </section>
  );
}
