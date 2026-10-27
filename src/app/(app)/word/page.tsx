import Link from "next/link";
import { requireUser } from "@/lib/session";
import { formatInZone, formatLocalDate, shiftDate } from "@/lib/time";
import { PageHeader, Empty } from "@/components/page-header";
import { TaskItem } from "@/components/task-item";
import { QuickTask } from "@/components/quick-task";
import { CommitmentItem } from "@/components/commitment-item";
import { CommitmentForm } from "@/components/commitment-form";
import type { Commitment, Task } from "@/lib/types";

export const metadata = { title: "My Word" };

/**
 * MY WORD — everything you have promised: today's commitments (with their
 * outcome, first action and obstacle), the 14-day record, and open tasks.
 */
export default async function Word({ searchParams }: PageProps<"/word">) {
  const sp = await searchParams;
  const { supabase, profile, today } = await requireUser();
  const tz = profile.timezone;
  const show = sp.show === "done" ? "done" : "open";
  const now = new Date().getTime();
  const from = shiftDate(today, -13);

  const tq = supabase.from("tasks").select("*");
  const [{ data: cs }, { data: recent }, { data: tdata }, { data: goals }] = await Promise.all([
    supabase.from("commitments").select("*").eq("commitment_date", today).order("promised_by"),
    supabase.from("commitments").select("id,commitment_date,title,status,made_to").gte("commitment_date", from).lt("commitment_date", today).order("commitment_date", { ascending: false }),
    show === "open"
      ? tq.eq("status", "pending").order("scheduled_for", { nullsFirst: false }).order("is_top_priority", { ascending: false }).order("priority")
      : tq.in("status", ["done", "missed"]).order("updated_at", { ascending: false }).limit(100),
    supabase.from("goals").select("id,title").eq("status", "active"),
  ]);
  const commitments = (cs ?? []) as Commitment[];
  const past = (recent ?? []) as Pick<Commitment, "id" | "commitment_date" | "title" | "status" | "made_to">[];
  const tasks = (tdata ?? []) as Task[];
  const kept = past.filter((c) => c.status === "kept" || c.status === "kept_late").length;
  const broken = past.filter((c) => c.status === "broken");
  const unrecorded = past.filter((c) => c.status === "open").length;
  const resolved = past.filter((c) => c.status !== "open" && c.status !== "released").length;
  const toOthers = past.filter((c) => c.made_to !== "self");
  const keptToOthers = toOthers.filter((c) => c.status === "kept" || c.status === "kept_late").length;

  const groups = new Map<string, Task[]>();
  for (const t of tasks) {
    const key = show === "done" ? "Recently resolved" : !t.scheduled_for ? "Someday" : t.scheduled_for < today ? "Overdue" : t.scheduled_for === today ? "Today" : t.scheduled_for === shiftDate(today, 1) ? "Tomorrow" : formatLocalDate(t.scheduled_for, "EEEE, MMM d");
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }

  return (
    <>
      <PageHeader title="My Word" subtitle="What you said you would do — and what happened." />

      <section className="mb-12">
        <div className="flex items-baseline justify-between">
          <h2 className="h-section">Today&apos;s commitments</h2>
          <Link href="/checkin/morning" className="text-sm text-ivory-dim hover:text-ivory">Morning plan</Link>
        </div>
        {commitments.length ? (
          <ul className="mt-1 divide-y divide-line">
            {commitments.map((c) => (
              <CommitmentItem key={c.id} c={c} time={c.promised_by ? formatInZone(c.promised_by, tz, "h:mm a") : null} overdue={!!c.promised_by && Date.parse(c.promised_by) < now}>
                {c.status === "open" && (c.first_action || c.expected_outcome || c.obstacles) && (
                  <dl className="mt-2 grid gap-1 text-sm">
                    {c.first_action && <div className="flex gap-2"><dt className="text-ivory-faint">Start with</dt><dd className="text-ivory-dim">{c.first_action}</dd></div>}
                    {c.expected_outcome && <div className="flex gap-2"><dt className="text-ivory-faint">Done means</dt><dd className="text-ivory-dim">{c.expected_outcome}</dd></div>}
                    {c.obstacles && <div className="flex gap-2"><dt className="text-ivory-faint">Watch for</dt><dd className="text-ivory-dim">{c.obstacles}</dd></div>}
                  </dl>
                )}
              </CommitmentItem>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-ivory-dim">Nothing promised yet today.</p>
        )}
        <div className="mt-4"><CommitmentForm date={today} /></div>
      </section>

      <section className="mb-12 rounded-[14px] border border-line p-5">
        <h2 className="text-sm text-ivory-dim">Your record, last 14 days</h2>
        {past.length === 0 ? (
          <p className="mt-2 text-ivory-dim">No earlier commitments yet. The record builds from here.</p>
        ) : (
          <>
            <p className="serif mt-2 text-2xl">
              Kept {kept} of {resolved} recorded
              {resolved > 0 && <span className="text-ivory-dim"> · {Math.round((kept / resolved) * 100)}%</span>}
            </p>
            <p className="mt-1 text-sm text-ivory-faint">
              {toOthers.length > 0 && `To other people: ${keptToOthers} of ${toOthers.length} kept. `}
              {unrecorded > 0 && <span className="text-brass">{unrecorded} never recorded — those count against you. </span>}
              Sample: {past.length} commitments.
            </p>
            {broken.length > 0 && (
              <ul className="mt-4 space-y-1 text-sm">
                {broken.slice(0, 5).map((c) => (
                  <li key={c.id} className="flex justify-between gap-3"><span className="text-ivory-dim">{c.title}</span><span className="shrink-0 text-ivory-faint">{formatLocalDate(c.commitment_date, "MMM d")}</span></li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section>
        <div className="mb-6 flex items-center justify-between">
          <h2 className="h-section">Tasks</h2>
          <div className="inline-flex rounded-[10px] border border-line p-1">
            <Link href="/word" className={`rounded-[7px] px-3 py-1.5 text-sm ${show === "open" ? "bg-surface-2" : "text-ivory-dim"}`}>Open</Link>
            <Link href="/word?show=done" className={`rounded-[7px] px-3 py-1.5 text-sm ${show === "done" ? "bg-surface-2" : "text-ivory-dim"}`}>Resolved</Link>
          </div>
        </div>
        {show === "open" && <div className="mb-10"><QuickTask date={today} goals={goals ?? []} /></div>}
        {tasks.length === 0 ? (
          <Empty>{show === "open" ? "No open tasks." : "Nothing resolved yet."}</Empty>
        ) : (
          <div className="space-y-10">
            {[...groups.entries()].map(([label, items]) => (
              <section key={label}>
                <h3 className={`text-sm ${label === "Overdue" ? "text-brass" : "text-ivory-dim"}`}>{label}</h3>
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
      </section>
    </>
  );
}
