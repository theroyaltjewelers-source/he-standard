"use client";

import { useActionState } from "react";
import { addProgress, createHabit, saveGoal, type GoalState } from "@/app/actions/goals";
import { GOAL_AREAS, type Goal } from "@/lib/types";

export function GoalForm({ goal, parents }: { goal?: Goal; parents: { id: string; title: string }[] }) {
  const [state, action, pending] = useActionState<GoalState, FormData>(saveGoal, undefined);
  return (
    <form action={action} className="space-y-6">
      {goal && <input type="hidden" name="id" value={goal.id} />}
      <div>
        <label className="label" htmlFor="title">Goal</label>
        <input id="title" name="title" required maxLength={200} defaultValue={goal?.title} className="field" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="horizon">Horizon</label>
          <select id="horizon" name="horizon" defaultValue={goal?.horizon ?? "long_term"} className="field">
            <option value="long_term">Long-term</option><option value="monthly">Monthly milestone</option><option value="weekly">Weekly objective</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="area">Area</label>
          <select id="area" name="area" defaultValue={goal?.area ?? "general"} className="field">
            {GOAL_AREAS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="label" htmlFor="desired_outcome">Specific desired outcome</label>
        <textarea id="desired_outcome" name="desired_outcome" required defaultValue={goal?.desired_outcome} className="field min-h-20" placeholder="What exactly will be true when this is done?" />
      </div>
      <div>
        <label className="label" htmlFor="success_criteria">Measurable success criteria</label>
        <textarea id="success_criteria" name="success_criteria" required defaultValue={goal?.success_criteria} className="field min-h-20" placeholder="A number, a date, a deliverable someone else could check." />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="target_date">Target date</label>
          <input id="target_date" type="date" name="target_date" defaultValue={goal?.target_date ?? ""} className="field" />
        </div>
        {parents.length > 0 && (
          <div>
            <label className="label" htmlFor="parent">Part of</label>
            <select id="parent" name="parent_goal_id" defaultValue={goal?.parent_goal_id ?? ""} className="field">
              <option value="">Nothing</option>
              {parents.filter((p) => p.id !== goal?.id).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </div>
        )}
      </div>
      <div>
        <label className="label" htmlFor="obstacles">Likely obstacles</label>
        <textarea id="obstacles" name="obstacles" defaultValue={goal?.obstacles ?? ""} className="field min-h-20" />
      </div>
      <div>
        <label className="label" htmlFor="recovery_plan">Recovery plan after a setback</label>
        <textarea id="recovery_plan" name="recovery_plan" defaultValue={goal?.recovery_plan ?? ""} className="field min-h-20" placeholder="When I miss, the next thing I do is…" />
      </div>
      {state?.error && <p role="alert" className="text-brass">{state.error}</p>}
      <button className="btn btn-primary w-full" disabled={pending} data-state={pending ? "loading" : undefined}>{pending ? "Saving…" : goal ? "Save goal" : "Create goal"}</button>
    </form>
  );
}

export function ProgressForm({ goalId }: { goalId: string }) {
  const [state, action, pending] = useActionState<GoalState, FormData>(addProgress, undefined);
  return (
    <form action={action} className="space-y-3 rounded-[14px] border border-line p-4">
      <input type="hidden" name="goal_id" value={goalId} />
      <textarea name="note" required className="field min-h-20" placeholder="What moved forward, or what got in the way?" aria-label="Progress note" />
      <div className="grid grid-cols-[1fr_7rem] gap-3">
        <input name="evidence" className="field" placeholder="Evidence (link, document, result)" aria-label="Evidence" />
        <input name="progress_pct" type="number" min={0} max={100} className="field" placeholder="%" aria-label="Overall progress percent" />
      </div>
      {state?.error && <p role="alert" className="text-sm text-brass">{state.error}</p>}
      {state?.ok && <p role="status" className="text-sm text-emerald">Logged.</p>}
      <button className="btn btn-quiet" disabled={pending} data-state={pending ? "loading" : undefined}>Log progress</button>
    </form>
  );
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function HabitForm({ goals }: { goals: { id: string; title: string }[] }) {
  const [state, action, pending] = useActionState<GoalState, FormData>(createHabit, undefined);
  return (
    <form action={action} className="space-y-4 rounded-[14px] border border-line p-4">
      <input name="title" required maxLength={160} className="field" placeholder="New habit, e.g. Fajr on time" aria-label="Habit" />
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm text-ivory-dim">Days per week
          <select name="target_per_week" defaultValue="7" className="field mt-1">{[1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n}>{n}</option>)}</select>
        </label>
        <label className="text-sm text-ivory-dim">Area
          <select name="area" defaultValue="general" className="field mt-1">{GOAL_AREAS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}</select>
        </label>
        {goals.length > 0 && (
          <label className="col-span-2 text-sm text-ivory-dim">Supports goal
            <select name="goal_id" defaultValue="" className="field mt-1"><option value="">None</option>{goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}</select>
          </label>
        )}
      </div>
      <fieldset>
        <legend className="mb-2 text-sm text-ivory-dim">Planned rest days</legend>
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map((d, i) => (
            <label key={d} className="chip cursor-pointer has-checked:border-emerald has-checked:bg-emerald-deep has-checked:text-ivory">
              <input type="checkbox" name="rest_days" value={i} className="sr-only" />{d}
            </label>
          ))}
        </div>
      </fieldset>
      {state?.error && <p role="alert" className="text-sm text-brass">{state.error}</p>}
      <button className="btn btn-quiet" disabled={pending} data-state={pending ? "loading" : undefined}>Add habit</button>
    </form>
  );
}
