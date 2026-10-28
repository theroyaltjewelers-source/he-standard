import Link from "next/link";
import { requireUser } from "@/lib/session";
import { formatInZone, formatLocalDate, localDateString, shiftDate, todayIn } from "@/lib/time";
import { eventsBetween } from "@/lib/records";
import { computeScores, commitmentIntegrity, dailyExecution, trend, PERIODS, POLICY_V1, DOMAIN_LABEL, type DomainKey, type Period } from "@/lib/scoring";
import { loadScoringInput } from "@/lib/scoring/load";
import { pickInsight } from "@/lib/insights";
import { nextPrayer, PRAYER_LABEL } from "@/lib/prayer";
import { prayerConfig, type PrayerSettingsRow } from "@/lib/reminders";
import { TrendChart } from "@/components/charts/trend-chart";
import { RadialGauge, SegmentBar, Sparkline, WeekBars } from "@/components/charts/static-charts";
import { DOMAIN_COLOR } from "@/components/charts/domain-colors";
import { WeeklyReport, type ReportRow } from "@/components/weekly-report";
import { AnimatedNumber } from "@/components/ui/animated-number";
import type { Goal } from "@/lib/types";

export const metadata = { title: "Progress" };

const pctText = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

/**
 * PERSONAL EVOLUTION — every number here is computed by the deterministic
 * scoring engine from stored records (policy shown on the page). Sections
 * without enough evidence say so instead of showing a number.
 */
export default async function Progress({ searchParams }: PageProps<"/progress">) {
  const sp = await searchParams;
  const { supabase, profile, today } = await requireUser();
  const tz = profile.timezone;
  const now = new Date();
  const period = (PERIODS.some((p) => p.key === sp.period) ? sp.period : "30d") as Period;
  const pdef = PERIODS.find((p) => p.key === period)!;
  const since = todayIn(tz, new Date(profile.created_at ?? now));
  const periodStart = pdef.days ? shiftDate(today, -(pdef.days - 1)) : since;
  const span = pdef.days ?? Math.max(1, Math.round((Date.parse(today) - Date.parse(since)) / 864e5) + 1);
  const prevStart = shiftDate(periodStart, -span);
  const loadFrom = [shiftDate(periodStart, -30), prevStart, shiftDate(today, -34)].sort()[0];

  // All independent reads in one round.
  const [input, { data: distractionRows }, [occ, { data: upTasks }, { data: upCommit }, { data: goals }, { data: milestones }, { data: progress }, { data: ps }, { data: conf }], { data: reports }] = await Promise.all([
    loadScoringInput(supabase, { from: loadFrom, today, tz, since }),
    supabase.from("focus_sessions").select("distractions").gte("started_at", new Date(Date.parse(periodStart) - 864e5).toISOString()),
    Promise.all([
      eventsBetween(supabase, today, shiftDate(today, 7), tz),
      supabase.from("tasks").select("id,title,due_at").eq("status", "pending").gte("due_at", now.toISOString()).order("due_at").limit(6),
      supabase.from("commitments").select("id,title,promised_by,made_to").eq("status", "open").gte("promised_by", now.toISOString()).order("promised_by").limit(6),
      supabase.from("goals").select("*").eq("status", "active").order("target_date", { nullsFirst: false }),
      supabase.from("goal_milestones").select("goal_id,title,due_date,completed_at"),
      supabase.from("goal_progress").select("goal_id,progress_pct,created_at").order("created_at", { ascending: false }),
      supabase.from("prayer_settings").select("*").maybeSingle<PrayerSettingsRow>(),
      supabase.from("prayer_confirmations").select("prayer").eq("prayer_date", today),
    ]),
    supabase.from("weekly_reports").select("*").order("week_start", { ascending: false }).limit(12),
  ]);
  const report = computeScores({ ...input, from: periodStart, to: today });
  const previous = computeScores({ ...input, from: prevStart, to: shiftDate(periodStart, -1) });
  const tr = trend(input, period, since);
  const integrity = commitmentIntegrity(input.commitments, periodStart, today, today, now);
  const insight = pickInsight(input, report, previous.overall !== null || previous.domains.some((d) => d.score !== null) ? previous : null);

  // Execution per day for the period (weekly buckets when long)
  const exec = dailyExecution(input, periodStart, today);
  const execBuckets = exec.length <= 31 ? exec.map((d) => ({ label: formatLocalDate(d.date, "MMM d"), planned: d.planned, done: d.done }))
    : Array.from({ length: Math.ceil(exec.length / 7) }, (_, k) => {
      const slice = exec.slice(k * 7, k * 7 + 7);
      return { label: `wk of ${formatLocalDate(slice[0].date, "MMM d")}`, planned: slice.reduce((n, d) => n + d.planned, 0), done: slice.reduce((n, d) => n + d.done, 0) };
    });
  const execMax = Math.max(1, ...execBuckets.map((b) => b.planned));
  const week = dailyExecution(input, shiftDate(today, -6), today).map((d) => ({ date: d.date, label: formatLocalDate(d.date, "EEEEE"), planned: d.planned, done: d.done, isToday: d.date === today }));

  // Focus capacity
  const focus = input.focus.filter((f) => f.date >= periodStart);
  const plannedMin = focus.reduce((n, f) => n + f.planned_minutes, 0);
  const completedMin = focus.filter((f) => f.status === "completed").reduce((n, f) => n + f.minutes, 0);
  const ended = focus.filter((f) => f.status !== "active");
  const focusRate = ended.length ? ended.filter((f) => f.status === "completed").length / ended.length : null;
  const weeklyFocus = Array.from({ length: 8 }, (_, k) => {
    const end = shiftDate(today, -7 * (7 - k)), start = shiftDate(end, -6);
    return input.focus.filter((f) => f.date >= start && f.date <= end && f.status === "completed").reduce((n, f) => n + f.minutes, 0);
  });
  const hourCounts = new Map<number, number>();
  for (const r of distractionRows ?? []) for (const d of (r.distractions ?? []) as { at: string }[]) { const h = Number(formatInZone(d.at, tz, "H")); hourCounts.set(h, (hourCounts.get(h) ?? 0) + 1); }
  const topHours = [...hourCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);

  // Upcoming, goals, fitness, prayer
  const upcoming = [
    ...occ.filter((o) => o.start > now && !o.event.all_day).map((o) => ({ id: `e-${o.event.id}-${o.start.getTime()}`, entity: o.event.id, title: o.event.title, at: o.start, kind: o.event.kind ?? "appointment", prep: o.event.prep_minutes + o.event.travel_minutes > 0 ? (o.event.plan_confirmed_at ? "Plan confirmed" : "Prep set") : "No prep needed", href: `/today?date=${o.date}#occ-${o.event.id}` })),
    ...(upTasks ?? []).map((t) => ({ id: `t-${t.id}`, entity: t.id, title: t.title, at: new Date(t.due_at!), kind: "task", prep: "Task deadline", href: "/word" })),
    ...(upCommit ?? []).map((c) => ({ id: `c-${c.id}`, entity: c.id, title: c.title, at: new Date(c.promised_by!), kind: "commitment", prep: c.made_to !== "self" ? `Promised to ${c.made_to}` : "Commitment", href: "/word" })),
  ].sort((a, b) => +a.at - +b.at).slice(0, 7);
  const { data: remRows } = upcoming.length ? await supabase.from("reminders").select("entity_id,send_at").eq("status", "scheduled").in("entity_id", [...new Set(upcoming.map((u) => u.entity))]) : { data: [] };
  const remFor = (id: string, at: Date) => (remRows ?? []).filter((r) => r.entity_id === id && Date.parse(r.send_at) <= at.getTime() + 6 * 3600_000).length;

  const latest = new Map<string, { pct: number | null; at: string }>();
  for (const p of progress ?? []) if (!latest.has(p.goal_id)) latest.set(p.goal_id, { pct: p.progress_pct, at: p.created_at });
  const goalCards = ((goals ?? []) as Goal[]).slice(0, 4).map((g) => {
    const ms = (milestones ?? []).filter((m) => m.goal_id === g.id);
    const l = latest.get(g.id);
    const nextMs = ms.filter((m) => !m.completed_at).sort((a, b) => (a.due_date ?? "9") < (b.due_date ?? "9") ? -1 : 1)[0];
    let risk: { label: string; tone: "ok" | "warn" | "none" } = { label: "Not enough data", tone: "none" };
    const created = (g as Goal & { created_at?: string }).created_at;
    if (l && l.pct !== null && g.target_date && created) {
      const elapsed = Math.min(1, Math.max(0, (now.getTime() - Date.parse(created)) / (Date.parse(g.target_date) - Date.parse(created))));
      risk = l.pct + 15 < elapsed * 100 ? { label: `Behind pace (${l.pct}% done, ${Math.round(elapsed * 100)}% of time used)`, tone: "warn" } : { label: "On pace", tone: "ok" };
    }
    if (l && now.getTime() - Date.parse(l.at) > 14 * 864e5) risk = { label: "No progress logged in 14+ days", tone: "warn" };
    return { g, ms, l, nextMs, risk };
  });

  const workoutsScheduled = input.occurrences.filter((o) => o.kind === "workout" && o.date >= periodStart && Date.parse(o.start) <= now.getTime());
  const wDone = workoutsScheduled.filter((o) => o.status === "completed" || o.status === "completed_late").length;
  const wResolved = workoutsScheduled.filter((o) => !["rescheduled", "excused", "scheduled", "awaiting_confirmation", "started"].includes(o.status)).length;
  const wAwaiting = workoutsScheduled.filter((o) => o.status === "awaiting_confirmation").length;
  const logged = input.workouts.filter((w) => w.date >= periodStart);
  const perWeek = logged.length / Math.max(1, Math.min(span, exec.length) / 7);
  const recovery = logged.filter((w) => w.type === "recovery" || w.type === "mobility").length;

  const pcfg = ps ? prayerConfig(ps, tz) : null;
  const np = pcfg ? nextPrayer(today, pcfg, now) : null;

  const labels = tr.points.map((p) => formatLocalDate(p.date, tr.points.length > 60 ? "MMM d, yy" : "MMM d"));
  const delta = report.overall !== null && previous.overall !== null ? report.overall - previous.overall : null;
  const evoSummary = report.overall === null
    ? `Insufficient data for an overall score in this period. ${report.excluded.length} of 7 domains lack evidence.`
    : `Overall ${report.overall} for the selected period, based on ${Math.round(report.coverageWeight * 100)}% of the scoring weight.${delta !== null ? ` ${delta >= 0 ? "Up" : "Down"} ${Math.abs(delta)} points from the previous period.` : ""}`;


  return (
    <div className="bleed space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="h-page">Personal evolution</h1>
          <p className="mt-1.5 text-ivory-dim">Measured from what you recorded — never from how the week felt.</p>
        </div>
        <nav className="seg" aria-label="Period">
          {PERIODS.map((p) => <Link key={p.key} href={`/progress?period=${p.key}`} aria-current={p.key === period ? "true" : undefined}>{p.label}</Link>)}
        </nav>
      </header>

      <div className="grid gap-4 lg:grid-cols-12">
        {/* 7.1 Personal Evolution */}
        <section aria-labelledby="evo-h" className="card card-feature lg:col-span-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 id="evo-h" className="eyebrow">Personal evolution · {pdef.label}</h2>
              <div className="mt-2 flex items-baseline gap-3">
                {report.overall !== null ? <AnimatedNumber value={report.overall} className="metric text-6xl" /> : <span className="metric text-6xl text-ivory-faint">—</span>}
                {delta !== null && <span className={`text-sm tabular ${delta >= 0 ? "text-emerald" : "text-brass"}`}>{delta >= 0 ? "▲" : "▼"} {Math.abs(delta)} vs previous {pdef.label}</span>}
              </div>
              <p className="mt-1 max-w-md text-sm text-ivory-dim">
                {report.overall === null ? "Not enough evidence yet for an overall score in this period." : `Based on ${Math.round(report.coverageWeight * 100)}% of the scoring weight.`}
                {report.excluded.length > 0 && ` Excluded: ${report.excluded.map((e) => e.label).join(", ")}.`}
              </p>
            </div>
          </div>
          <div className="mt-4">
            <TrendChart labels={labels} summary={evoSummary}
              series={[{ key: "overall", label: "Overall", color: "var(--color-lime)", values: tr.points.map((p) => p.overall), area: true }]} />
          </div>
          <p className="mt-2 text-xs text-ivory-faint">Each point is the score of the trailing {tr.window} days. Gaps mean that window lacked evidence — nothing is interpolated.</p>
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-ivory-dim hover:text-ivory">How this is scored · policy {POLICY_V1.version}</summary>
            <ul className="mt-2 grid gap-1 text-ivory-dim sm:grid-cols-2">
              {(Object.keys(POLICY_V1.weights) as DomainKey[]).map((k) => <li key={k} className="flex justify-between gap-3"><span>{DOMAIN_LABEL[k]}</span><span className="tabular">{Math.round(POLICY_V1.weights[k] * 100)}%</span></li>)}
            </ul>
            <p className="mt-2 text-xs text-ivory-faint">A metric needs at least {POLICY_V1.minEvents} eligible events. Unknown outcomes are excluded, never counted as failure. Late = {POLICY_V1.lateCredit * 100}% credit. Rescheduling keeps the original deadline. No overall score below {POLICY_V1.minCoverageForOverall * 100}% weight coverage. Scores measure behaviour — not your worth, intelligence or faith. Claude can explain them but cannot change them.</p>
          </details>
        </section>

        {/* 7.2 Development Balance */}
        <section aria-labelledby="bal-h" className="card lg:col-span-4">
          <h2 id="bal-h" className="eyebrow">Development balance</h2>
          <div className="mt-3">
            <RadialGauge
              segments={report.domains.map((d) => ({ key: d.key, label: d.label, weight: d.weight, score: d.score, color: DOMAIN_COLOR[d.key] }))}
              center={report.overall === null ? "—" : String(report.overall)}
              sub={`${report.domains.filter((d) => d.score !== null).length} of 7 domains with evidence`} />
          </div>
          <ul className="mt-2 space-y-1.5 text-xs">
            {report.domains.map((d) => (
              <li key={d.key} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-ivory-dim"><span aria-hidden className="inline-block size-2 rounded-full" style={{ background: d.score === null ? "transparent" : DOMAIN_COLOR[d.key], border: d.score === null ? "1px dashed var(--color-ivory-faint)" : undefined }} />{d.label}</span>
                <span className="tabular text-ivory">{d.score ?? <span className="text-ivory-faint">insufficient</span>}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ivory-faint">Arc length = weight. Dashed = not enough evidence.</p>
        </section>

        {/* 7.3 Commitment Integrity */}
        <section aria-labelledby="ci-h" className="card lg:col-span-4">
          <h2 id="ci-h" className="eyebrow">Commitment integrity</h2>
          <p className="mt-2 flex items-baseline gap-2">
            <span className="metric text-5xl">{pctText(integrity.onTimeRate)}</span>
            <span className="text-sm text-ivory-dim">on time</span>
          </p>
          <p className="mb-4 text-xs text-ivory-faint">{integrity.onTimeRate === null ? `Needs ${POLICY_V1.minEvents}+ resolved commitments (${integrity.eligible} so far).` : `${integrity.onTime} of ${integrity.eligible} resolved, against original deadlines.`}</p>
          <SegmentBar segments={[
            { key: "on", label: "On time", value: integrity.onTime, color: "var(--color-emerald)" },
            { key: "late", label: "Late", value: integrity.late, color: "var(--color-lime)" },
            { key: "missed", label: "Missed", value: integrity.missed, color: "var(--color-brass)" },
            { key: "await", label: "Awaiting", value: integrity.awaiting, color: "var(--color-ivory-faint)", pattern: true },
            { key: "unknown", label: "Unknown", value: integrity.unknown, color: "var(--color-line-strong)", pattern: true },
            { key: "excused", label: "Excused", value: integrity.excused, color: "var(--color-violet)" },
          ]} />
          <p className="mt-3 text-xs text-ivory-faint">{integrity.rescheduled} rescheduled (original deadline kept).</p>
        </section>

        {/* 7.4 Focus Capacity */}
        <section aria-labelledby="fc-h" className="card lg:col-span-4">
          <h2 id="fc-h" className="eyebrow">Focus capacity</h2>
          <p className="mt-2 flex items-baseline gap-2"><span className="metric text-5xl">{Math.floor(completedMin / 60)}<span className="text-2xl">h</span> {completedMin % 60}<span className="text-2xl">m</span></span></p>
          <p className="text-xs text-ivory-faint tabular">completed of {Math.floor(plannedMin / 60)}h {plannedMin % 60}m planned · completion {pctText(focusRate)} ({ended.length} sessions)</p>
          <div className="mt-4 flex h-16 items-end gap-1.5" role="img" aria-label={`Focus minutes per week, last 8 weeks: ${weeklyFocus.join(", ")}`}>
            {weeklyFocus.map((m, k) => {
              const max = Math.max(1, ...weeklyFocus);
              return <span key={k} className={`flex-1 rounded-t-[4px] ${k === 7 ? "bg-lime" : "bg-surface-3"}`} style={{ height: `${m ? Math.max(6, (m / max) * 100) : 2}%` }} title={`${m} min`} />;
            })}
          </div>
          <p className="mt-1 text-[0.7rem] text-ivory-faint">Weekly focus minutes, last 8 weeks</p>
          <p className="mt-3 text-xs text-ivory-dim">{topHours.length ? `Most distractions logged around ${topHours.map(([h, n]) => `${new Date(2000, 0, 1, h).toLocaleTimeString("en-US", { hour: "numeric" })} (${n})`).join(" and ")}.` : "No distractions logged in this period."}</p>
        </section>

        {/* 7.12 AI Insight */}
        <section aria-labelledby="ins-h" className="card card-violet lg:col-span-4">
          <h2 id="ins-h" className="eyebrow">Insight · from your records</h2>
          {insight ? (
            <>
              <p className="mt-2 text-lg font-semibold leading-snug tracking-tight">{insight.title}</p>
              <p className="mt-2 text-sm text-ivory">{insight.recommendation}</p>
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer text-ivory-dim hover:text-ivory">Why this recommendation?</summary>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-ivory-dim">{insight.evidence.map((e) => <li key={e}>{e}</li>)}</ul>
                <p className="mt-2 text-ivory-faint">Basis: {insight.basis}</p>
              </details>
              <Link href={`/coach?q=${encodeURIComponent(`Explain this insight and help me act on it: ${insight.title}. ${insight.evidence.join(" ")}`)}`} className="mt-3 inline-block text-xs text-accent hover:underline">Discuss with the Coach</Link>
            </>
          ) : (
            <p className="mt-2 text-sm text-ivory-dim">No pattern is strong enough yet to recommend a change. Insights appear once there are a few weeks of recorded outcomes.</p>
          )}
        </section>

        {/* 7.7 Discipline Trends */}
        <section aria-labelledby="dt-h" className="card lg:col-span-8">
          <h2 id="dt-h" className="eyebrow">Discipline trends · planned vs completed</h2>
          <div className="mt-4">
            <TrendChart labels={execBuckets.map((b) => b.label)} yMax={execMax} height={180}
              summary={`Planned versus completed activities over ${pdef.label}: ${execBuckets.reduce((n, b) => n + b.done, 0)} completed of ${execBuckets.reduce((n, b) => n + b.planned, 0)} planned.`}
              series={[
                { key: "planned", label: "Planned", color: "var(--color-ivory-faint)", values: execBuckets.map((b) => b.planned), dashed: true },
                { key: "done", label: "Completed", color: "var(--d1)", values: execBuckets.map((b) => b.done), area: true },
              ]} />
          </div>
        </section>

        {/* 7.9 Weekly Execution */}
        <section aria-labelledby="we-h" className="card lg:col-span-4">
          <h2 id="we-h" className="eyebrow">Weekly execution</h2>
          <p className="mt-2 text-sm text-ivory-dim tabular">{week.reduce((n, d) => n + d.done, 0)} of {week.reduce((n, d) => n + d.planned, 0)} planned items done in 7 days</p>
          <div className="mt-4"><WeekBars days={week} /></div>
        </section>

        {/* 7.8 Development Categories */}
        <section aria-labelledby="cat-h" className="lg:col-span-12">
          <h2 id="cat-h" className="h-section mb-3">Development categories</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {report.domains.map((d) => {
              const spark = tr.points.map((p) => p.domains[d.key]);
              return (
                <details key={d.key} className="card card-hover group p-4">
                  <summary className="cursor-pointer list-none">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="flex items-center gap-1.5 text-sm"><span aria-hidden className="inline-block size-2 rounded-full" style={{ background: DOMAIN_COLOR[d.key] }} />{d.label}</p>
                        <p className="metric mt-2 text-3xl">{d.score ?? <span className="text-xl text-ivory-faint">Insufficient data</span>}</p>
                      </div>
                      <Sparkline values={spark} color={DOMAIN_COLOR[d.key]} label={`${d.label} trend`} />
                    </div>
                    <p className="mt-1 text-xs text-ivory-faint">{d.score !== null ? `${d.denominator} events · weight ${Math.round(d.weight * 100)}%` : d.reason}</p>
                    <p className="mt-2 text-xs text-accent group-open:hidden">Show evidence</p>
                  </summary>
                  <ul className="mt-3 space-y-3 border-t border-line pt-3 text-xs">
                    {d.metrics.map((m) => (
                      <li key={m.key}>
                        <div className="flex justify-between gap-2"><span className="text-ivory">{m.label}</span><span className="tabular">{m.status === "ok" ? `${Math.round((m.value ?? 0) * 100)}%` : "insufficient"}</span></div>
                        <p className="tabular text-ivory-dim">{Number.isInteger(m.numerator) ? m.numerator : m.numerator.toFixed(1)} / {m.denominator}{m.unknown ? ` · ${m.unknown} unknown (not counted)` : ""}{m.excluded ? ` · ${m.excluded} excluded` : ""}</p>
                        <p className="text-ivory-faint">{m.eligible} {m.exclusions}</p>
                        <p className="text-ivory-faint">Evidence: {m.evidence.confirmed} confirmed · {m.evidence.self_reported} self-reported · {m.evidence.imported} imported · {m.evidence.unverified} unverified. Source: {m.source}.</p>
                      </li>
                    ))}
                  </ul>
                </details>
              );
            })}
          </div>
        </section>

        {/* 7.5 Upcoming Commitments */}
        <section aria-labelledby="up-h" className="card lg:col-span-6">
          <div className="flex items-baseline justify-between"><h2 id="up-h" className="eyebrow">Upcoming commitments</h2><Link href="/today" className="text-xs text-ivory-dim hover:text-ivory">Today</Link></div>
          {upcoming.length ? (
            <ul className="mt-3 divide-y divide-line">
              {upcoming.map((u) => {
                const rems = remFor(u.entity, u.at);
                return (
                  <li key={u.id}>
                    <Link href={u.href} className="flex items-center justify-between gap-3 py-2.5 hover:text-ivory">
                      <span className="min-w-0">
                        <span className="block truncate">{u.title}</span>
                        <span className="block text-xs text-ivory-faint">{u.kind.replace("_", " ")} · {u.prep}</span>
                      </span>
                      <span className="shrink-0 text-right text-xs">
                        <span className="block tabular text-ivory">{localDateString(u.at, tz) === today ? formatInZone(u.at, tz, "h:mm a") : formatInZone(u.at, tz, "EEE h:mm a")}</span>
                        <span className={`block ${rems ? "text-emerald" : "text-ivory-faint"}`}>{rems ? `${rems} reminder${rems > 1 ? "s" : ""} set` : "no reminder"}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : <p className="mt-3 text-sm text-ivory-dim">Nothing scheduled in the next 7 days.</p>}
        </section>

        {/* 7.6 Goal Progress */}
        <section aria-labelledby="gp-h" className="card lg:col-span-6">
          <div className="flex items-baseline justify-between"><h2 id="gp-h" className="eyebrow">Goal progress</h2><Link href="/progress/goals" className="text-xs text-ivory-dim hover:text-ivory">All goals</Link></div>
          {goalCards.length ? (
            <ul className="mt-3 space-y-4">
              {goalCards.map(({ g, ms, l, nextMs, risk }) => (
                <li key={g.id}>
                  <Link href={`/goals/${g.id}`} className="block">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate font-medium">{g.title}</span>
                      <span className="shrink-0 tabular text-sm">{l?.pct != null ? `${l.pct}%` : "—"}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 rounded-full bg-surface-3">{l?.pct != null && <div className="h-1.5 rounded-full bg-lime" style={{ width: `${l.pct}%` }} />}</div>
                    <p className="mt-1 text-xs text-ivory-faint">
                      {ms.length ? `${ms.filter((m) => m.completed_at).length}/${ms.length} milestones · ` : ""}{g.target_date ? `target ${formatLocalDate(g.target_date, "MMM d, yyyy")} · ` : ""}
                      {l ? `updated ${formatLocalDate(l.at.slice(0, 10), "MMM d")}` : "no progress logged"}
                    </p>
                    <p className="text-xs"><span className="text-ivory-dim">Next: {nextMs ? nextMs.title : "log progress"}</span> · <span className={risk.tone === "warn" ? "text-brass" : risk.tone === "ok" ? "text-emerald" : "text-ivory-faint"}>{risk.label}</span></p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="mt-3 text-sm text-ivory-dim">No active goals. <Link href="/goals/new" className="text-accent hover:underline">Create one</Link> with a measurable outcome.</p>}
        </section>

        {/* 7.10 Fitness Consistency */}
        <section aria-labelledby="fit-h" className="card card-emerald lg:col-span-6">
          <h2 id="fit-h" className="eyebrow">Fitness consistency</h2>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <div><p className="metric text-4xl">{wResolved ? `${wDone}/${wResolved}` : "—"}</p><p className="text-xs text-ivory-faint">scheduled workouts done</p></div>
            <div><p className="metric text-4xl">{logged.length ? perWeek.toFixed(1) : "—"}</p><p className="text-xs text-ivory-faint">sessions / week{input.workoutTargetPerWeek ? ` (target ${input.workoutTargetPerWeek})` : ""}</p></div>
            <div><p className="metric text-4xl">{recovery}</p><p className="text-xs text-ivory-faint">recovery / mobility sessions</p></div>
          </div>
          <p className="mt-3 text-xs text-ivory-faint">
            {wAwaiting ? `${wAwaiting} workout${wAwaiting > 1 ? "s" : ""} awaiting confirmation — not counted. ` : ""}
            {!input.workoutTargetPerWeek && <>Set a weekly target in <Link href="/settings" className="text-accent hover:underline">Settings</Link> to measure frequency. </>}
            Schedule workouts as a “Workout” activity to get start and completion check-ins.
          </p>
        </section>

        {/* 7.11 Spiritual Companion — separate from productivity grading */}
        <section aria-labelledby="sp-h" className="card card-violet lg:col-span-6">
          <h2 id="sp-h" className="eyebrow">Spiritual companion</h2>
          {np ? (
            <>
              <p className="mt-2 text-2xl font-semibold tracking-tight">{PRAYER_LABEL[np.prayer]} <span className="text-ivory-dim">{formatInZone(np.at, tz, "h:mm a")}{np.date !== today ? " tomorrow" : ""}</span></p>
              <p className="mt-1 text-sm text-ivory-dim">{(conf ?? []).length} of 5 confirmed today.</p>
            </>
          ) : <p className="mt-2 text-sm text-ivory-dim"><Link href="/faith" className="text-accent hover:underline">Set your location</Link> for prayer times.</p>}
          <p className="mt-3 text-xs text-ivory-faint">Prayer is never part of any score. Unconfirmed is never recorded as missed.</p>
        </section>
      </div>

      <WeeklyReport reports={(reports ?? []) as ReportRow[]} selectedId={typeof sp.report === "string" ? sp.report : null} />
    </div>
  );
}
