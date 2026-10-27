import Link from "next/link";
import { requireUser } from "@/lib/session";
import { formatInZone, formatLocalDate, shiftDate } from "@/lib/time";
import { PageHeader } from "@/components/page-header";
import { CommitmentItem } from "@/components/commitment-item";
import { TaskItem } from "@/components/task-item";
import type { AccountabilityAnswer, Commitment, Task } from "@/lib/types";
import { adaptiveEveningQuestions } from "@/lib/adaptive";
import { EveningForm } from "./form";

export const metadata = { title: "Evening review" };

export default async function Evening() {
  const { supabase, profile, today } = await requireUser();
  const tz = profile.timezone;
  const now = new Date().getTime();
  const [{ data: session }, { data: cs }, { data: ts }] = await Promise.all([
    supabase.from("accountability_sessions").select("id,status").eq("session_date", today).eq("kind", "evening").maybeSingle(),
    supabase.from("commitments").select("*").eq("commitment_date", today).order("promised_by"),
    supabase.from("tasks").select("*").eq("scheduled_for", today).neq("status", "cancelled").order("created_at"),
  ]);
  const { data: answers } = session
    ? await supabase.from("accountability_answers").select("*").eq("session_id", session.id)
    : { data: [] as AccountabilityAnswer[] };
  const initial: Record<string, string> = {};
  for (const a of (answers ?? []) as AccountabilityAnswer[]) {
    initial[a.question_key] = a.answer;
    if (a.skipped) initial[`skip_${a.question_key}`] = "on";
    if (a.follow_up_answer) initial[`fu_${a.question_key}`] = a.follow_up_answer;
  }
  const adaptive = await adaptiveEveningQuestions(supabase, today);
  const commitments = (cs ?? []) as Commitment[];
  const tasks = (ts ?? []) as Task[];
  const open = commitments.filter((c) => c.status === "open").length;
  const pendingTasks = tasks.filter((t) => t.status === "pending").length;

  return (
    <>
      <PageHeader back="/checkin" title="Evening accountability" subtitle={formatLocalDate(today)} />

      <section className="mb-12">
        <h2 className="serif text-xl leading-snug"><span className="mr-2 text-ivory-faint">1.</span>What did you promise, and what actually happened?</h2>
        <p className="mt-2 text-sm text-ivory-faint">Record each commitment honestly. Missed items reported with context earn partial credit; unrecorded ones earn none.</p>
        {commitments.length ? (
          <ul className="mt-2 divide-y divide-line">
            {commitments.map((c) => (
              <CommitmentItem key={c.id} c={c} time={c.promised_by ? formatInZone(c.promised_by, tz, "h:mm a") : null}
                overdue={!!c.promised_by && Date.parse(c.promised_by) < now} />
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-ivory-dim">No commitments were set today. <Link href="/checkin/morning" className="text-emerald hover:underline">Add them</Link> if you made promises you want on record.</p>
        )}
        {tasks.length > 0 && (
          <>
            <h3 className="mt-8 text-sm text-ivory-dim">Today&apos;s tasks {pendingTasks > 0 && <span className="text-brass">({pendingTasks} unresolved)</span>}</h3>
            <ul className="divide-y divide-line">
              {tasks.map((t) => (
                <TaskItem key={t.id} t={t} tomorrow={shiftDate(today, 1)} dueLabel={t.due_at ? formatInZone(t.due_at, tz, "h:mm a") : null}
                  overdue={!!t.due_at && Date.parse(t.due_at) < now} />
              ))}
            </ul>
          </>
        )}
      </section>

      {session?.status === "completed" && (
        <p className="mb-8 rounded-[10px] bg-surface px-4 py-3 text-sm text-ivory-dim">Completed today. You can revise your answers below.</p>
      )}
      <EveningForm initial={initial} openCommitments={open} adaptive={adaptive} />
    </>
  );
}
