import { requireUser } from "@/lib/session";
import { formatInZone, formatLocalDate, shiftDate, dayBoundsUtc } from "@/lib/time";
import { PageHeader } from "@/components/page-header";
import { HabitForm } from "@/components/goal-forms";
import { FocusTimer } from "@/components/focus-timer";
import { ImpulseFlow } from "@/components/impulse-flow";
import { archiveHabit, logHabit } from "@/app/actions/goals";
import { resolveImpulse } from "@/app/actions/rhythm";
import { IMPULSE_KINDS, type FocusSession, type Habit, type HabitLog, type ImpulseLog } from "@/lib/types";

export const metadata = { title: "Rhythm" };
const kindLabel = (k: string) => IMPULSE_KINDS.find((x) => x.key === k)?.label ?? k;

export default async function Rhythm() {
  const { supabase, profile, today } = await requireUser();
  const tz = profile.timezone;
  const from = shiftDate(today, -27);
  const weekStartUtc = dayBoundsUtc(shiftDate(today, -6), tz).start.toISOString();
  const [{ data: habits }, { data: logs }, { data: goals }, { data: active }, { data: focus }, { data: impulses }, { data: tasks }] = await Promise.all([
    supabase.from("habits").select("*").order("active", { ascending: false }).order("created_at"),
    supabase.from("habit_logs").select("*").gte("log_date", from).lte("log_date", today),
    supabase.from("goals").select("id,title").eq("status", "active"),
    supabase.from("focus_sessions").select("*").eq("status", "active").order("started_at", { ascending: false }).limit(1).maybeSingle<FocusSession>(),
    supabase.from("focus_sessions").select("*").neq("status", "active").gte("started_at", weekStartUtc).order("started_at", { ascending: false }),
    supabase.from("impulse_logs").select("*").order("created_at", { ascending: false }).limit(20),
    supabase.from("tasks").select("id,title").eq("status", "pending").or(`scheduled_for.eq.${today},scheduled_for.is.null`).limit(20),
  ]);
  const hs = (habits ?? []) as Habit[];
  const ls = (logs ?? []) as HabitLog[];
  const days = Array.from({ length: 28 }, (_, i) => shiftDate(from, i));
  const sessions = (focus ?? []) as FocusSession[];
  const focusedMin = sessions.filter((f) => f.status === "completed").reduce((n, f) => n + Math.round(((f.ended_at ? Date.parse(f.ended_at) : Date.parse(f.ends_at)) - Date.parse(f.started_at)) / 60000), 0);
  const distractions = sessions.reduce((n, f) => n + (f.distractions?.length ?? 0), 0);
  const ims = (impulses ?? []) as ImpulseLog[];
  const resolvedIms = ims.filter((i) => i.outcome);
  const resisted = resolvedIms.filter((i) => i.outcome === "resisted").length;

  return (
    <>
      <PageHeader title="Rhythm" subtitle="Habits, focus, and the moments between urge and action." />

      <section className="mb-14">
        <h2 className="h-section mb-3">Focus</h2>
        <FocusTimer active={active ?? null} tasks={tasks ?? []} />
        <p className="mt-3 text-sm text-ivory-faint">
          Last 7 days: {sessions.filter((f) => f.status === "completed").length} completed of {sessions.length} sessions, {Math.floor(focusedMin / 60)}h {focusedMin % 60}m focused, {distractions} distractions logged.
        </p>
      </section>

      <section className="mb-14">
        <h2 className="h-section mb-1">Impulse interruption</h2>
        <p className="mb-4 text-sm text-ivory-dim">When an urge hits, open this before you act. Time between the urge and the action is where choice lives.</p>
        <ImpulseFlow />
        {ims.length > 0 && (
          <>
            <p className="mt-6 text-sm text-ivory-faint">Recent urges{resolvedIms.length > 0 && ` — resisted ${resisted} of ${resolvedIms.length} with a recorded outcome`}.</p>
            <ul className="mt-2 divide-y divide-line">
              {ims.slice(0, 8).map((i) => (
                <li key={i.id} className="py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span>{kindLabel(i.kind)}</span>
                    <span className="text-sm text-ivory-faint">{formatInZone(i.created_at, tz, "MMM d, h:mm a")}</span>
                  </div>
                  {i.alternative && <p className="text-sm text-ivory-dim">Instead: {i.alternative}</p>}
                  {i.outcome ? (
                    <p className={`text-sm ${i.outcome === "resisted" ? "text-emerald" : i.outcome === "acted" ? "text-brass" : "text-ivory-dim"}`}>
                      {{ resisted: "Resisted", acted: "Acted on it", partly: "Partly", unsure: "Not sure" }[i.outcome]}
                    </p>
                  ) : (
                    <form action={resolveImpulse} className="mt-2 flex flex-wrap gap-1.5">
                      <input type="hidden" name="id" value={i.id} />
                      <span className="mr-1 self-center text-sm text-ivory-faint">How did it go?</span>
                      <button name="outcome" value="resisted" className="chip">Resisted</button>
                      <button name="outcome" value="partly" className="chip">Partly</button>
                      <button name="outcome" value="acted" className="chip">Acted on it</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section>
        <h2 className="h-section mb-1">Habits</h2>
        <p className="mb-4 text-sm text-ivory-dim">Last four weeks. Filled squares are logged completions; outlined squares are planned rest.</p>
        {hs.length > 0 && (
          <ul className="mb-6 divide-y divide-line">
            {hs.map((h) => {
              const mine = ls.filter((l) => l.habit_id === h.id);
              const done = mine.filter((l) => l.status === "done").length;
              const todayLog = mine.find((l) => l.log_date === today);
              return (
                <li key={h.id} className={`py-4 ${h.active ? "" : "opacity-50"}`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <p>{h.title}</p>
                    <form action={archiveHabit}>
                      <input type="hidden" name="id" value={h.id} />
                      <input type="hidden" name="active" value={String(!h.active)} />
                      <button className="text-xs text-ivory-faint hover:text-ivory-dim">{h.active ? "Archive" : "Restore"}</button>
                    </form>
                  </div>
                  <p className="text-xs text-ivory-faint">{done} completions in 28 days, target {h.target_per_week}/week</p>
                  <div className="mt-2 grid grid-cols-[repeat(28,minmax(0,1fr))] gap-[3px]" aria-hidden>
                    {days.map((d) => {
                      const l = mine.find((x) => x.log_date === d);
                      return <span key={d} title={formatLocalDate(d, "MMM d")} className={`aspect-square rounded-[2px] ${l?.status === "done" ? "bg-emerald" : l?.status === "rest" ? "border border-ivory-faint" : "bg-surface-2"}`} />;
                    })}
                  </div>
                  {h.active && (
                    <form action={logHabit} className="mt-3 flex gap-1.5">
                      <input type="hidden" name="habit_id" value={h.id} />
                      <input type="hidden" name="date" value={today} />
                      <button name="status" value={todayLog?.status === "done" ? "clear" : "done"} className="chip" data-on={todayLog?.status === "done"}>Done today</button>
                      <button name="status" value={todayLog?.status === "rest" ? "clear" : "rest"} className="chip" data-on={todayLog?.status === "rest"}>Rest day</button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <HabitForm goals={goals ?? []} />
      </section>
    </>
  );
}
