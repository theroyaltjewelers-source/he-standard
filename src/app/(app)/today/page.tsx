import Link from "next/link";
import { requireUser } from "@/lib/session";
import { hijriDate } from "@/lib/hijri";
import { eventsBetween, integritySeries } from "@/lib/records";
import { formatClock, formatInZone, formatLocalDate, shiftDate, weekStart, dayOfWeek } from "@/lib/time";
import type { DailyPlan, Habit, HabitLog, QuranVerse, Task } from "@/lib/types";
import { nextPrayer, PRAYERS, PRAYER_LABEL, prayerTimesFor } from "@/lib/prayer";
import { prayerConfig, type PrayerSettingsRow } from "@/lib/reminders";
import { pickIndex } from "@/lib/quran";
import { buildTimeline } from "@/lib/timeline";
import { confirmPrayer } from "@/app/actions/faith";
import { IntegrityPanel } from "@/components/integrity";
import { TaskItem } from "@/components/task-item";
import { QuickTask } from "@/components/quick-task";
import { PushToggle } from "@/components/push-toggle";
import { CommandCenter } from "@/components/command-center";
import { getVapidPublicKey } from "@/lib/app-config";
import { logHabit } from "@/app/actions/goals";
import { reconcileUser } from "@/lib/rollover";
import { POLICY_V1 } from "@/lib/scoring";
import { LiveClock, CountdownTo } from "@/components/live-clock";
import { todayIn } from "@/lib/time";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verseTotal } from "@/lib/quran-count";
import { FoodSummary } from "@/components/food/food-log";
import type { FoodEntryRow } from "@/app/actions/food";

export const metadata = { title: "Today" };

/**
 * DAILY COMMAND CENTER — mobile-first: what to do now, what's next, prayer,
 * the Coach, today's accountability, then the full timeline.
 */
export default async function Today({ searchParams }: PageProps<"/today">) {
  const sp = await searchParams;
  const { supabase, user, profile, today } = await requireUser();
  const tz = profile.timezone;
  const now = new Date();
  const date = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  const isToday = date === today;
  const wk = weekStart(date);
  const isPast = date < today;

  // Everything this page needs is requested at once (one round of queries).
  const prefsP = supabase.from("user_preferences").select("midday_checkin_time,last_reconciled_on").maybeSingle();
  const timelineP = prefsP.then(({ data }) => buildTimeline(supabase, date, tz, profile, data ? data.midday_checkin_time : "13:00"));
  const verseP = verseTotal(supabase).then(async (n) => {
    if (!n) return null;
    const i = pickIndex(date, profile.id, n);
    const { data } = await supabase.from("quran_verses").select("*").order("surah").order("ayah").range(i, i);
    return (data?.[0] ?? null) as QuranVerse | null;
  });
  const [{ data: prefs }, timeline, verse, { data: plan }, { data: overdue }, { data: habits }, { data: habitLogs }, { data: sessions }, series, { data: prayerSettings }, { data: prayerConf }, { count: pendingMemories }, events, { data: goals }, vapidKey, { data: foodRows }] = await Promise.all([
    prefsP,
    timelineP,
    verseP,
    supabase.from("daily_plans").select("*").eq("plan_date", date).maybeSingle<DailyPlan>(),
    supabase.from("tasks").select("*").lt("scheduled_for", today).eq("status", "pending").order("scheduled_for"),
    supabase.from("habits").select("*").eq("active", true).order("created_at"),
    supabase.from("habit_logs").select("*").gte("log_date", wk).lte("log_date", date),
    supabase.from("accountability_sessions").select("kind,status").eq("session_date", date),
    integritySeries(supabase, shiftDate(date, -6), date, today),
    supabase.from("prayer_settings").select("*").maybeSingle<PrayerSettingsRow>(),
    supabase.from("prayer_confirmations").select("prayer").eq("prayer_date", date),
    supabase.from("ai_memory").select("id", { count: "exact", head: true }).eq("status", "proposed"),
    eventsBetween(supabase, date, date, tz),
    supabase.from("goals").select("id,title").eq("status", "active"),
    isToday ? getVapidPublicKey() : Promise.resolve(null),
    supabase.from("food_entries").select("id,description,eaten_at,local_date,timezone,meal,portion,notes,created_at,updated_at").eq("local_date", date).order("eaten_at", { ascending: false }),
  ]);
  const middayTime: string | null = prefs ? prefs.midday_checkin_time : "13:00";
  // A new day with the app opened before the scheduler ran: reconcile after the
  // response is sent (the scheduler does the same every 15 minutes).
  if (isToday && (!prefs?.last_reconciled_on || prefs.last_reconciled_on < today)) {
    after(async () => {
      try { await reconcileUser(createAdminClient(), user.id, tz, today, todayIn(tz, new Date(profile.created_at ?? now))); } catch { /* retried by the scheduler */ }
    });
  }
  const pcfg = prayerSettings ? prayerConfig(prayerSettings, tz) : null;
  const prayerToday = pcfg ? prayerTimesFor(date, pcfg) : null;
  const upcomingPrayer = pcfg && isToday ? nextPrayer(today, pcfg, now) : null;
  const confirmedPrayers = new Set((prayerConf ?? []).map((c) => c.prayer));
  const awaitingConfirm = prayerToday ? PRAYERS.filter((p) => prayerToday[p] <= now && !confirmedPrayers.has(p)) : [];

  // Top three priorities: morning commitments first, then tasks marked as priorities.
  const priorities = [
    ...timeline.items.filter((i) => i.type === "commitment"),
    ...timeline.items.filter((i) => i.type === "task" && i.meta?.priority),
    ...timeline.untimedTasks.filter((t) => t.is_top_priority).map((t) => ({ id: `u-${t.id}`, title: t.title, state: t.status === "done" ? "completed" : t.status === "missed" ? "skipped" : "upcoming", start: null as string | null })),
  ].slice(0, 3) as { id: string; title: string; state: string; start: string | null }[];

  // What was recorded on a past day (shown as recorded, never with today's state).
  const history = isPast ? await (async () => {
    const [{ data: snap }, { data: journal }, { data: sess }, { data: workouts }, { data: moved }] = await Promise.all([
      supabase.from("daily_scores").select("*").eq("score_date", date).order("computed_at", { ascending: false }),
      supabase.from("journal_entries").select("id,title,body,mood,guided_mode").eq("entry_date", date).order("created_at"),
      supabase.from("accountability_sessions").select("id,kind,status,completed_at").eq("session_date", date),
      supabase.from("workout_logs").select("id,workout_type,duration_minutes,intensity,notes").eq("performed_on", date),
      supabase.from("tasks").select("id,title,scheduled_for,status").eq("original_scheduled_for", date).neq("scheduled_for", date),
    ]);
    const ids = (sess ?? []).map((x) => x.id);
    const { data: answers } = ids.length ? await supabase.from("accountability_answers").select("session_id,question,answer,skipped,follow_up_answer").in("session_id", ids) : { data: [] };
    return { snap: snap ?? [], journal: journal ?? [], sess: sess ?? [], answers: answers ?? [], workouts: workouts ?? [], moved: moved ?? [] };
  })() : null;
  const storedScore = history?.snap.find((x) => x.policy_version === POLICY_V1.version) ?? history?.snap[0] ?? null;

  const od = isToday ? ((overdue ?? []) as Task[]) : [];
  const hs = (habits ?? []) as Habit[];
  const logs = (habitLogs ?? []) as HabitLog[];
  const done = (k: string) => (sessions ?? []).some((s) => s.kind === k && s.status === "completed");
  const todayScore = series[series.length - 1].result;
  const localHour = Number(formatInZone(now, tz, "H"));
  const dow = dayOfWeek(date);

  // Now & next
  const actionable = timeline.items.filter((i) => i.type !== "buffer" && i.type !== "focus" && !i.meta?.allDay);
  const current = actionable.find((i) => i.state === "active");
  const nextUp = actionable.find((i) => i.state === "upcoming");
  const minutesUntil = nextUp ? Math.round((Date.parse(nextUp.start) - now.getTime()) / 60_000) : null;

  // Evidence-based attention list (rule-based, from records)
  const attention: { text: string; href: string; why: string }[] = [];
  if (isToday) {
    if (!done("morning") && localHour < 15) attention.push({ text: "Set today's priorities", href: "/checkin/morning", why: "No morning plan recorded today." });
    const awaiting = timeline.items.filter((i) => i.state === "awaiting" && i.type !== "checkin" && i.type !== "prayer");
    if (awaiting.length) attention.push({ text: `${awaiting.length} item${awaiting.length > 1 ? "s" : ""} awaiting confirmation — record what happened`, href: "#tl-h", why: "Past their time with no outcome recorded. Unknown is never counted as missed." });
    if (od.length) attention.push({ text: `${od.length} open task${od.length > 1 ? "s" : ""} from earlier days`, href: "#anytime", why: "Scheduled before today and still open." });
    for (const t of [...timeline.untimedTasks, ...od].filter((t) => t.status === "pending" && t.postponed_count >= 2).slice(0, 2)) {
      attention.push({ text: `“${t.title}” has been postponed ${t.postponed_count} times. What is the obstacle to starting?`, href: "/word", why: `Postponed ${t.postponed_count}×.` });
    }
    for (const o of events.filter((o) => o.event.importance === "high" && !o.event.plan_confirmed_at && o.start > now)) attention.push({ text: `Confirm your preparation plan for ${o.event.title}`, href: `/plan/${o.event.id}`, why: "Important appointment without a confirmed plan." });
    if (middayTime && !done("midday") && done("morning") && localHour >= Number(middayTime.slice(0, 2)) && localHour < 17) attention.push({ text: "Two-minute midday check-in", href: "/checkin/midday", why: "Midday check-in time has passed." });
    if (pendingMemories) attention.push({ text: `The Coach proposed ${pendingMemories} thing${pendingMemories > 1 ? "s" : ""} to remember — keep or reject`, href: "/settings/memory", why: "Nothing proposed is used until you approve it." });
    if (!done("evening") && localHour >= 17) attention.push({ text: "Complete the evening review", href: "/checkin/evening", why: "Evening review not yet recorded." });
  }

  const greeting = localHour < 12 ? "Good morning" : localHour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="bleed space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-ivory-dim">{isToday ? `${greeting}${profile.display_name ? `, ${profile.display_name}` : ""}.` : "Viewing another day"}</p>
          <h1 className="h-page mt-1">{formatLocalDate(date, "EEEE, MMMM d")}</h1>
          <p className="mt-1 text-sm text-ivory-faint">{hijriDate(date, profile.hijri_adjustment_days)}{isToday && <> · <LiveClock timeZone={tz} /></>}</p>
          {sp.welcome && <p className="mt-3 text-sm text-emerald">You&apos;re set up. Start with the morning check-in.</p>}
          {sp.checkin === "morning" && <p className="mt-3 text-sm text-emerald">Morning commitments recorded. Reminders are set for each.</p>}
          {sp.checkin === "midday" && <p className="mt-3 text-sm text-emerald">Midday check-in recorded.</p>}
          {sp.checkin === "evening" && <p className="mt-3 text-sm text-emerald">Evening review recorded.</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <nav className="seg" aria-label="Day">
            <Link href={`/today?date=${shiftDate(date, -1)}`} aria-label="Previous day">‹</Link>
            <Link href="/today" aria-current={isToday ? "true" : undefined}>Today</Link>
            <Link href={`/today?date=${shiftDate(date, 1)}`} aria-label="Next day">›</Link>
          </nav>
          <form action="/today" className="flex items-center gap-1">
            <input type="date" name="date" defaultValue={date} max={shiftDate(today, 60)} className="field h-9 w-auto py-1 text-sm" aria-label="Go to date" />
            <button className="chip">Go</button>
          </form>
        </div>
      </header>

      {isToday && <div className="max-w-2xl"><PushToggle vapidKey={vapidKey} compact /></div>}
      {isPast && (
        <p className="rounded-[14px] border border-line bg-surface px-4 py-2.5 text-sm text-ivory-dim">You&apos;re viewing a past day exactly as it was recorded. Anything you record now is saved as <b>reported later</b>.</p>
      )}

      <div className="grid gap-4 lg:grid-cols-12">
        {/* Now & next */}
        <section aria-label="Now and next" className="card card-feature lg:col-span-7">
          {current ? (
            <>
              <p className="eyebrow">Now</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight">{current.title}</p>
              <p className="mt-1 text-sm text-ivory-dim">{formatInZone(current.start, tz, "h:mm a")}{current.end ? `–${formatInZone(current.end, tz, "h:mm a")}` : ""}{current.subtitle ? ` · ${current.subtitle}` : ""}</p>
              <a href={current.type === "event" ? `#occ-${current.ref}` : "#tl-h"} className="btn btn-primary mt-4">Record progress</a>
            </>
          ) : nextUp ? (
            <>
              <p className="eyebrow">Next{minutesUntil !== null ? ` · in ${minutesUntil < 60 ? `${minutesUntil} min` : `${Math.floor(minutesUntil / 60)} h ${minutesUntil % 60} min`}` : ""}</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight">{nextUp.title}</p>
              <p className="mt-1 text-sm text-ivory-dim">{formatInZone(nextUp.start, tz, "h:mm a")}{nextUp.subtitle ? ` · ${nextUp.subtitle}` : ""}</p>
              <a href={nextUp.type === "event" ? `#occ-${nextUp.ref}` : "#tl-h"} className="btn btn-quiet mt-4">Open</a>
            </>
          ) : (
            <>
              <p className="eyebrow">{isToday ? "Clear for now" : "This day"}</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight">{isToday ? "Nothing else scheduled today." : isPast ? `${actionable.length} item${actionable.length === 1 ? "" : "s"} on record` : `${actionable.length} scheduled item${actionable.length === 1 ? "" : "s"}`}</p>
              {!isPast && <Link href={`/plan/new?date=${date}`} className="btn btn-quiet mt-4">Schedule something</Link>}
            </>
          )}
          {plan?.intention && <p className="mt-5 border-l-2 border-lime pl-3 text-ivory">{plan.intention}</p>}
          {plan?.avoid_behavior && <p className="mt-2 text-sm text-ivory-dim"><span className="text-ivory-faint">Avoiding: </span>{plan.avoid_behavior}</p>}
        </section>

        {/* Spiritual companion — kept separate from productivity scoring */}
        <section aria-labelledby="pr-h" className="card card-violet lg:col-span-5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="pr-h" className="eyebrow">{upcomingPrayer ? "Next prayer" : "Prayer"}</h2>
            <Link href="/faith" className="text-xs text-ivory-dim hover:text-ivory">Faith</Link>
          </div>
          {pcfg ? (
            <>
              {upcomingPrayer && <>
                <p className="mt-2 text-2xl font-semibold tracking-tight">{PRAYER_LABEL[upcomingPrayer.prayer]} <span className="text-ivory-dim">{formatInZone(upcomingPrayer.at, tz, "h:mm a")}{upcomingPrayer.date !== today ? " tomorrow" : ""}</span></p>
                <p className="text-sm text-accent"><CountdownTo target={upcomingPrayer.at.toISOString()} /></p>
              </>}
              {awaitingConfirm.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-sm text-ivory-faint">Prayed?</span>
                  {awaitingConfirm.map((p) => (
                    <form key={p} action={confirmPrayer}>
                      <input type="hidden" name="prayer" value={p} />
                      <input type="hidden" name="date" value={date} />
                      <button className="chip">{PRAYER_LABEL[p]}</button>
                    </form>
                  ))}
                </div>
              )}
              <p className="mt-3 text-xs text-ivory-faint">{confirmedPrayers.size} of 5 confirmed. Unconfirmed is never counted as missed.</p>
            </>
          ) : (
            <Link href="/faith" className="mt-2 block text-sm text-ivory-dim hover:text-ivory">Set your location on Faith to see prayer times and reminders.</Link>
          )}
        </section>

        {/* Today's three priorities */}
        {(priorities.length > 0 || isToday) && (
          <section aria-labelledby="prio-h" className="card lg:col-span-7">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="prio-h" className="eyebrow">{isPast ? "Priorities that day" : "Today's three priorities"}</h2>
              {isToday && <Link href={`/coach?q=${encodeURIComponent("Plan my day today around my calendar, prayers, goals and deadlines. Don't move confirmed appointments.")}`} className="text-xs text-accent hover:underline">Plan my day with the Coach</Link>}
            </div>
            {priorities.length ? (
              <ol className="mt-2 space-y-2">
                {priorities.map((p, k) => (
                  <li key={p.id} className="flex items-center gap-3">
                    <span className={`grid size-6 shrink-0 place-items-center rounded-full text-xs tabular ${p.state === "completed" || p.state === "late" ? "bg-emerald text-ground" : p.state === "skipped" ? "bg-brass text-ground" : "border border-line-strong text-ivory-dim"}`}>{k + 1}</span>
                    <span className={`min-w-0 flex-1 truncate ${p.state === "completed" || p.state === "late" ? "text-ivory-dim line-through decoration-ivory-faint" : ""}`}>{p.title}</span>
                    {p.start && <span className="shrink-0 text-xs tabular text-ivory-faint">{formatInZone(p.start, tz, "h:mm a")}</span>}
                  </li>
                ))}
              </ol>
            ) : <p className="mt-2 text-sm text-ivory-dim">None set yet. <Link href="/checkin/morning" className="text-accent hover:underline">Choose up to three</Link>.</p>}
          </section>
        )}

        {/* Coach */}
        <Link href="/coach" className="card card-hover flex items-center justify-between gap-4 lg:col-span-5">
          <div>
            <p className="eyebrow">The Coach</p>
            <p className="mt-1 font-medium">Plan, reschedule or reflect — by voice or text</p>
          </div>
          <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-full bg-lime text-[var(--on-lime)]">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
          </span>
        </Link>

        {/* Accountability */}
        <section aria-label="Check-ins" className={`grid gap-3 lg:col-span-7 ${middayTime ? "grid-cols-3" : "grid-cols-2"}`}>
          <CheckinLink href="/checkin/morning" label="Morning" done={done("morning")} time={formatClock(profile.morning_checkin_time)} />
          {middayTime && <CheckinLink href="/checkin/midday" label="Midday" done={done("midday")} time={formatClock(middayTime.slice(0, 5))} />}
          <CheckinLink href="/checkin/evening" label="Evening" done={done("evening")} time={formatClock(profile.evening_checkin_time)} />
        </section>

        {isToday && <div className="lg:col-span-5"><FoodSummary today={today} tz={tz} count={foodRows?.length ?? 0} latest={(foodRows?.[0] ?? null) as FoodEntryRow | null} /></div>}
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-7">
          <CommandCenter items={timeline.items} tz={tz} date={date} nowIso={timeline.now} focusOcc={typeof sp.occ === "string" ? sp.occ : null} focusMode={typeof sp.do === "string" ? sp.do : null} />

          <section id="anytime" aria-labelledby="t-h" className="card scroll-mt-24">
            <div className="flex items-baseline justify-between">
              <h2 id="t-h" className="h-section">{isToday ? "Anytime today" : "Anytime"}</h2>
              <Link href="/word" className="text-sm text-ivory-dim hover:text-ivory">All tasks</Link>
            </div>
            <ul className="mt-1 divide-y divide-line">
              {od.map((t) => <TaskItem key={t.id} tz={tz} t={t} overdue dueLabel={null} tomorrow={today} showDate={`from ${formatLocalDate(t.scheduled_for!, "MMM d")}`} />)}
              {timeline.untimedTasks.map((t) => <TaskItem key={t.id} tz={tz} t={t} tomorrow={shiftDate(date, 1)} dueLabel={null} overdue={false} />)}
            </ul>
            {!od.length && !timeline.untimedTasks.length && <p className="py-2 text-sm text-ivory-faint">No untimed tasks.</p>}
            {!isPast && <div className="mt-3"><QuickTask date={date} goals={goals ?? []} /></div>}
          </section>
        </div>

        <aside className="space-y-6 lg:col-span-5">
          {isPast && storedScore ? (
            <div className="card">
              <p className="eyebrow">Daily integrity · as recorded</p>
              <p className="metric mt-2 text-6xl">{(storedScore.integrity as { score: number | null }).score ?? "—"}</p>
              <p className="mt-2 text-sm text-ivory-dim">{(storedScore.integrity as { explanation: string }).explanation}</p>
              <p className="mt-2 text-xs text-ivory-faint">
                Stored {storedScore.final ? "when the day ended" : "during the day (provisional)"} · policy {storedScore.policy_version}
                {(storedScore.evolution as { overall: number | null }).overall !== null && ` · 7-day evolution ${(storedScore.evolution as { overall: number }).overall}`}
              </p>
              {storedScore.policy_version !== POLICY_V1.version && <p className="mt-1 text-xs text-brass">Recorded under an earlier scoring policy; not recalculated.</p>}
            </div>
          ) : (
            <div className="card">
              {isPast && <p className="mb-2 text-xs text-brass">No score was stored for this day (it predates score snapshots). Shown recalculated with current policy {POLICY_V1.version}.</p>}
              <IntegrityPanel today={todayScore} series={series} />
            </div>
          )}
          {isPast && storedScore?.insight && (
            <div className="card card-violet">
              <p className="eyebrow">Insight shown that day</p>
              <p className="mt-2 font-semibold">{(storedScore.insight as { title: string }).title}</p>
              <p className="mt-1 text-sm text-ivory-dim">{(storedScore.insight as { recommendation: string }).recommendation}</p>
            </div>
          )}
          {history && (
            <section aria-labelledby="rec-h" className="card space-y-4">
              <h2 id="rec-h" className="h-section">Recorded that day</h2>
              <div>
                <p className="text-sm text-ivory-dim">Check-ins</p>
                {history.sess.length ? history.sess.map((x) => (
                  <details key={x.id} className="mt-1 text-sm">
                    <summary className="cursor-pointer">{x.kind[0].toUpperCase() + x.kind.slice(1)} · {x.status === "completed" ? "completed" : "not completed"}</summary>
                    <ul className="mt-1 space-y-1.5 border-l border-line pl-3 text-xs">
                      {history.answers.filter((a) => a.session_id === x.id).map((a, k) => <li key={k}><p className="text-ivory-faint">{a.question}</p><p>{a.skipped ? <i className="text-ivory-faint">skipped</i> : a.answer}{a.follow_up_answer ? ` — ${a.follow_up_answer}` : ""}</p></li>)}
                    </ul>
                  </details>
                )) : <p className="text-sm text-ivory-faint">None recorded.</p>}
              </div>
              <div>
                <p className="text-sm text-ivory-dim">Workouts</p>
                {history.workouts.length ? <ul className="text-sm">{history.workouts.map((w) => <li key={w.id}>{w.workout_type} · {w.duration_minutes ?? "?"} min{w.intensity ? ` · intensity ${w.intensity}/5` : ""}</li>)}</ul> : <p className="text-sm text-ivory-faint">None logged.</p>}
              </div>
              <div>
                <p className="text-sm text-ivory-dim">Food</p>
                <p className="text-sm">{foodRows?.length ? <Link href={`/food?date=${date}`} className="hover:underline">{foodRows.length} {foodRows.length === 1 ? "entry" : "entries"} — view</Link> : <span className="text-ivory-faint">None logged.</span>}</p>
              </div>
              <div>
                <p className="text-sm text-ivory-dim">Journal</p>
                {history.journal.length ? <ul className="text-sm">{history.journal.map((j) => <li key={j.id}><Link href={`/journal/${j.id}`} className="hover:underline">{j.title || j.body.slice(0, 60)}</Link>{j.mood ? <span className="text-ivory-faint"> · mood {j.mood}/5</span> : null}</li>)}</ul> : <p className="text-sm text-ivory-faint">No entry.</p>}
              </div>
              {history.moved.length > 0 && (
                <div>
                  <p className="text-sm text-ivory-dim">Moved to another day</p>
                  <ul className="text-sm">{history.moved.map((m) => <li key={m.id}>{m.title} <span className="text-ivory-faint">→ {m.scheduled_for} ({m.status})</span></li>)}</ul>
                </div>
              )}
            </section>
          )}

          {attention.length > 0 && (
            <section aria-labelledby="next-h" className="card">
              <h2 id="next-h" className="h-section mb-3">Needs attention</h2>
              <ul className="space-y-2">
                {attention.map((n) => (
                  <li key={n.text}>
                    <Link href={n.href} className="block rounded-[14px] bg-surface-2 px-4 py-3 text-[0.95rem] transition-colors hover:bg-surface-3">
                      {n.text}
                      <span className="mt-0.5 block text-xs text-ivory-faint">Why: {n.why}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-ivory-faint">Generated from your records. <Link href="/coach" className="text-accent hover:underline">Talk it through with the Coach</Link>.</p>
            </section>
          )}

          {hs.length > 0 && (
            <section aria-labelledby="h-h" className="card">
              <div className="flex items-baseline justify-between">
                <h2 id="h-h" className="h-section">Habits</h2>
                <Link href="/rhythm" className="text-sm text-ivory-dim hover:text-ivory">Manage</Link>
              </div>
              <ul className="mt-2 divide-y divide-line">
                {hs.map((h) => {
                  const todayLog = logs.find((l) => l.habit_id === h.id && l.log_date === date);
                  const weekDone = logs.filter((l) => l.habit_id === h.id && l.status === "done").length;
                  const restDay = h.rest_days.includes(dow);
                  return (
                    <li key={h.id} className="flex items-center gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <p>{h.title}</p>
                        <p className="text-xs text-ivory-faint tabular">{weekDone} of {h.target_per_week} this week{restDay ? ", scheduled rest day" : ""}</p>
                      </div>
                      <form action={logHabit} className="flex gap-1.5">
                        <input type="hidden" name="habit_id" value={h.id} />
                        <input type="hidden" name="date" value={date} />
                        <button name="status" value={todayLog?.status === "done" ? "clear" : "done"} className="chip" data-on={todayLog?.status === "done"}>Done</button>
                        <button name="status" value={todayLog?.status === "rest" ? "clear" : "rest"} className="chip" data-on={todayLog?.status === "rest"}>Rest</button>
                      </form>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {verse && (
            <section aria-labelledby="v-h" className="card">
              <h2 id="v-h" className="eyebrow">Verse for today · {verse.surah_name ?? "Surah"} {verse.surah}:{verse.ayah}</h2>
              <p className="reading mt-2 text-lg leading-relaxed">{verse.translation}</p>
              <p className="mt-2 text-xs text-ivory-faint">Translation: {verse.translator}. <Link href="/faith#verse" className="text-accent hover:underline">Arabic and reflection</Link></p>
            </section>
          )}

          <Link href="/progress" className="card card-hover block">
            <p className="eyebrow">Personal evolution</p>
            <p className="mt-1 font-medium">See your trends, balance and weekly report →</p>
          </Link>
        </aside>
      </div>
    </div>
  );
}

function CheckinLink({ href, label, done, time }: { href: string; label: string; done: boolean; time: string }) {
  return (
    <Link href={href} className={`card card-hover p-3 sm:p-4 ${done ? "card-emerald" : ""}`}>
      <p className="text-xs text-ivory-dim sm:text-sm">{label}<span className="hidden sm:inline"> check-in</span></p>
      <p className={`mt-1 text-sm font-medium sm:text-base ${done ? "text-emerald" : ""}`}>{done ? "Complete" : time}</p>
    </Link>
  );
}
