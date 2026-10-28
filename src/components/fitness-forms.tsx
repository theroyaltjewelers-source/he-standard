"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteBodyMetric, deleteWorkout, logBodyMetric, logWorkout, type WorkoutInput } from "@/app/actions/fitness";
import { toast } from "@/components/ui/toast";

type SetRow = { reps: string; weight: string; minutes: string; km: string };
type ExRow = { name: string; sets: SetRow[] };
const blankSet = (): SetRow => ({ reps: "", weight: "", minutes: "", km: "" });
const n = (v: string) => (v.trim() === "" || Number.isNaN(Number(v)) ? null : Number(v));
const TYPES = [["strength", "Strength"], ["cardio", "Cardio"], ["mobility", "Mobility"], ["sport", "Sport"], ["recovery", "Recovery"], ["other", "Other"]] as const;

/** Log a session: type, duration, effort, then any number of exercises with sets. */
export function WorkoutForm({ today, unit: initialUnit, recent }: { today: string; unit: "lb" | "kg"; recent: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [type, setType] = useState<WorkoutInput["workout_type"]>("strength");
  const [unit, setUnit] = useState(initialUnit);
  const [date, setDate] = useState(today);
  const [duration, setDuration] = useState("");
  const [intensity, setIntensity] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [exercises, setExercises] = useState<ExRow[]>([{ name: "", sets: [blankSet()] }]);
  const [error, setError] = useState<string | null>(null);
  const cardio = type === "cardio";

  const updEx = (i: number, f: (e: ExRow) => ExRow) => setExercises((xs) => xs.map((x, k) => (k === i ? f(x) : x)));
  const updSet = (i: number, j: number, key: keyof SetRow, v: string) => updEx(i, (e) => ({ ...e, sets: e.sets.map((s, k) => (k === j ? { ...s, [key]: v } : s)) }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const payload: WorkoutInput = {
      performed_on: date, workout_type: type, duration_minutes: n(duration), intensity, notes: notes.trim() || null, unit,
      exercises: exercises.filter((x) => x.name.trim()).map((x) => ({
        name: x.name,
        sets: x.sets.map((s) => ({ reps: n(s.reps), weight: n(s.weight), duration_seconds: n(s.minutes) === null ? null : n(s.minutes)! * 60, distance_m: n(s.km) === null ? null : n(s.km)! * 1000, rpe: null })),
      })),
    };
    start(async () => {
      const r = await logWorkout(payload);
      if (!r.ok) { setError(r.error); return; }
      toast({ text: r.message });
      setExercises([{ name: "", sets: [blankSet()] }]); setDuration(""); setNotes(""); setIntensity(null);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4" aria-label="Log a workout">
      <div className="seg flex-wrap" role="radiogroup" aria-label="Workout type">
        {TYPES.map(([k, l]) => <button type="button" key={k} role="radio" aria-checked={type === k} aria-current={type === k ? "true" : undefined} onClick={() => setType(k)}>{l}</button>)}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        <label className="text-sm text-ivory-dim">Date<input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className="field mt-1" required /></label>
        <label className="text-sm text-ivory-dim">Minutes<input inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value)} className="field mt-1" placeholder="45" /></label>
        <label className="text-sm text-ivory-dim">Units
          <select value={unit} onChange={(e) => setUnit(e.target.value as "lb" | "kg")} className="field mt-1"><option value="lb">lb</option><option value="kg">kg</option></select>
        </label>
        <fieldset className="col-span-2 text-sm text-ivory-dim sm:col-span-1">
          <legend>Effort (1–5)</legend>
          <div className="mt-1 grid grid-cols-5 gap-1">{[1, 2, 3, 4, 5].map((v) => <button type="button" key={v} className="chip min-w-0 justify-center px-0" aria-pressed={intensity === v} onClick={() => setIntensity(intensity === v ? null : v)}>{v}</button>)}</div>
        </fieldset>
      </div>

      <datalist id="exercise-names">{recent.map((r) => <option key={r} value={r} />)}</datalist>
      <ol className="space-y-3">
        {exercises.map((ex, i) => (
          <li key={i} className="rounded-[14px] border border-line p-3">
            <div className="flex gap-2">
              <input list="exercise-names" value={ex.name} onChange={(e) => updEx(i, (x) => ({ ...x, name: e.target.value }))} className="field" placeholder={cardio ? "Run, row, cycle…" : "Exercise (e.g. Bench press)"} aria-label={`Exercise ${i + 1}`} maxLength={120} />
              {exercises.length > 1 && <button type="button" className="chip shrink-0" onClick={() => setExercises((xs) => xs.filter((_, k) => k !== i))} aria-label={`Remove exercise ${i + 1}`}>Remove</button>}
            </div>
            <table className="mt-2 w-full text-sm">
              <thead className="text-left text-xs text-ivory-faint"><tr><th className="w-10 font-normal">Set</th>{cardio ? <><th className="font-normal">Minutes</th><th className="font-normal">km</th></> : <><th className="font-normal">Reps</th><th className="font-normal">Weight ({unit})</th></>}</tr></thead>
              <tbody>
                {ex.sets.map((s, j) => (
                  <tr key={j}>
                    <td className="tabular text-ivory-faint">{j + 1}</td>
                    {cardio ? <>
                      <td className="pr-2 py-1"><input inputMode="decimal" value={s.minutes} onChange={(e) => updSet(i, j, "minutes", e.target.value)} className="field py-1.5" aria-label={`Set ${j + 1} minutes`} /></td>
                      <td className="py-1"><input inputMode="decimal" value={s.km} onChange={(e) => updSet(i, j, "km", e.target.value)} className="field py-1.5" aria-label={`Set ${j + 1} distance km`} /></td>
                    </> : <>
                      <td className="pr-2 py-1"><input inputMode="numeric" value={s.reps} onChange={(e) => updSet(i, j, "reps", e.target.value)} className="field py-1.5" aria-label={`Set ${j + 1} reps`} /></td>
                      <td className="py-1"><input inputMode="decimal" value={s.weight} onChange={(e) => updSet(i, j, "weight", e.target.value)} className="field py-1.5" aria-label={`Set ${j + 1} weight`} placeholder="bodyweight" /></td>
                    </>}
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" className="mt-2 text-xs text-accent hover:underline" onClick={() => updEx(i, (x) => ({ ...x, sets: [...x.sets, { ...(x.sets[x.sets.length - 1] ?? blankSet()) }] }))}>+ Add set</button>
          </li>
        ))}
      </ol>
      <button type="button" className="chip" onClick={() => setExercises((xs) => [...xs, { name: "", sets: [blankSet()] }])}>+ Add exercise</button>
      <label className="block text-sm text-ivory-dim">Notes<textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="field mt-1 min-h-16" maxLength={2000} placeholder="How it felt, what to change next time" /></label>
      {error && <p role="alert" className="text-sm text-brass">{error}</p>}
      <button className="btn btn-primary" disabled={pending} data-state={pending ? "loading" : undefined}>{date < today ? "Save (reported later)" : "Save workout"}</button>
    </form>
  );
}

export function BodyMetricForm({ today, unit }: { today: string; unit: "lb" | "kg" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function submit(form: FormData) {
    setError(null);
    const g = (k: string) => n(String(form.get(k) ?? ""));
    start(async () => {
      const r = await logBodyMetric({ measured_on: String(form.get("measured_on")), weight: g("weight"), unit: form.get("unit") as "lb" | "kg", body_fat_pct: g("body_fat_pct"), sleep_hours: g("sleep_hours"), note: null });
      if (!r.ok) { setError(r.error); return; }
      toast({ text: r.message });
      router.refresh();
    });
  }
  return (
    <form action={submit} className="space-y-3" aria-label="Record body metrics">
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm text-ivory-dim">Date<input type="date" name="measured_on" defaultValue={today} max={today} className="field mt-1" required /></label>
        <label className="text-sm text-ivory-dim">Body weight
          <div className="mt-1 flex gap-1"><input name="weight" inputMode="decimal" className="field" aria-label="Body weight" /><select name="unit" defaultValue={unit} className="field w-20" aria-label="Weight unit"><option>lb</option><option>kg</option></select></div>
        </label>
        <label className="text-sm text-ivory-dim">Sleep (hours)<input name="sleep_hours" inputMode="decimal" className="field mt-1" /></label>
        <label className="text-sm text-ivory-dim">Body fat %<input name="body_fat_pct" inputMode="decimal" className="field mt-1" /></label>
      </div>
      {error && <p role="alert" className="text-sm text-brass">{error}</p>}
      <button className="btn btn-quiet" disabled={pending} data-state={pending ? "loading" : undefined}>Record</button>
    </form>
  );
}

export function DeleteFitness({ id, kind, label }: { id: string; kind: "workout" | "body"; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  if (!confirm) return <button type="button" className="text-xs text-ivory-faint hover:text-ivory-dim" onClick={() => setConfirm(true)} aria-label={`Delete ${label}`}>Delete</button>;
  return (
    <span className="flex items-center gap-2 text-xs">
      <button type="button" className="text-brass hover:underline" disabled={pending} onClick={() => start(async () => {
        const r = kind === "workout" ? await deleteWorkout(id) : await deleteBodyMetric(id);
        toast(r.ok ? { text: r.message } : { text: r.error, tone: "error" });
        router.refresh();
      })}>Confirm delete</button>
      <button type="button" className="text-ivory-faint" onClick={() => setConfirm(false)}>Cancel</button>
    </span>
  );
}
