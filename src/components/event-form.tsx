"use client";

import { useActionState, useMemo, useState } from "react";
import { saveEvent, type EventState } from "@/app/actions/events";
import { humanMinutes } from "@/lib/scheduling";

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

  const plan = useMemo(() => {
    if (!time || allDay) return null;
    return { prepAt: minus(time, prep + travel), leaveAt: minus(time, travel), start: minus(time, 0) };
  }, [time, prep, travel, allDay]);

  return (
    <form action={action} className="space-y-8">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
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
        <fieldset className="space-y-4 rounded-[14px] border border-line p-4">
          <legend className="px-1 h-section">Preparation and travel</legend>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor="prep">Preparation (min)</label>
              <input id="prep" type="number" min={0} max={600} step={5} name="prep_minutes" value={prep} onChange={(e) => setPrep(Number(e.target.value) || 0)} className="field" />
            </div>
            <div>
              <label className="label" htmlFor="travel">Travel (min)</label>
              <input id="travel" type="number" min={0} max={600} step={5} name="travel_minutes" value={travel} onChange={(e) => setTravel(Number(e.target.value) || 0)} className="field" />
            </div>
          </div>
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

      {state?.error && <p role="alert" className="text-brass">{state.error}</p>}
      <button className="btn btn-primary w-full" disabled={pending}>{pending ? "Saving…" : initial.id ? "Save changes" : "Add appointment"}</button>
    </form>
  );
}
