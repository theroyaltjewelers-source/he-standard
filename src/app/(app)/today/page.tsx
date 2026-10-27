import Link from "next/link";
import { requireUser } from "@/lib/session";
import { hijriDate } from "@/lib/hijri";
import { eventsBetween, integritySeries } from "@/lib/records";
import { prepPlan } from "@/lib/scheduling";
import { dayOfWeek, formatClock, formatInZone, formatLocalDate, shiftDate, weekStart } from "@/lib/time";
import type { Commitment, DailyPlan, Goal, Habit, HabitLog, JournalEntry, Task } from "@/lib/types";
import { IntegrityPanel } from "@/components/integrity";
import { CommitmentItem } from "@/components/commitment-item";
import { TaskItem } from "@/components/task-item";
import { QuickTask } from "@/components/quick-task";
import { PushToggle } from "@/components/push-toggle";
import { logHabit } from "@/app/actions/goals";
import { confirmEventPlan } from "@/app/actions/events";

export const metadata = { title: "Today" };

export default async function Today({ searchParams }: PageProps<"/today">) {
  const sp = await searchParams;
  const { supabase, profile, today } = await requireUser();
  const tz = profile.timezone;
  const now = new Date();
  const tomorrow = shiftDate(today, 1);
  const wk = weekStart(today);

  const [plan, commitments, tasks, overdue, habits, habitLogs, sessions, goals, progress, lastEntry, events, series] = await Promise.all([
    supabase.from("daily_plans").select("*").eq("plan_date", today).maybeSingle<DailyPlan>(),
    supabase.from("commitments").select("*").eq("commitment_date", today).order("promised_by"),
    supabase.from("tasks").select("*").eq("scheduled_for", today).neq("status", "cancelled").order("is_top_priority", { ascending: false }).order("priority").order("created_at"),
    supabase.from("tasks").select("*").lt("scheduled_for", today).eq("status", "pending").order("scheduled_for"),
    supabase.from("habits").select("*").eq("active", true).order("created_at"),
    supabase.from("habit_logs").select("*").gte("log_date", wk).lte("log_date", today),
    supabase.from("accountability_sessions").select("kind,status").eq("session_date", today),
    supabase.from("goals").select("*").eq("status", "active").order("target_date", { nullsFirst: false }).limit(4),
    supabase.from("goal_progress").select("goal_id,progress_pct,created_at").not("progress_pct", "is", null).order("created_at", { ascending: false }),
    supabase.from("journal_entries").select("id,entry_date,title").order("created_at", { ascending: false }).limit(1).maybeSingle<Pick<JournalEntry, "id" | "entry_date" | "title">>(),
    eventsBetween(supabase, today, today, tz),
    integritySeries(supabase, shiftDate(today, -6), today, today),
  ]);

  const cs = (commitments.data ?? []) as Commitment[];
  const ts = (tasks.data ?? []) as Task[];
  const od = (overdue.data ?? []) as Task[];
  const hs = (habits.data ?? []) as Habit[];
  const logs = (habitLogs.data ?? []) as HabitLog[];
  const morningDone = sessions.data?.some((s) => s.kind === "morning" && s.status === "completed");
  const eveningDone = sessions.data?.some((s) => s.kind === "evening" && s.status === "completed");
  const todayScore = series[series.length - 1].result;
  const dailyPlan = plan.data;
  const latestPct = new Map<string, number>();
  for (const p of progress.data ?? []) if (!latestPct.has(p.goal_id)) latestPct.set(p.goal_id, p.progress_pct);
  const dow = dayOfWeek(today);
  const localHour = Number(formatInZone(now, tz, "H"));

  // Priorities: morning commitments first; otherwise tasks flagged as priorities.
  const topTasks = ts.filter((t) => t.is_top_priority);

  // Next steps from the records — rule-based, not AI.
  const next: { text: string; href: string }[] = [];
  if (!morningDone && localHour < 15) next.push({ text: "Set today's commitments", href: "/checkin/morning" });
  const lapsed = cs.filter((c) => c.status === "open" && c.promised_by && Date.parse(c.promised_by) < now.getTime());
  if (lapsed.length) next.push({ text: `${lapsed.length} commitment${lapsed.length > 1 ? "s are" : " is"} past the promised time — record what happened`, href: "#commitments" });
  if (od.length) next.push({ text: `${od.length} overdue task${od.length > 1 ? "s" : ""} from earlier days — finish, move, or mark not done`, href: "#tasks" });
  const stuck = [...ts, ...od].filter((t) => t.status === "pending" && t.postponed_count >= 2);
  for (const t of stuck.slice(0, 2)) next.push({ text: `“${t.title}” has been postponed ${t.postponed_count} times. What is the obstacle to starting?`, href: "/tasks" });
  const unconfirmed = events.filter((o) => o.event.importance === "high" && !o.event.plan_confirmed_at && o.start > now);
  for (const o of unconfirmed) next.push({ text: `Confirm your preparation plan for ${o.event.title}`, href: "#schedule" });
  if (!eveningDone && localHour >= 17) next.push({ text: "Complete the evening review", href: "/checkin/evening" });

  return (
    <div className="space-y-12">
      <header>
        <p className="serif text-[1.65rem] leading-tight">{formatLocalDate(today, "EEEE, MMMM d")}</p>
        <p className="mt-1 text-ivory-dim">{hijriDate(today, profile.hijri_adjustment_days)}</p>
        {sp.welcome && <p className="mt-4 text-sm text-emerald">You&apos;re set up. Start with the morning check-in.</p>}
        {sp.checkin === "morning" && <p className="mt-4 text-sm text-emerald">Morning commitments recorded. Reminders are set for each.</p>}
        {sp.checkin === "evening" && <p className="mt-4 text-sm text-emerald">Evening review recorded.</p>}
      </header>

      <PushToggle vapidKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null} compact />

      <IntegrityPanel today={todayScore} series={series} />

      {/* Accountability status */}
      <section aria-label="Check-ins" className="grid grid-cols-2 gap-3">
        <CheckinLink href="/checkin/morning" label="Morning" done={!!morningDone} time={formatClock(profile.morning_checkin_time)} />
        <CheckinLink href="/checkin/evening" label="Evening" done={!!eveningDone} time={formatClock(profile.evening_checkin_time)} />
      </section>

      {(dailyPlan?.intention || dailyPlan?.avoid_behavior || dailyPlan?.spiritual_intention) && (
        <section aria-labelledby="intent-h" className="space-y-4 border-l-2 border-emerald pl-5">
          <h2 id="intent-h" className="sr-only">Today&apos;s intention</h2>
          {dailyPlan.intention && <p className="serif text-xl leading-snug">{dailyPlan.intention}</p>}
          {dailyPlan.avoid_behavior && <p className="text-sm text-ivory-dim"><span className="text-ivory-faint">Avoiding: </span>{dailyPlan.avoid_behavior}</p>}
          {dailyPlan.spiritual_intention && <p className="text-sm text-ivory-dim"><span className="text-ivory-faint">Spiritual intention: </span>{dailyPlan.spiritual_intention}</p>}
        </section>
      )}

      {next.length > 0 && (
        <section aria-labelledby="next-h">
          <h2 id="next-h" className="h-section mb-3">Needs attention</h2>
          <ul className="space-y-2">
            {next.map((n) => (
              <li key={n.text}>
                <Link href={n.href} className="block rounded-[10px] bg-surface px-4 py-3 text-[0.95rem] hover:bg-surface-2">{n.text}</Link>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ivory-faint">Generated from your records. AI coaching arrives in Phase 2.</p>
        </section>
      )}

      <section id="commitments" aria-labelledby="c-h">
        <div className="flex items-baseline justify-between">
          <h2 id="c-h" className="h-section">Today&apos;s commitments</h2>
          <Link href="/checkin/morning" className="text-sm text-ivory-dim hover:text-ivory">{cs.length ? "Revise" : "Set them"}</Link>
        </div>
        {cs.length ? (
          <ul className="divide-y divide-line">
            {cs.map((c) => (
              <CommitmentItem key={c.id} c={c} time={c.promised_by ? formatInZone(c.promised_by, tz, "h:mm a") : null}
                overdue={!!c.promised_by && Date.parse(c.promised_by) < now.getTime()} />
            ))}
          </ul>
        ) : topTasks.length ? (
          <>
            <p className="mt-2 mb-1 text-sm text-ivory-dim">No commitments yet. Your priority tasks:</p>
            <ul className="divide-y divide-line">{topTasks.map((t) => <li key={t.id} className="py-2 serif text-lg">{t.title}</li>)}</ul>
          </>
        ) : (
          <p className="mt-3 text-ivory-dim">No commitments for today yet. The morning check-in sets up to three, each with a time.</p>
        )}
      </section>

      <section id="schedule" aria-labelledby="s-h">
        <div className="flex items-baseline justify-between">
          <h2 id="s-h" className="h-section">Schedule</h2>
          <Link href={`/plan/new?date=${today}`} className="text-sm text-ivory-dim hover:text-ivory">Add appointment</Link>
        </div>
        {events.length ? (
          <ul className="mt-2 divide-y divide-line">
            {events.map((o) => {
              const p = prepPlan(o.start, o.event.prep_minutes, o.event.travel_minutes);
              return (
                <li key={o.event.id + o.start.toISOString()} className="flex gap-4 py-3">
                  <span className="w-16 shrink-0 text-sm text-ivory-dim tabular-nums">{o.event.all_day ? "All day" : formatInZone(o.start, tz, "h:mm a")}</span>
                  <div className="min-w-0 flex-1">
                    <Link href={`/plan/${o.event.id}`} className="hover:underline">{o.event.title}</Link>
                    {(o.event.prep_minutes > 0 || o.event.travel_minutes > 0) && (
                      <p className="text-sm text-ivory-faint">
                        {o.event.prep_minutes > 0 && `Start preparing ${formatInZone(p.beginPrepAt, tz, "h:mm a")}. `}
                        {o.event.travel_minutes > 0 && `Leave by ${formatInZone(p.leaveBy, tz, "h:mm a")}.`}
                      </p>
                    )}
                    {o.event.importance === "high" && !o.event.plan_confirmed_at && o.start > now && (
                      <form action={confirmEventPlan} className="mt-1">
                        <input type="hidden" name="id" value={o.event.id} />
                        <button className="text-sm text-emerald hover:underline">Confirm this plan</button>
                      </form>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-2 text-ivory-dim">Nothing scheduled.</p>
        )}
      </section>

      <section id="tasks" aria-labelledby="t-h">
        <div className="flex items-baseline justify-between">
          <h2 id="t-h" className="h-section">Checklist</h2>
          <Link href="/tasks" className="text-sm text-ivory-dim hover:text-ivory">All tasks</Link>
        </div>
        <ul className="mt-1 divide-y divide-line">
          {od.map((t) => <TaskItem key={t.id} t={t} overdue dueLabel={null} tomorrow={today} showDate={`from ${formatLocalDate(t.scheduled_for!, "MMM d")}`} />)}
          {ts.map((t) => (
            <TaskItem key={t.id} t={t} tomorrow={tomorrow}
              dueLabel={t.due_at ? formatInZone(t.due_at, tz, "h:mm a") : null}
              overdue={!!t.due_at && Date.parse(t.due_at) < now.getTime()} />
          ))}
        </ul>
        <div className="mt-3"><QuickTask date={today} goals={(goals.data ?? []).map((g: Goal) => ({ id: g.id, title: g.title }))} /></div>
      </section>

      {hs.length > 0 && (
        <section aria-labelledby="h-h">
          <div className="flex items-baseline justify-between">
            <h2 id="h-h" className="h-section">Habits</h2>
            <Link href="/goals" className="text-sm text-ivory-dim hover:text-ivory">Manage</Link>
          </div>
          <ul className="mt-2 divide-y divide-line">
            {hs.map((h) => {
              const todayLog = logs.find((l) => l.habit_id === h.id && l.log_date === today);
              const weekDone = logs.filter((l) => l.habit_id === h.id && l.status === "done").length;
              const restDay = h.rest_days.includes(dow);
              return (
                <li key={h.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p>{h.title}</p>
                    <p className="text-xs text-ivory-faint">{weekDone} of {h.target_per_week} this week{restDay ? ", scheduled rest day" : ""}</p>
                  </div>
                  <form action={logHabit} className="flex gap-1.5">
                    <input type="hidden" name="habit_id" value={h.id} />
                    <button name="status" value={todayLog?.status === "done" ? "clear" : "done"} className="chip" data-on={todayLog?.status === "done"}>Done</button>
                    <button name="status" value={todayLog?.status === "rest" ? "clear" : "rest"} className="chip" data-on={todayLog?.status === "rest"}>Rest</button>
                  </form>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {(goals.data ?? []).length > 0 && (
        <section aria-labelledby="g-h">
          <div className="flex items-baseline justify-between">
            <h2 id="g-h" className="h-section">Goals</h2>
            <Link href="/goals" className="text-sm text-ivory-dim hover:text-ivory">All goals</Link>
          </div>
          <ul className="mt-3 space-y-4">
            {(goals.data as Goal[]).map((g) => {
              const pct = latestPct.get(g.id);
              return (
                <li key={g.id}>
                  <Link href={`/goals/${g.id}`} className="block">
                    <div className="flex justify-between gap-3 text-[0.95rem]">
                      <span>{g.title}</span>
                      <span className="text-ivory-dim tabular-nums">{pct !== undefined ? `${pct}%` : "no progress logged"}</span>
                    </div>
                    <div className="mt-2 h-1 rounded-full bg-surface-2">
                      {pct !== undefined && <div className="h-1 rounded-full bg-emerald" style={{ width: `${pct}%` }} />}
                    </div>
                    {g.target_date && <p className="mt-1 text-xs text-ivory-faint">Target {formatLocalDate(g.target_date, "MMM d, yyyy")}</p>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section aria-labelledby="j-h" className="flex items-center justify-between gap-4 rounded-[14px] border border-line p-5">
        <div>
          <h2 id="j-h" className="h-section">Journal</h2>
          <p className="text-sm text-ivory-dim">
            {lastEntry.data ? `Last entry ${lastEntry.data.entry_date === today ? "today" : formatLocalDate(lastEntry.data.entry_date, "MMM d")}` : "No entries yet."}
          </p>
        </div>
        <Link href="/journal/new" className="btn btn-quiet">Write</Link>
      </section>
    </div>
  );
}

function CheckinLink({ href, label, done, time }: { href: string; label: string; done: boolean; time: string }) {
  return (
    <Link href={href} className={`rounded-[14px] border p-4 ${done ? "border-emerald-deep bg-emerald-deep/25" : "border-line hover:border-ivory-faint"}`}>
      <p className="text-sm text-ivory-dim">{label} check-in</p>
      <p className={`mt-1 ${done ? "text-emerald" : ""}`}>{done ? "Complete" : `Due ${time}`}</p>
    </Link>
  );
}
