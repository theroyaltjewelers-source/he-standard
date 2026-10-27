import Link from "next/link";
import { requireUser } from "@/lib/session";
import { formatInZone, formatLocalDate, shiftDate } from "@/lib/time";
import { PageHeader, Empty } from "@/components/page-header";
import { TaskItem } from "@/components/task-item";
import { QuickTask } from "@/components/quick-task";
import type { Task } from "@/lib/types";

export const metadata = { title: "Tasks" };

export default async function Tasks({ searchParams }: PageProps<"/tasks">) {
  const sp = await searchParams;
  const { supabase, profile, today } = await requireUser();
  const tz = profile.timezone;
  const show = sp.show === "done" ? "done" : "open";
  const now = new Date().getTime();

  const q = supabase.from("tasks").select("*");
  const { data } = show === "open"
    ? await q.eq("status", "pending").order("scheduled_for", { nullsFirst: false }).order("is_top_priority", { ascending: false }).order("priority")
    : await q.in("status", ["done", "missed"]).order("updated_at", { ascending: false }).limit(100);
  const tasks = (data ?? []) as Task[];
  const { data: goals } = await supabase.from("goals").select("id,title").eq("status", "active");

  const groups = new Map<string, Task[]>();
  for (const t of tasks) {
    const key = show === "done" ? "Recently resolved" : !t.scheduled_for ? "Someday" : t.scheduled_for < today ? "Overdue" : t.scheduled_for === today ? "Today" : t.scheduled_for === shiftDate(today, 1) ? "Tomorrow" : formatLocalDate(t.scheduled_for, "EEEE, MMM d");
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }

  return (
    <>
      <PageHeader title="Tasks" />
      <div className="mb-8 inline-flex rounded-[10px] border border-line p-1">
        <Link href="/tasks" className={`rounded-[7px] px-3 py-1.5 text-sm ${show === "open" ? "bg-surface-2" : "text-ivory-dim"}`}>Open</Link>
        <Link href="/tasks?show=done" className={`rounded-[7px] px-3 py-1.5 text-sm ${show === "done" ? "bg-surface-2" : "text-ivory-dim"}`}>Resolved</Link>
      </div>
      {show === "open" && <div className="mb-10"><QuickTask date={today} goals={goals ?? []} /></div>}
      {tasks.length === 0 ? (
        <Empty>{show === "open" ? "No open tasks." : "Nothing resolved yet."}</Empty>
      ) : (
        <div className="space-y-10">
          {[...groups.entries()].map(([label, items]) => (
            <section key={label}>
              <h2 className={`text-sm ${label === "Overdue" ? "text-brass" : "text-ivory-dim"}`}>{label}</h2>
              <ul className="divide-y divide-line">
                {items.map((t) => (
                  <TaskItem key={t.id} t={t} tomorrow={shiftDate(today, 1)}
                    showDate={show === "done" && t.scheduled_for ? formatLocalDate(t.scheduled_for, "MMM d") : null}
                    dueLabel={t.due_at ? formatInZone(t.due_at, tz, "h:mm a") : null}
                    overdue={(t.scheduled_for ?? today) < today || (!!t.due_at && Date.parse(t.due_at) < now)} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
