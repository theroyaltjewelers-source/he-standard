import Link from "next/link";
import { requireUser } from "@/lib/session";
import { eventsBetween, type Occurrence } from "@/lib/records";
import { prepPlan } from "@/lib/scheduling";
import { formatInZone, formatLocalDate, shiftDate, weekStart } from "@/lib/time";
import { PageHeader } from "@/components/page-header";
import { IconPlus } from "@/components/icons";
import type { Task } from "@/lib/types";

export const metadata = { title: "Plan" };

type View = "day" | "week" | "month";

export default async function Plan({ searchParams }: PageProps<"/plan">) {
  const sp = await searchParams;
  const { supabase, profile, today } = await requireUser();
  const tz = profile.timezone;
  const view: View = sp.view === "week" || sp.view === "month" ? sp.view : "day";
  const date = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;

  let from = date, to = date;
  if (view === "week") { from = weekStart(date); to = shiftDate(from, 6); }
  if (view === "month") {
    const first = `${date.slice(0, 7)}-01`;
    from = weekStart(first);
    const nextMonth = shiftDate(`${date.slice(0, 7)}-28`, 4).slice(0, 7) + "-01";
    to = shiftDate(weekStart(shiftDate(nextMonth, -1)), 6);
  }

  const [events, { data: taskRows }] = await Promise.all([
    eventsBetween(supabase, from, to, tz),
    supabase.from("tasks").select("*").gte("scheduled_for", from).lte("scheduled_for", to).neq("status", "cancelled").order("is_top_priority", { ascending: false }),
  ]);
  const tasks = (taskRows ?? []) as Task[];
  const step = view === "day" ? 1 : view === "week" ? 7 : 0;
  const prev = view === "month" ? shiftDate(`${date.slice(0, 7)}-01`, -1).slice(0, 7) + "-01" : shiftDate(date, -step);
  const next = view === "month" ? shiftDate(`${date.slice(0, 7)}-28`, 4).slice(0, 7) + "-01" : shiftDate(date, step);
  const title = view === "month" ? formatLocalDate(date, "MMMM yyyy") : view === "week" ? `Week of ${formatLocalDate(from, "MMM d")}` : formatLocalDate(date, "EEEE, MMM d");
  const q = (v: View, d: string) => `/plan?view=${v}&date=${d}`;

  return (
    <>
      <PageHeader
        eyebrow="Calendar"
        title={title}
        action={<Link href={`/plan/new?date=${date}`} className="btn btn-primary" aria-label="Add appointment"><IconPlus width={18} height={18} /> <span className="hidden sm:inline">Appointment</span></Link>}
      />
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-[10px] border border-line p-1" role="tablist" aria-label="View">
          {(["day", "week", "month"] as View[]).map((v) => (
            <Link key={v} role="tab" aria-selected={view === v} href={q(v, date)}
              className={`rounded-[7px] px-3 py-1.5 text-sm capitalize ${view === v ? "bg-surface-2 text-ivory" : "text-ivory-dim"}`}>{v}</Link>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Link href={q(view, prev)} className="btn btn-quiet px-3" aria-label="Previous">‹</Link>
          {date !== today && <Link href={q(view, today)} className="btn btn-quiet">Today</Link>}
          <Link href={q(view, next)} className="btn btn-quiet px-3" aria-label="Next">›</Link>
        </div>
      </div>

      {view === "day" && <DayList date={date} events={events} tasks={tasks} tz={tz} />}
      {view === "week" && (
        <div className="space-y-8">
          {Array.from({ length: 7 }, (_, i) => shiftDate(from, i)).map((d) => (
            <section key={d}>
              <h2 className={`mb-1 text-sm ${d === today ? "text-emerald" : "text-ivory-dim"}`}>
                <Link href={q("day", d)} className="hover:underline">{formatLocalDate(d, "EEEE, MMM d")}</Link>
              </h2>
              <DayList date={d} events={events.filter((e) => e.date === d)} tasks={tasks.filter((t) => t.scheduled_for === d)} tz={tz} compact />
            </section>
          ))}
        </div>
      )}
      {view === "month" && <MonthGrid from={from} to={to} month={date.slice(0, 7)} today={today} events={events} tasks={tasks} />}
    </>
  );
}

function DayList({ date, events, tasks, tz, compact }: { date: string; events: Occurrence[]; tasks: Task[]; tz: string; compact?: boolean }) {
  const evs = events.filter((e) => e.date === date);
  if (!evs.length && !tasks.length) return <p className="text-ivory-faint text-sm py-2">{compact ? "Open" : "Nothing planned. Add an appointment, or tasks from Today."}</p>;
  return (
    <ul className="divide-y divide-line">
      {evs.map((o) => {
        const p = prepPlan(o.start, o.event.prep_minutes, o.event.travel_minutes);
        return (
          <li key={o.event.id + o.start.toISOString()} className="flex gap-4 py-3">
            <span className="w-20 shrink-0 text-sm text-ivory-dim tabular-nums">
              {o.event.all_day ? "All day" : formatInZone(o.start, tz, "h:mm a")}
              {o.end && !o.event.all_day && <span className="block text-ivory-faint">{formatInZone(o.end, tz, "h:mm a")}</span>}
            </span>
            <div className="min-w-0 flex-1">
              <Link href={`/plan/${o.event.id}`} className="hover:underline">
                {o.event.importance === "high" && <span className="mr-1.5 text-emerald" aria-label="Important">●</span>}
                {o.event.title}
              </Link>
              {o.event.location && <p className="text-sm text-ivory-faint">{o.event.location}</p>}
              {!compact && (o.event.prep_minutes > 0 || o.event.travel_minutes > 0) && (
                <p className="text-sm text-ivory-dim">
                  {o.event.prep_minutes > 0 && `Prepare from ${formatInZone(p.beginPrepAt, tz, "h:mm a")}. `}
                  {o.event.travel_minutes > 0 && `Leave by ${formatInZone(p.leaveBy, tz, "h:mm a")}.`}
                </p>
              )}
              {o.event.recurrence !== "none" && <p className="text-xs text-ivory-faint">Repeats {o.event.recurrence}</p>}
            </div>
          </li>
        );
      })}
      {tasks.map((t) => (
        <li key={t.id} className="flex gap-4 py-2.5 text-sm">
          <span className="w-20 shrink-0 text-ivory-faint">{t.due_at ? `by ${formatInZone(t.due_at, tz, "h:mm a")}` : "Task"}</span>
          <span className={t.status === "done" ? "text-ivory-faint line-through" : t.status === "missed" ? "text-ivory-faint" : "text-ivory-dim"}>{t.title}</span>
        </li>
      ))}
    </ul>
  );
}

function MonthGrid({ from, to, month, today, events, tasks }: { from: string; to: string; month: string; today: string; events: Occurrence[]; tasks: Task[] }) {
  const days: string[] = [];
  for (let d = from; d <= to; d = shiftDate(d, 1)) days.push(d);
  return (
    <div>
      <div className="grid grid-cols-7 text-center text-xs text-ivory-faint">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="pb-2">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-[14px] border border-line bg-line">
        {days.map((d) => {
          const n = events.filter((e) => e.date === d).length;
          const tc = tasks.filter((t) => t.scheduled_for === d).length;
          const inMonth = d.startsWith(month);
          return (
            <Link key={d} href={`/plan?view=day&date=${d}`} aria-label={`${formatLocalDate(d, "MMMM d")}: ${n} appointments, ${tc} tasks`}
              className={`flex aspect-square flex-col items-center justify-start gap-1 bg-ground p-1.5 text-sm hover:bg-surface sm:aspect-[4/3] ${inMonth ? "" : "text-ivory-faint"}`}>
              <span className={d === today ? "grid size-7 place-items-center rounded-full bg-emerald text-ground" : "grid size-7 place-items-center"}>{Number(d.slice(8))}</span>
              <span className="flex gap-0.5">
                {Array.from({ length: Math.min(n, 3) }).map((_, i) => <span key={i} className="size-1.5 rounded-full bg-ivory" />)}
                {tc > 0 && <span className="size-1.5 rounded-full bg-ivory-faint" />}
              </span>
            </Link>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-ivory-faint">Light dots are appointments; the grey dot means tasks are scheduled.</p>
    </div>
  );
}
