import Link from "next/link";
import { requireUser } from "@/lib/session";
import { formatLocalDate, shiftDate } from "@/lib/time";
import { PageHeader, Empty } from "@/components/page-header";
import { HabitForm } from "@/components/goal-forms";
import { archiveHabit } from "@/app/actions/goals";
import { GOAL_AREAS, type Goal, type Habit, type HabitLog } from "@/lib/types";
import { IconPlus } from "@/components/icons";

export const metadata = { title: "Goals & habits" };
const HORIZON = { long_term: "Long-term", monthly: "Monthly milestones", weekly: "Weekly objectives" } as const;
const areaLabel = (k: string) => GOAL_AREAS.find((a) => a.key === k)?.label ?? k;

export default async function Goals() {
  const { supabase, today } = await requireUser();
  const from = shiftDate(today, -27);
  const [{ data: goals }, { data: habits }, { data: logs }, { data: progress }] = await Promise.all([
    supabase.from("goals").select("*").order("target_date", { nullsFirst: false }),
    supabase.from("habits").select("*").order("active", { ascending: false }).order("created_at"),
    supabase.from("habit_logs").select("*").gte("log_date", from).lte("log_date", today),
    supabase.from("goal_progress").select("goal_id,progress_pct,created_at").order("created_at", { ascending: false }),
  ]);
  const gs = (goals ?? []) as Goal[];
  const hs = (habits ?? []) as Habit[];
  const ls = (logs ?? []) as HabitLog[];
  const latest = new Map<string, { pct: number | null; at: string }>();
  for (const p of progress ?? []) if (!latest.has(p.goal_id)) latest.set(p.goal_id, { pct: p.progress_pct, at: p.created_at });
  const active = gs.filter((g) => g.status === "active");
  const other = gs.filter((g) => g.status !== "active");
  const days = Array.from({ length: 28 }, (_, i) => shiftDate(from, i));

  return (
    <>
      <PageHeader title="Goals & habits" action={<Link href="/goals/new" className="btn btn-primary"><IconPlus width={18} height={18} /> Goal</Link>} />
      {active.length === 0 && <Empty action={<Link href="/goals/new" className="btn btn-quiet">Create a goal</Link>}>No active goals. A goal here needs a specific outcome and a way to measure it.</Empty>}
      <div className="space-y-10">
        {(["long_term", "monthly", "weekly"] as const).map((h) => {
          const list = active.filter((g) => g.horizon === h);
          if (!list.length) return null;
          return (
            <section key={h}>
              <h2 className="mb-2 text-sm text-ivory-dim">{HORIZON[h]}</h2>
              <ul className="divide-y divide-line">
                {list.map((g) => {
                  const l = latest.get(g.id);
                  return (
                    <li key={g.id} className="py-4">
                      <Link href={`/goals/${g.id}`} className="block">
                        <p className="serif text-lg">{g.title}</p>
                        <p className="text-sm text-ivory-faint">
                          {areaLabel(g.area)}{g.target_date && `, by ${formatLocalDate(g.target_date, "MMM d, yyyy")}`}
                          {l ? `, last update ${formatLocalDate(l.at.slice(0, 10), "MMM d")}` : ", no progress logged yet"}
                        </p>
                        {l?.pct != null && <div className="mt-2 h-1 rounded-full bg-surface-2"><div className="h-1 rounded-full bg-emerald" style={{ width: `${l.pct}%` }} /></div>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      <section className="mt-14">
        <h2 className="h-section mb-1">Habits</h2>
        <p className="mb-4 text-sm text-ivory-dim">Last four weeks. Filled squares are logged completions; outlined squares are planned rest.</p>
        {hs.length > 0 && (
          <ul className="mb-6 divide-y divide-line">
            {hs.map((h) => {
              const mine = ls.filter((l) => l.habit_id === h.id);
              const done = mine.filter((l) => l.status === "done").length;
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
                  <p className="text-xs text-ivory-faint">{done} completions in 28 days, target {h.target_per_week}/week ({h.target_per_week * 4} in 28 days)</p>
                  <div className="mt-2 grid grid-cols-[repeat(28,minmax(0,1fr))] gap-[3px]" aria-hidden>
                    {days.map((d) => {
                      const l = mine.find((x) => x.log_date === d);
                      return <span key={d} className={`aspect-square rounded-[2px] ${l?.status === "done" ? "bg-emerald" : l?.status === "rest" ? "border border-ivory-faint" : "bg-surface-2"}`} />;
                    })}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <HabitForm goals={active.map((g) => ({ id: g.id, title: g.title }))} />
      </section>

      {other.length > 0 && (
        <section className="mt-14">
          <h2 className="mb-2 text-sm text-ivory-dim">Paused, achieved and abandoned</h2>
          <ul className="divide-y divide-line">
            {other.map((g) => (
              <li key={g.id} className="flex justify-between py-3"><Link href={`/goals/${g.id}`}>{g.title}</Link><span className="text-sm text-ivory-faint capitalize">{g.status}</span></li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
