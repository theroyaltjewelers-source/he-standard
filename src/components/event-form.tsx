"use client";

import { useActionState, useMemo, useState } from "react";
import { saveEvent, type EventState } from "@/app/actions/events";
import { humanMinutes } from "@/lib/scheduling";
import { ACCOUNTABILITY_LEVELS, ACTIVITY_KINDS, type AccountabilityLevel, type ActivityKind } from "@/lib/types";

export interface EventFormValues {
  id?: string;
  title: string;
  date: string;
  time: string;
  duration: number;
  all_day: boolean;
  location: string;
  notes: string;
  importance: "normal" | "high";
  prep_minutes: number;
  travel_minutes: number;
  offsets: number[];
  recurrence: "none" | "daily" | "weekly" | "monthly";
  recurrence_until: string;
  confirmed: boolean;
  kind?: ActivityKind;
  accountability?: AccountabilityLevel;
}

const OFFSETS = [15, 30, 60, 120, 1440];

function minus(time: string, minutes: number) {
  const [h, m] = time.split(":").map(Number);
  let t = h * 60 + m - minutes;
  const dayBefore = t < 0;
  t = ((t % 1440) + 1440) % 1440;
  const hh = Math.floor(t / 60), mm = t % 60;
  return `${hh % 12 === 0 ? 12 : hh % 12}:${String(mm).padStart(2, "0")} ${hh >= 12 ? "PM" : "AM"}${dayBefore ? " (day before)" : ""}`;
}

export function EventForm({ initial }: { initial: EventFormValues }) {
  const [state, action, pending] = useActionState<EventState, FormData>(saveEvent, undefined);
  const [time, setTime] = useState(initial.time);
  const [prep, setPrep] = useState(initial.prep_minutes);
  const [travel, setTravel] = useState(initial.travel_minutes);
  const [allDay, setAllDay] = useState(initial.all_day);
  const [recurrence, setRecurrence] = useState(initial.recurrence);
  const [importance, setImportance] = useState(initial.importance);
  const [kind, setKind] = useState<ActivityKind>(initial.kind ?? "appointment");
  const [level, setLevel] = useState<AccountabilityLevel>(initial.accountability ?? "light");
  const [levelTouched, setLevelTouched] = useState(!!initial.id);
  const [needsPrep, setNeedsPrep] = useState<"unset" | "yes" | "no">(initial.id ? (initial.prep_minutes || initial.travel_minutes ? "yes" : "no") : "unset");

  const plan = useMemo(() => {
    if (!time || allDay) return null;
    return { prepAt: minus(time, prep + travel), leaveAt: minus(time, travel), start: minus(time, 0) };
  }, [time, prep, travel, allDay]);

  return (
    <form action={action} className="space-y-8">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      <fieldset>
        <legend className="label">Type</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup">
          {ACTIVITY_KINDS.map((k) => (
            <button type="button" role="radio" aria-checked={kind === k.key} key={k.key} className="chip" data-on={kind === k.key}
              onClick={() => { setKind(k.key); if (!levelTouched) setLevel(k.defaultAccountability); }}>{k.label}</button>
          ))}
        </div>
        <input type="hidden" name="kind" value={kind} />
      </fieldset>
      <div>
        <label className="label" htmlFor="title">What</label>
        <input id="title" name="title" required maxLength={200} defaultValue={initial.title} className="field" placeholder="e.g. Client consultation" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="date">Date</label>
          <input id="date" type="date" name="date" required defaultValue={initial.date} className="field" />
        </div>
        <div>
          <label className="label" htmlFor="time">Starts</label>
          <input id="time" type="time" name="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={allDay} className="field" />
        </div>
        <div>
          <label className="label" htmlFor="duration">Length</label>
          <select id="duration" name="duration" defaultValue={String(initial.duration)} disabled={allDay} className="field">
            {[15, 30, 45, 60, 90, 120, 180, 240].map((m) => <option key={m} value={m}>{humanMinutes(m)}</option>)}
          </select>
        </div>
        <label className="flex items-end gap-2 pb-3 text-ivory-dim">
          <input type="checkbox" name="all_day" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="size-5 accent-emerald" /> All day
        </label>
      </div>
      <div>
        <label className="label" htmlFor="location">Where</label>
        <input id="location" name="location" defaultValue={initial.location} className="field" maxLength={300} />
      </div>

      {!allDay && (
        <fieldset className="space-y-4 rounded-[18px] border border-line p-4">
          <legend className="px-1 h-section">Preparation and travel</legend>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-ivory-dim">Does this need preparation or travel time?</span>
            <button type="button" className="chip" data-on={needsPrep === "yes"} onClick={() => setNeedsPrep("yes")}>Yes</button>
            <button type="button" className="chip" data-on={needsPrep === "no"} onClick={() => { setNeedsPrep("no"); setPrep(0); setTravel(0); }}>No</button>
          </div>
          {needsPrep === "unset" && <p className="text-sm text-brass">Answer this so departure and preparation reminders are right.</p>}
          <input type="hidden" name="prep_answered" value={needsPrep === "unset" ? "" : "1"} />
          {needsPrep === "no" && <><input type="hidden" name="prep_minutes" value={0} /><input type="hidden" name="travel_minutes" value={0} /></>}
          {needsPrep === "yes" && <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor="prep">Preparation (min)</label>
              <input id="prep" type="number" min={0} max={600} step={5} name="prep_minutes" value={prep} onChange={(e) => setPrep(Number(e.target.value) || 0)} className="field" />
            </div>
            <div>
              <label className="label" htmlFor="travel">Travel (min)</label>
              <input id="travel" type="number" min={0} max={600} step={5} name="travel_minutes" value={travel} onChange={(e) => setTravel(Number(e.target.value) || 0)} className="field" />
            </div>
          </div>}
          {plan && (
            <ol className="space-y-1 text-[0.95rem]">
              {prep > 0 && <li><span className="inline-block w-28 text-ivory-dim">{plan.prepAt}</span>Start preparing</li>}
              {travel > 0 && <li><span className="inline-block w-28 text-ivory-dim">{plan.leaveAt}</span>Leave</li>}
              <li><span className="inline-block w-28 text-ivory-dim">{plan.start}</span>Arrive and begin</li>
            </ol>
          )}
          <p className="text-sm text-ivory-faint">You&apos;ll get a notification when it&apos;s time to start preparing and when it&apos;s time to leave.</p>
          {importance === "high" && (
            <label className="flex items-center gap-2 text-ivory-dim">
              <input type="checkbox" name="confirm_plan" defaultChecked={initial.confirmed} className="size-5 accent-emerald" /> I confirm this plan
            </label>
          )}
        </fieldset>
      )}

      {!allDay && (
        <fieldset className="space-y-2">
          <legend className="h-section mb-2">Accountability</legend>
          <p className="text-sm text-ivory-faint">What happens around the start and end. Unanswered check-ins are recorded as awaiting confirmation — never as missed.</p>
          {ACCOUNTABILITY_LEVELS.map((l) => (
            <label key={l.key} className={`flex cursor-pointer gap-3 rounded-[14px] border p-3 transition-colors ${level === l.key ? "border-lime" : "border-line hover:border-line-strong"}`}>
              <input type="radio" name="accountability" value={l.key} checked={level === l.key} onChange={() => { setLevel(l.key); setLevelTouched(true); }} className="mt-1 accent-[var(--color-lime)]" />
              <span><span className="block">{l.label}</span><span className="block text-sm text-ivory-dim">{l.desc}</span></span>
            </label>
          ))}
        </fieldset>
      )}

      <fieldset className="space-y-3">
        <legend className="h-section mb-2">Reminders</legend>
        <div className="flex flex-wrap gap-2">
          {OFFSETS.map((m) => (
            <label key={m} className="chip cursor-pointer has-checked:border-emerald has-checked:bg-emerald-deep has-checked:text-ivory">
              <input type="checkbox" name="offsets" value={m} defaultChecked={initial.offsets.includes(m)} className="sr-only" />
              {humanMinutes(m)} before
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2 text-ivory-dim">
          <input type="checkbox" checked={importance === "high"} onChange={(e) => setImportance(e.target.checked ? "high" : "normal")} className="size-5 accent-emerald" />
          Important — also remind me at 7 PM the evening before
        </label>
        <input type="hidden" name="importance" value={importance} />
      </fieldset>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="recurrence">Repeats</label>
          <select id="recurrence" name="recurrence" value={recurrence} onChange={(e) => setRecurrence(e.target.value as EventFormValues["recurrence"])} className="field">
            <option value="none">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
          </select>
        </div>
        {recurrence !== "none" && (
          <div>
            <label className="label" htmlFor="until">Until (optional)</label>
            <input id="until" type="date" name="recurrence_until" defaultValue={initial.recurrence_until} className="field" />
          </div>
        )}
      </div>

      <div>
        <label className="label" htmlFor="notes">Notes</label>
        <textarea id="notes" name="notes" defaultValue={initial.notes} className="field min-h-20" />
      </div>

      {state?.conflicts && state.conflicts.length > 0 && (
        <div role="alert" className="space-y-2 rounded-[18px] border border-brass/60 bg-brass-deep/40 p-4">
          <p className="font-medium text-brass">This overlaps with your schedule</p>
          <ul className="list-disc space-y-1 pl-5 text-sm">{state.conflicts.map((c) => <li key={c}>{c}</li>)}</ul>
          <label className="flex items-center gap-2 text-sm text-ivory-dim"><input type="checkbox" name="ack_conflicts" className="accent-[var(--color-lime)]" /> Keep it anyway</label>
        </div>
      )}
      {state?.error && <p role="alert" className="text-brass">{state.error}</p>}
      <button className="btn btn-primary w-full" disabled={pending} data-state={pending ? "loading" : undefined}>{pending ? "Saving…" : initial.id ? "Save changes" : `Add ${ACTIVITY_KINDS.find((k) => k.key === kind)!.label.toLowerCase()}`}</button>
    </form>
  );
}
