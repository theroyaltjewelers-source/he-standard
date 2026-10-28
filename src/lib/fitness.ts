/**
 * Fitness math (pure). Weights are stored in the unit the user entered and
 * converted only for display/aggregation, so nothing is lost to rounding.
 */
export type WeightUnit = "lb" | "kg";
export interface SetLike { reps: number | null; weight: number | null; unit: WeightUnit; duration_seconds?: number | null; distance_m?: number | null }

const LB_PER_KG = 2.2046226218;
export function convertWeight(w: number, from: WeightUnit, to: WeightUnit): number {
  if (from === to) return w;
  return from === "kg" ? w * LB_PER_KG : w / LB_PER_KG;
}
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Tonnage: Σ reps × weight, in `unit`. Bodyweight/cardio sets contribute 0. */
export function setVolume(sets: SetLike[], unit: WeightUnit): number {
  return round1(sets.reduce((n, s) => n + (s.reps && s.weight ? s.reps * convertWeight(s.weight, s.unit, unit) : 0), 0));
}

/** Estimated one-rep max (Epley). Only meaningful for 1–12 reps; otherwise null. */
export function estimated1RM(weight: number, reps: number): number | null {
  if (!(weight > 0) || reps < 1 || reps > 12) return null;
  return reps === 1 ? weight : round1(weight * (1 + reps / 30));
}

export interface ExerciseSets { name: string; performed_on: string; sets: SetLike[] }
export interface PersonalRecord { exercise: string; weight: number; reps: number; e1rm: number | null; performed_on: string }

/** Normalise exercise names so "Bench press" and "bench  Press " match. */
export const exerciseKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

/** Best set per exercise by estimated 1RM (falls back to heaviest weight). */
export function personalRecords(rows: ExerciseSets[], unit: WeightUnit): PersonalRecord[] {
  const best = new Map<string, PersonalRecord & { score: number }>();
  for (const r of rows) for (const s of r.sets) {
    if (!s.weight || !s.reps) continue;
    const w = round1(convertWeight(s.weight, s.unit, unit));
    const e = estimated1RM(w, s.reps);
    const score = e ?? w;
    const k = exerciseKey(r.name);
    const cur = best.get(k);
    if (!cur || score > cur.score || (score === cur.score && r.performed_on < cur.performed_on)) {
      best.set(k, { exercise: r.name.trim(), weight: w, reps: s.reps, e1rm: e, performed_on: r.performed_on, score });
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score).map(({ score: _s, ...p }) => p); // eslint-disable-line @typescript-eslint/no-unused-vars
}

/** Monday-start ISO week key for a local date. */
export function weekKey(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/** Sessions per week for the last `weeks` weeks ending with the week of `today` (oldest first, zeros included). */
export function weeklyConsistency(dates: string[], today: string, weeks = 8): { week: string; sessions: number }[] {
  const counts = new Map<string, number>();
  for (const d of dates) counts.set(weekKey(d), (counts.get(weekKey(d)) ?? 0) + 1);
  const out: { week: string; sessions: number }[] = [];
  const end = new Date(`${weekKey(today)}T12:00:00Z`);
  for (let i = weeks - 1; i >= 0; i--) {
    const w = new Date(end); w.setUTCDate(w.getUTCDate() - i * 7);
    const k = w.toISOString().slice(0, 10);
    out.push({ week: k, sessions: counts.get(k) ?? 0 });
  }
  return out;
}

/** Consecutive weeks (ending this or last week) with at least `target` sessions. */
export function weekStreak(weekly: { sessions: number }[], target: number): number {
  let n = 0;
  const arr = [...weekly];
  // The current week isn't over: don't break the streak just because it's still short.
  if (arr.length && arr[arr.length - 1].sessions < target) arr.pop();
  for (let i = arr.length - 1; i >= 0 && arr[i].sessions >= target; i--) n++;
  return n;
}
