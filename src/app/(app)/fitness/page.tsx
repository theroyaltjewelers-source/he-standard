import { requireUser } from "@/lib/session";
import { formatLocalDate, shiftDate } from "@/lib/time";
import { convertWeight, personalRecords, setVolume, weekStreak, weeklyConsistency, type WeightUnit } from "@/lib/fitness";
import { PageHeader } from "@/components/page-header";
import { TrendChart } from "@/components/charts/trend-chart";
import { BodyMetricForm, DeleteFitness, WorkoutForm } from "@/components/fitness-forms";

export const metadata = { title: "Fitness" };

const TYPE_LABEL: Record<string, string> = { strength: "Strength", cardio: "Cardio", mobility: "Mobility", sport: "Sport", recovery: "Recovery", other: "Workout" };
const SOURCE_LABEL: Record<string, string> = { app: "logged here", notification: "from a reminder", coach: "via Coach", timeline: "from the timeline" };

export default async function FitnessPage() {
  const { supabase, today } = await requireUser();
  const since = shiftDate(today, -90);

  const [{ data: prefs }, { data: logs }, { data: body }, { data: weeklyTarget }] = await Promise.all([
    supabase.from("user_preferences").select("weight_unit").maybeSingle(),
    supabase.from("workout_logs").select("id,performed_on,workout_type,duration_minutes,intensity,notes,source,occurrence_id").gte("performed_on", since).order("performed_on", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("body_metrics").select("id,measured_on,weight,unit,body_fat_pct,sleep_hours,source").gte("measured_on", since).order("measured_on", { ascending: true }).order("created_at", { ascending: true }),
    supabase.from("events").select("weekdays").eq("kind", "workout").eq("recurrence", "weekly").limit(5),
  ]);
  const unit = ((prefs?.weight_unit as WeightUnit) ?? "lb");
  const logIds = (logs ?? []).map((l) => l.id);
  const { data: exs } = logIds.length ? await supabase.from("workout_exercises").select("id,workout_log_id,name,position").in("workout_log_id", logIds).order("position") : { data: [] };
  const exIds = (exs ?? []).map((e) => e.id);
  const { data: sets } = exIds.length ? await supabase.from("workout_sets").select("exercise_id,set_number,reps,weight,unit,duration_seconds,distance_m").in("exercise_id", exIds).order("set_number") : { data: [] };

  const setsByEx = new Map<string, NonNullable<typeof sets>>();
  for (const s of sets ?? []) setsByEx.set(s.exercise_id, [...(setsByEx.get(s.exercise_id) ?? []), s]);
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const normSets = (id: string) => (setsByEx.get(id) ?? []).map((s) => ({ reps: num(s.reps), weight: num(s.weight), unit: s.unit as WeightUnit, duration_seconds: num(s.duration_seconds), distance_m: num(s.distance_m), set_number: s.set_number }));
  const exByLog = new Map<string, { id: string; name: string; sets: ReturnType<typeof normSets> }[]>();
  for (const e of exs ?? []) exByLog.set(e.workout_log_id, [...(exByLog.get(e.workout_log_id) ?? []), { id: e.id, name: e.name, sets: normSets(e.id) }]);

  const dateOf = new Map((logs ?? []).map((l) => [l.id, l.performed_on as string]));
  const prs = personalRecords((exs ?? []).map((e) => ({ name: e.name, performed_on: dateOf.get(e.workout_log_id)!, sets: normSets(e.id) })), unit).slice(0, 6);
  const recentNames = [...new Set((exs ?? []).map((e) => e.name.trim()))].slice(0, 40);

  const weekly = weeklyConsistency((logs ?? []).map((l) => l.performed_on), today, 8);
  const plannedPerWeek = Math.max(0, ...(weeklyTarget ?? []).map((e) => (e.weekdays as number[] | null)?.length ?? 0)) || 3;
  const streak = weekStreak(weekly, plannedPerWeek);
  const last7 = (logs ?? []).filter((l) => l.performed_on > shiftDate(today, -7));
  const minutes7 = last7.reduce((n, l) => n + (l.duration_minutes ?? 0), 0);

  // Volume per week (strength only), in the display unit.
  const volByWeek = weekly.map((w) => {
    const end = shiftDate(w.week, 7);
    const v = (logs ?? []).filter((l) => l.performed_on >= w.week && l.performed_on < end).flatMap((l) => exByLog.get(l.id) ?? []).reduce((n, e) => n + setVolume(e.sets, unit), 0);
    return Math.round(v);
  });
  const volMax = Math.max(...volByWeek, 0);

  // Body weight trend (daily, last 90 days; latest reading per day; gaps stay gaps).
  const byDay = new Map<string, number>();
  for (const b of body ?? []) if (b.weight !== null) byDay.set(b.measured_on, Math.round(convertWeight(Number(b.weight), b.unit as WeightUnit, unit) * 10) / 10);
  const bwDays = [...byDay.keys()].sort();
  const bwVals = bwDays.map((d) => byDay.get(d)!);
  const bwMin = bwVals.length ? Math.floor(Math.min(...bwVals) - 2) : 0, bwMax = bwVals.length ? Math.ceil(Math.max(...bwVals) + 2) : 100;
  const sleep = (body ?? []).filter((b) => b.sleep_hours !== null && b.measured_on > shiftDate(today, -7)).map((b) => Number(b.sleep_hours));
  const avgSleep = sleep.length ? Math.round((sleep.reduce((a, b) => a + b, 0) / sleep.length) * 10) / 10 : null;

  return (
    <>
      <PageHeader title="Fitness" subtitle="Sessions, sets, body weight and recovery — recorded, not guessed." />

      <section aria-label="This week" className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card"><p className="eyebrow">Sessions · 7 days</p><p className="metric mt-1 text-4xl">{last7.length}</p></div>
        <div className="card"><p className="eyebrow">Minutes · 7 days</p><p className="metric mt-1 text-4xl">{minutes7}</p></div>
        <div className="card"><p className="eyebrow">Week streak</p><p className="metric mt-1 text-4xl">{streak}</p><p className="text-xs text-ivory-faint">weeks at ≥{plannedPerWeek} sessions</p></div>
        <div className="card"><p className="eyebrow">Avg sleep · 7 days</p><p className="metric mt-1 text-4xl">{avgSleep ?? "—"}</p><p className="text-xs text-ivory-faint">{avgSleep === null ? "not recorded" : "hours"}</p></div>
      </section>

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-7">
          <section aria-labelledby="log-h" className="card">
            <h2 id="log-h" className="h-section mb-4">Log a workout</h2>
            <WorkoutForm today={today} unit={unit} recent={recentNames} />
          </section>

          <section aria-labelledby="hist-h" className="card">
            <h2 id="hist-h" className="h-section">History</h2>
            {(logs ?? []).length === 0 ? <p className="mt-2 text-sm text-ivory-dim">No workouts in the last 90 days.</p> : (
              <ol className="mt-3 divide-y divide-line">
                {(logs ?? []).slice(0, 30).map((l) => {
                  const ex = exByLog.get(l.id) ?? [];
                  const vol = ex.reduce((n, e) => n + setVolume(e.sets, unit), 0);
                  return (
                    <li key={l.id} className="py-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="font-medium">{TYPE_LABEL[l.workout_type] ?? "Workout"} <span className="text-sm font-normal text-ivory-dim">· {formatLocalDate(l.performed_on, "EEE, MMM d")}</span></p>
                        <DeleteFitness id={l.id} kind="workout" label={`workout on ${l.performed_on}`} />
                      </div>
                      <p className="text-xs text-ivory-faint">
                        {[l.duration_minutes ? `${l.duration_minutes} min` : null, l.intensity ? `effort ${l.intensity}/5` : null, vol ? `${Math.round(vol).toLocaleString()} ${unit} volume` : null, SOURCE_LABEL[l.source] ?? l.source].filter(Boolean).join(" · ")}
                      </p>
                      {ex.length > 0 && (
                        <ul className="mt-1.5 space-y-0.5 text-sm">
                          {ex.map((e) => (
                            <li key={e.id}><span className="text-ivory-dim">{e.name}</span>{" "}
                              <span className="tabular text-ivory-faint">{e.sets.map((s) => s.duration_seconds || s.distance_m
                                ? [s.duration_seconds ? `${Math.round(s.duration_seconds / 60)} min` : null, s.distance_m ? `${(s.distance_m / 1000).toFixed(1)} km` : null].filter(Boolean).join(" ")
                                : `${s.reps ?? "?"}${s.weight ? `×${Math.round(convertWeight(s.weight, s.unit, unit) * 10) / 10}` : ""}`).join(", ")}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {l.notes && <p className="mt-1 text-sm text-ivory-dim">{l.notes}</p>}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>

        <aside className="space-y-6 lg:col-span-5">
          <section aria-labelledby="cons-h" className="card">
            <h2 id="cons-h" className="eyebrow">Weekly consistency</h2>
            <TrendChart height={160} yMax={Math.max(plannedPerWeek + 1, ...weekly.map((w) => w.sessions))}
              labels={weekly.map((w) => formatLocalDate(w.week, "MMM d"))}
              summary={`Sessions per week for 8 weeks: ${weekly.map((w) => w.sessions).join(", ")}. Target ${plannedPerWeek}.`}
              series={[
                { key: "s", label: "Sessions", color: "var(--color-lime)", values: weekly.map((w) => w.sessions), area: true },
                { key: "t", label: "Target", color: "var(--color-ivory-faint)", values: weekly.map(() => plannedPerWeek), dashed: true },
              ]} />
          </section>

          {volMax > 0 && (
            <section aria-labelledby="vol-h" className="card">
              <h2 id="vol-h" className="eyebrow">Strength volume per week ({unit})</h2>
              <TrendChart height={160} yMax={Math.ceil(volMax * 1.1)} labels={weekly.map((w) => formatLocalDate(w.week, "MMM d"))}
                summary={`Weekly lifted volume in ${unit}: ${volByWeek.join(", ")}.`}
                series={[{ key: "v", label: "Volume", color: "var(--d1)", values: volByWeek }]} />
            </section>
          )}

          <section aria-labelledby="pr-h" className="card">
            <h2 id="pr-h" className="eyebrow">Best lifts · 90 days</h2>
            {prs.length ? (
              <table className="mt-2 w-full text-sm">
                <thead className="text-left text-xs text-ivory-faint"><tr><th className="font-normal">Exercise</th><th className="font-normal">Best set</th><th className="font-normal">Est. 1RM</th></tr></thead>
                <tbody>{prs.map((p) => <tr key={p.exercise} className="border-t border-line"><td className="py-1.5">{p.exercise}</td><td className="tabular">{p.reps}×{p.weight} {unit}</td><td className="tabular text-ivory-dim">{p.e1rm ?? "—"}</td></tr>)}</tbody>
              </table>
            ) : <p className="mt-2 text-sm text-ivory-dim">Log sets with reps and weight to see your best lifts.</p>}
            <p className="mt-2 text-xs text-ivory-faint">Estimated 1RM uses the Epley formula, only for sets of 1–12 reps.</p>
          </section>

          <section aria-labelledby="body-h" className="card">
            <h2 id="body-h" className="eyebrow">Body weight ({unit})</h2>
            <TrendChart height={160} yMin={bwMin} yMax={bwMax} decimals={1} labels={bwDays.map((d) => formatLocalDate(d, "MMM d"))}
              summary={bwVals.length ? `Body weight from ${bwVals[0]} to ${bwVals[bwVals.length - 1]} ${unit} over ${bwVals.length} readings.` : "No body-weight readings yet."}
              series={[{ key: "bw", label: "Body weight", color: "var(--d4)", values: bwVals }]} />
            <div className="mt-4 border-t border-line pt-4"><BodyMetricForm today={today} unit={unit} /></div>
            {(body ?? []).length > 0 && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-ivory-faint">Recent readings</summary>
                <ul className="mt-2 space-y-1">
                  {[...(body ?? [])].reverse().slice(0, 10).map((b) => (
                    <li key={b.id} className="flex items-center justify-between gap-2">
                      <span className="tabular">{b.measured_on} · {[b.weight !== null ? `${b.weight} ${b.unit}` : null, b.sleep_hours !== null ? `${b.sleep_hours} h sleep` : null, b.body_fat_pct !== null ? `${b.body_fat_pct}% fat` : null].filter(Boolean).join(" · ")}
                        <span className="text-xs text-ivory-faint"> · {b.source === "imported" ? "imported" : "manual"}</span></span>
                      <DeleteFitness id={b.id} kind="body" label={`reading on ${b.measured_on}`} />
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
          <p className="text-xs text-ivory-faint">Apple Health and Health Connect can&apos;t be read by a web app; every record here is entered by you or logged from a workout on your timeline.</p>
        </aside>
      </div>
    </>
  );
}
