"use client";

import { useActionState, useRef } from "react";
import { createTask, type ActionState } from "@/app/actions/tasks";

export function QuickTask({ date, goals = [] }: { date: string; goals?: { id: string; title: string }[] }) {
  const ref = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<ActionState, FormData>(createTask, undefined);
  return (
    <form ref={ref} action={action} className="space-y-2">
      <input type="hidden" name="scheduled_for" value={date} />
      <div className="flex gap-2">
        <input name="title" required maxLength={200} className="field" placeholder="Add a task" aria-label="New task" />
        <button className="btn btn-quiet shrink-0" disabled={pending} data-state={pending ? "loading" : undefined}>Add</button>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-ivory-faint">Deadline, repeat, priority, goal</summary>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="text-ivory-dim">Due by<input type="time" name="due_time" className="field mt-1" /></label>
          <label className="text-ivory-dim">Repeats
            <select name="repeat" defaultValue="none" className="field mt-1">
              <option value="none">Does not repeat</option><option value="daily">Every day</option><option value="weekdays">Weekdays</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
            </select>
          </label>
          <label className="text-ivory-dim">Importance
            <select name="priority" defaultValue="2" className="field mt-1"><option value="1">High</option><option value="2">Normal</option><option value="3">Low</option></select>
          </label>
          {goals.length > 0 && (
            <label className="col-span-2 text-ivory-dim">Supports goal
              <select name="goal_id" defaultValue="" className="field mt-1"><option value="">None</option>{goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}</select>
            </label>
          )}
          <label className="col-span-2 flex items-center gap-2 text-ivory-dim"><input type="checkbox" name="is_top_priority" className="size-4 accent-emerald" /> One of the day&apos;s three priorities</label>
        </div>
      </details>
      {state?.error && <p role="alert" className="text-sm text-brass">{state.error}</p>}
    </form>
  );
}
