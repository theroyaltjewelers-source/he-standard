import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { formatInZone, formatLocalDate } from "@/lib/time";
import { ConfirmButton } from "@/components/confirm-button";
import { PageHeader } from "@/components/page-header";
import { ProgressForm } from "@/components/goal-forms";
import { deleteGoal, setGoalStatus } from "@/app/actions/goals";
import type { Goal, GoalProgress, Habit, Task } from "@/lib/types";

export const metadata = { title: "Goal" };

export default async function GoalPage({ params }: PageProps<"/goals/[id]">) {
  const { id } = await params;
  const { supabase, profile } = await requireUser();
  const { data: goal } = await supabase.from("goals").select("*").eq("id", id).maybeSingle<Goal>();
  if (!goal) notFound();
  const [{ data: progress }, { data: habits }, { data: tasks }, { data: children }] = await Promise.all([
    supabase.from("goal_progress").select("*").eq("goal_id", id).order("created_at", { ascending: false }),
    supabase.from("habits").select("*").eq("goal_id", id),
    supabase.from("tasks").select("*").eq("goal_id", id).order("scheduled_for", { ascending: false }).limit(20),
    supabase.from("goals").select("id,title,status,horizon").eq("parent_goal_id", id),
  ]);
  const ts = (tasks ?? []) as Task[];
  const done = ts.filter((t) => t.status === "done").length;

  return (
    <>
      <PageHeader back="/goals" title={goal.title}
        subtitle={`${goal.status === "active" ? "Active" : goal.status[0].toUpperCase() + goal.status.slice(1)}${goal.target_date ? `, target ${formatLocalDate(goal.target_date, "MMMM d, yyyy")}` : ""}`}
        action={<Link href={`/goals/${id}/edit`} className="btn btn-quiet">Edit</Link>} />

      <dl className="space-y-6">
        <Field label="Desired outcome" value={goal.desired_outcome} />
        <Field label="Success criteria" value={goal.success_criteria} />
        <Field label="Obstacles" value={goal.obstacles} />
        <Field label="Recovery plan" value={goal.recovery_plan} />
      </dl>

      {(children ?? []).length > 0 && (
        <section className="mt-12">
          <h2 className="h-section mb-2">Milestones and objectives</h2>
          <ul className="divide-y divide-line">{children!.map((c) => <li key={c.id} className="flex justify-between py-3"><Link href={`/goals/${c.id}`}>{c.title}</Link><span className="text-sm text-ivory-faint">{c.status}</span></li>)}</ul>
        </section>
      )}

      <section className="mt-12">
        <h2 className="h-section mb-3">Progress</h2>
        <ProgressForm goalId={id} />
        <ol className="mt-6 space-y-5 border-l border-line pl-5">
          {((progress ?? []) as GoalProgress[]).map((p) => (
            <li key={p.id}>
              <p className="text-xs text-ivory-faint">{formatInZone(p.created_at, profile.timezone, "MMM d, yyyy")}{p.progress_pct != null && `, ${p.progress_pct}%`}</p>
              <p className="mt-1">{p.note}</p>
              {p.evidence && <p className="text-sm text-ivory-dim">Evidence: {p.evidence}</p>}
            </li>
          ))}
          {!(progress ?? []).length && <li className="text-sm text-ivory-dim">Nothing logged yet.</li>}
        </ol>
      </section>

      <section className="mt-12">
        <h2 className="h-section mb-2">Linked work</h2>
        <p className="text-sm text-ivory-dim">{ts.length ? `${done} of the last ${ts.length} linked tasks done.` : "No tasks linked yet. Choose this goal when adding a task."}</p>
        {(habits as Habit[] | null)?.length ? <p className="mt-1 text-sm text-ivory-dim">Habits: {(habits as Habit[]).map((h) => h.title).join(", ")}</p> : null}
      </section>

      <section className="mt-12 flex flex-wrap gap-2">
        {(["active", "paused", "achieved", "abandoned"] as const).filter((s) => s !== goal.status).map((s) => (
          <form key={s} action={setGoalStatus}>
            <input type="hidden" name="id" value={id} /><input type="hidden" name="status" value={s} />
            <button className="btn btn-quiet capitalize">{s === "active" ? "Reactivate" : `Mark ${s}`}</button>
          </form>
        ))}
        <form action={deleteGoal}><input type="hidden" name="id" value={id} /><ConfirmButton message="Delete this goal and its progress history?">Delete</ConfirmButton></form>
      </section>
    </>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-sm text-ivory-faint">{label}</dt>
      <dd className="serif mt-1 text-[1.075rem] leading-relaxed whitespace-pre-line">{value}</dd>
    </div>
  );
}
