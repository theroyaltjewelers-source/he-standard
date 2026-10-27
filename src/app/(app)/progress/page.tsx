import Link from "next/link";
import { requireUser } from "@/lib/session";
import { formatLocalDate, shiftDate } from "@/lib/time";
import { PageHeader, Empty } from "@/components/page-header";
import { IntegritySeries } from "@/components/integrity";
import { integritySeries } from "@/lib/records";
import { generateReportNow } from "@/app/actions/progress";
import { IconPlus } from "@/components/icons";
import { GOAL_AREAS, type Goal } from "@/lib/types";
import type { Example, WeeklyMetrics } from "@/lib/weekly";

export const metadata = { title: "Progress" };
const HORIZON = { long_term: "Long-term", monthly: "Monthly milestones", weekly: "Weekly objectives" } as const;
const areaLabel = (k: string) => GOAL_AREAS.find((a) => a.key === k)?.label ?? k;

interface ReportRow {
  id: string; week_start: string; period_start: string | null; period_end: string | null;
  metrics: WeeklyMetrics; sample: Record<string, number>; matched: Example[]; mismatched: Example[];
  interpretation: string | null; priorities: string[]; model: string | null; generated_at: string;
}

function pct(n: number, d: number) { return d ? `${Math.round((n / d) * 100)}%` : "—"; }

export default async function Progress({ searchParams }: PageProps<"/progress">) {
  const sp = await searchParams;
  const { supabase, today } = await requireUser();
  const [{ data: goals }, { data: progress }, { data: milestones }, { data: reports }, series] = await Promise.all([
    supabase.from("goals").select("*").order("target_date", { nullsFirst: false }),
    supabase.from("goal_progress").select("goal_id,progress_pct,created_at").order("created_at", { ascending: false }),
    supabase.from("goal_milestones").select("goal_id,completed_at"),
    supabase.from("weekly_reports").select("*").order("week_start", { ascending: false }).limit(12),
    integritySeries(supabase, shiftDate(today, -27), today, today),
  ]);
  const gs = (goals ?? []) as Goal[];
  const latest = new Map<string, { pct: number | null; at: string }>();
  for (const p of progress ?? []) if (!latest.has(p.goal_id)) latest.set(p.goal_id, { pct: p.progress_pct, at: p.created_at });
  const active = gs.filter((g) => g.status === "active");
  const other = gs.filter((g) => g.status !== "active");
  const rs = (reports ?? []) as ReportRow[];
  const selected = rs.find((r) => r.id === sp.report) ?? rs[0];
  const m = selected?.metrics;

  return (
    <>
      <PageHeader title="Progress" subtitle="Measured from what you recorded, not from how the week felt." action={<Link href="/goals/new" className="btn btn-primary"><IconPlus width={18} height={18} /> Goal</Link>} />

      <section className="mb-14">
        <h2 className="h-section mb-3">Integrity, last 28 days</h2>
        <IntegritySeries data={series} />
      </section>

      <section className="mb-14">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="h-section">Weekly report</h2>
          <form action={generateReportNow} className="flex gap-2">
            <button name="week" value="this" className="text-sm text-emerald hover:underline">Generate this week so far</button>
          </form>
        </div>
        {!selected ? (
          <Empty>No reports yet. One is generated automatically each week; you can also generate one now.</Empty>
        ) : (
          <article className="space-y-8">
            <div>
              <p className="text-sm text-ivory-dim">
                {formatLocalDate(selected.period_start ?? selected.week_start, "MMM d")} – {formatLocalDate(selected.period_end ?? shiftDate(selected.week_start, 6), "MMM d, yyyy")}
              </p>
              <p className="mt-1 text-xs text-ivory-faint">
                Based on {Object.entries(selected.sample ?? {}).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k.replace(/_/g, " ")}`).join(", ") || "no records"}.
              </p>
            </div>

            {m && (
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {[
                  { k: "Commitments kept", v: `${m.commitments.kept + m.commitments.kept_late} / ${m.commitments.made}`, sub: m.commitments.on_time_rate != null ? `${Math.round(m.commitments.on_time_rate * 100)}% on time` : null },
                  { k: "Tasks done", v: `${m.tasks.done} / ${m.tasks.scheduled}`, sub: m.tasks.done ? `${m.tasks.done_with_evidence} with evidence` : null },
                  { k: "Habit consistency", v: m.habits.consistency != null ? `${Math.round(m.habits.consistency * 100)}%` : "—", sub: `${m.habits.completions} of ${m.habits.target}` },
                  { k: "Prayers confirmed", v: `${m.prayer.confirmed} / ${m.prayer.possible}`, sub: "unconfirmed ≠ missed" },
                  { k: "Focus", v: `${Math.round(m.focus.minutes / 60 * 10) / 10}h`, sub: `${m.focus.completed} of ${m.focus.sessions} sessions` },
                  { k: "Urges resisted", v: `${m.impulses.resisted} / ${m.impulses.logged}`, sub: m.impulses.logged ? pct(m.impulses.resisted, m.impulses.logged) : null },
                ].map((x) => (
                  <div key={x.k} className="rounded-[12px] border border-line p-3">
                    <dt className="text-xs text-ivory-faint">{x.k}</dt>
                    <dd className="serif mt-1 text-2xl tabular-nums">{x.v}</dd>
                    {x.sub && <dd className="text-xs text-ivory-faint">{x.sub}</dd>}
                  </div>
                ))}
              </dl>
            )}

            <div>
              <h3 className="serif text-xl text-emerald">Where Your Actions Matched Your Values</h3>
              {selected.matched?.length ? (
                <ul className="mt-2 space-y-2">{selected.matched.map((e, i) => <li key={i} className="flex justify-between gap-3"><span>{e.text}</span><span className="shrink-0 text-xs text-ivory-faint">{e.date ? formatLocalDate(e.date, "EEE") : ""}</span></li>)}</ul>
              ) : <p className="mt-2 text-ivory-dim">Not enough recorded this week to say.</p>}
            </div>
            <div>
              <h3 className="serif text-xl text-brass">Where Your Actions Did Not Match Your Intentions</h3>
              {selected.mismatched?.length ? (
                <ul className="mt-2 space-y-2">{selected.mismatched.map((e, i) => <li key={i} className="flex justify-between gap-3"><span>{e.text}</span><span className="shrink-0 text-xs text-ivory-faint">{e.date ? formatLocalDate(e.date, "EEE") : ""}</span></li>)}</ul>
              ) : <p className="mt-2 text-ivory-dim">Nothing recorded that fell short — or nothing recorded at all. Check the sample above.</p>}
            </div>

            {selected.interpretation && (
              <div className="rounded-[14px] bg-surface p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-ivory-faint">Interpretation · written by Claude from the numbers above</p>
                <p className="serif mt-2 whitespace-pre-line text-[1.05rem] leading-relaxed">{selected.interpretation}</p>
                {selected.priorities?.length > 0 && (
                  <>
                    <p className="mt-4 text-sm text-ivory-dim">Adjustments for next week</p>
                    <ol className="mt-1 list-decimal space-y-1 pl-5">{selected.priorities.map((p, i) => <li key={i}>{p}</li>)}</ol>
                  </>
                )}
              </div>
            )}

            {rs.length > 1 && (
              <nav className="flex flex-wrap gap-2" aria-label="Earlier reports">
                {rs.map((r) => (
                  <Link key={r.id} href={`/progress?report=${r.id}`} className="chip" data-on={r.id === selected.id}>{formatLocalDate(r.week_start, "MMM d")}</Link>
                ))}
              </nav>
            )}
          </article>
        )}
      </section>

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
