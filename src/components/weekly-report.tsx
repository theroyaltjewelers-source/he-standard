import Link from "next/link";
import { formatLocalDate, shiftDate } from "@/lib/time";
import { Empty } from "@/components/page-header";
import { generateReportNow } from "@/app/actions/progress";
import type { Example, WeeklyMetrics } from "@/lib/weekly";

export interface ReportRow {
  id: string; week_start: string; period_start: string | null; period_end: string | null;
  metrics: WeeklyMetrics; sample: Record<string, number>; matched: Example[]; mismatched: Example[];
  interpretation: string | null; priorities: string[]; model: string | null; generated_at: string;
}

function pct(n: number, d: number) { return d ? `${Math.round((n / d) * 100)}%` : "—"; }

/** Weekly performance report: measured numbers, matched/mismatched examples with sample sizes, optional labelled interpretation. */
export function WeeklyReport({ reports, selectedId }: { reports: ReportRow[]; selectedId?: string | null }) {
  const rs = reports;
  const selected = rs.find((r) => r.id === selectedId) ?? rs[0];
  const m = selected?.metrics;
  return (
      <section className="card bleed">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="h-section">Weekly report</h2>
          <form action={generateReportNow} className="flex gap-2">
            <button name="week" value="this" className="text-sm text-accent hover:underline">Generate this week so far</button>
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
                  <div key={x.k} className="rounded-[16px] border border-line bg-surface-2/50 p-3">
                    <dt className="text-xs text-ivory-faint">{x.k}</dt>
                    <dd className="metric mt-1 text-2xl">{x.v}</dd>
                    {x.sub && <dd className="text-xs text-ivory-faint">{x.sub}</dd>}
                  </div>
                ))}
              </dl>
            )}

            <div>
              <h3 className="h-section text-emerald">Where Your Actions Matched Your Values</h3>
              {selected.matched?.length ? (
                <ul className="mt-2 space-y-2">{selected.matched.map((e, i) => <li key={i} className="flex justify-between gap-3"><span>{e.text}</span><span className="shrink-0 text-xs text-ivory-faint">{e.date ? formatLocalDate(e.date, "EEE") : ""}</span></li>)}</ul>
              ) : <p className="mt-2 text-ivory-dim">Not enough recorded this week to say.</p>}
            </div>
            <div>
              <h3 className="h-section text-brass">Where Your Actions Did Not Match Your Intentions</h3>
              {selected.mismatched?.length ? (
                <ul className="mt-2 space-y-2">{selected.mismatched.map((e, i) => <li key={i} className="flex justify-between gap-3"><span>{e.text}</span><span className="shrink-0 text-xs text-ivory-faint">{e.date ? formatLocalDate(e.date, "EEE") : ""}</span></li>)}</ul>
              ) : <p className="mt-2 text-ivory-dim">Nothing recorded that fell short — or nothing recorded at all. Check the sample above.</p>}
            </div>

            {selected.interpretation && (
              <div className="rounded-[16px] bg-surface-2 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-ivory-faint">Interpretation · written by Claude from the numbers above</p>
                <p className="reading mt-2 whitespace-pre-line text-[1.05rem] leading-relaxed">{selected.interpretation}</p>
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

  );
}
