import Link from "next/link";
import { requireUser } from "@/lib/session";
import { formatLocalDate } from "@/lib/time";
import { PageHeader, Empty } from "@/components/page-header";
import { IconPlus } from "@/components/icons";
import { GOAL_AREAS, type Goal } from "@/lib/types";

export const metadata = { title: "Goals" };
const HORIZON = { long_term: "Long-term", monthly: "Monthly milestones", weekly: "Weekly objectives" } as const;
const areaLabel = (k: string) => GOAL_AREAS.find((a) => a.key === k)?.label ?? k;

export default async function Goals() {
  const { supabase } = await requireUser();
  const [{ data: goals }, { data: progress }, { data: milestones }] = await Promise.all([
    supabase.from("goals").select("*").order("target_date", { nullsFirst: false }),
    supabase.from("goal_progress").select("goal_id,progress_pct,created_at").order("created_at", { ascending: false }),
    supabase.from("goal_milestones").select("goal_id,completed_at"),
  ]);
  const gs = (goals ?? []) as Goal[];
  const latest = new Map<string, { pct: number | null; at: string }>();
  for (const p of progress ?? []) if (!latest.has(p.goal_id)) latest.set(p.goal_id, { pct: p.progress_pct, at: p.created_at });
  const active = gs.filter((g) => g.status === "active");
  const other = gs.filter((g) => g.status !== "active");

  return (
    <>
      <PageHeader back="/progress" title="Goals" subtitle="Specific outcomes, measured progress, honest status." action={<Link href="/goals/new" className="btn btn-primary"><IconPlus width={18} height={18} /> Goal</Link>} />

      <section className="mb-14">
        <h2 className="h-section mb-3">Goals</h2>
        {active.length === 0 && <Empty action={<Link href="/goals/new" className="btn btn-quiet">Create a goal</Link>}>No active goals. A goal here needs a specific outcome and a way to measure it.</Empty>}
        <div className="space-y-8">
          {(["long_term", "monthly", "weekly"] as const).map((h) => {
            const list = active.filter((g) => g.horizon === h);
            if (!list.length) return null;
            return (
              <section key={h}>
                <h3 className="mb-1 text-sm text-ivory-dim">{HORIZON[h]}</h3>
                <ul className="divide-y divide-line">
                  {list.map((g) => {
                    const l = latest.get(g.id);
                    const ms = (milestones ?? []).filter((x) => x.goal_id === g.id);
                    return (
                      <li key={g.id} className="py-4">
                        <Link href={`/goals/${g.id}`} className="block">
                          <p className="serif text-lg">{g.title}</p>
                          <p className="text-sm text-ivory-faint">
                            {areaLabel(g.area)}{g.target_date && `, by ${formatLocalDate(g.target_date, "MMM d, yyyy")}`}
                            {ms.length > 0 && `, ${ms.filter((x) => x.completed_at).length}/${ms.length} milestones`}
                            {l ? `, updated ${formatLocalDate(l.at.slice(0, 10), "MMM d")}` : ", no progress logged yet"}
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
        {other.length > 0 && (
          <details className="mt-8">
            <summary className="cursor-pointer text-sm text-ivory-dim">Paused, achieved and abandoned ({other.length})</summary>
            <ul className="mt-2 divide-y divide-line">
              {other.map((g) => <li key={g.id} className="flex justify-between py-3"><Link href={`/goals/${g.id}`}>{g.title}</Link><span className="text-sm capitalize text-ivory-faint">{g.status}</span></li>)}
            </ul>
          </details>
        )}
        <p className="mt-6 text-sm text-ivory-faint">Habits live in <Link href="/rhythm" className="text-emerald hover:underline">Rhythm</Link>.</p>
      </section>
    </>
  );
}
