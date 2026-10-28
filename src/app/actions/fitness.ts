"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/session";

export type FitnessResult = { ok: true; id?: string; message: string } | { ok: false; error: string };

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const num = (min: number, max: number) => z.number().min(min).max(max).nullable();
const setSchema = z.object({
  reps: num(0, 1000).transform((v) => (v === null ? null : Math.round(v))),
  weight: num(0, 5000),
  duration_seconds: num(0, 86400).transform((v) => (v === null ? null : Math.round(v))),
  distance_m: num(0, 1_000_000),
  rpe: num(1, 10),
});
const workoutSchema = z.object({
  performed_on: date,
  workout_type: z.enum(["strength", "cardio", "mobility", "sport", "recovery", "other"]),
  duration_minutes: num(0, 600).transform((v) => (v === null ? null : Math.round(v))),
  intensity: z.number().int().min(1).max(5).nullable(),
  notes: z.string().max(2000).nullable(),
  unit: z.enum(["lb", "kg"]),
  exercises: z.array(z.object({ name: z.string().trim().min(1, "Name each exercise.").max(120), sets: z.array(setSchema).max(50) })).max(30),
});
export type WorkoutInput = z.input<typeof workoutSchema>;

function revalidate() { revalidatePath("/fitness"); revalidatePath("/today"); revalidatePath("/progress"); }

/**
 * Log a workout with its exercises and sets. Rows are inserted in order and,
 * if any later insert fails, the workout row is removed so a partial session
 * is never left behind.
 */
export async function logWorkout(input: WorkoutInput): Promise<FitnessResult> {
  const { supabase, user, today } = await requireUser();
  const p = workoutSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const w = p.data;
  if (w.performed_on > today) return { ok: false, error: "A workout can't be logged in the future." };
  if (!w.exercises.length && w.duration_minutes === null) return { ok: false, error: "Add an exercise or a duration." };

  const { data: log, error } = await supabase.from("workout_logs").insert({
    user_id: user.id, performed_on: w.performed_on, duration_minutes: w.duration_minutes, workout_type: w.workout_type,
    intensity: w.intensity, notes: w.notes || null, source: "app",
  }).select("id").single();
  if (error || !log) return { ok: false, error: error?.message ?? "Couldn't save the workout." };

  try {
    for (const [i, ex] of w.exercises.entries()) {
      const { data: e, error: ee } = await supabase.from("workout_exercises").insert({ user_id: user.id, workout_log_id: log.id, name: ex.name, position: i }).select("id").single();
      if (ee || !e) throw new Error(ee?.message ?? "exercise");
      const sets = ex.sets.filter((s) => s.reps !== null || s.weight !== null || s.duration_seconds !== null || s.distance_m !== null)
        .map((s, k) => ({ user_id: user.id, exercise_id: e.id, set_number: k + 1, unit: w.unit, ...s }));
      if (sets.length) {
        const { error: se } = await supabase.from("workout_sets").insert(sets);
        if (se) throw new Error(se.message);
      }
    }
  } catch (err) {
    await supabase.from("workout_logs").delete().eq("id", log.id);
    return { ok: false, error: `Nothing was saved: ${(err as Error).message}` };
  }
  await supabase.from("user_preferences").update({ weight_unit: w.unit }).eq("user_id", user.id);
  revalidate();
  return { ok: true, id: log.id, message: w.performed_on < today ? "Workout saved (reported later)" : "Workout saved" };
}

export async function deleteWorkout(id: string): Promise<FitnessResult> {
  const { supabase } = await requireUser();
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "Invalid workout." };
  const { error } = await supabase.from("workout_logs").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true, message: "Workout deleted" };
}

const bodySchema = z.object({
  measured_on: date,
  weight: num(1, 2000),
  unit: z.enum(["lb", "kg"]),
  body_fat_pct: num(1, 70),
  sleep_hours: num(0, 24),
  note: z.string().max(500).nullable(),
});
export type BodyInput = z.input<typeof bodySchema>;

export async function logBodyMetric(input: BodyInput): Promise<FitnessResult> {
  const { supabase, user, today } = await requireUser();
  const p = bodySchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  if (p.data.measured_on > today) return { ok: false, error: "Can't record a future date." };
  if (p.data.weight === null && p.data.body_fat_pct === null && p.data.sleep_hours === null) return { ok: false, error: "Enter at least one measurement." };
  const { error } = await supabase.from("body_metrics").insert({ ...p.data, note: p.data.note || null, user_id: user.id, source: "manual" });
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true, message: "Recorded" };
}

export async function deleteBodyMetric(id: string): Promise<FitnessResult> {
  const { supabase } = await requireUser();
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "Invalid entry." };
  const { error } = await supabase.from("body_metrics").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true, message: "Deleted" };
}
