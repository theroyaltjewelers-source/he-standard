import { requireUser } from "@/lib/session";
import { formatInZone, formatLocalDate } from "@/lib/time";
import { PageHeader } from "@/components/page-header";
import type { AccountabilityAnswer, Commitment, DailyPlan } from "@/lib/types";
import { MorningForm } from "./form";

export const metadata = { title: "Morning check-in" };

export default async function Morning() {
  const { supabase, profile, today } = await requireUser();
  const [{ data: session }, { data: cs }, { data: plan }] = await Promise.all([
    supabase.from("accountability_sessions").select("id,status").eq("session_date", today).eq("kind", "morning").maybeSingle(),
    supabase.from("commitments").select("*").eq("commitment_date", today).eq("source", "morning_interview").order("promised_by"),
    supabase.from("daily_plans").select("*").eq("plan_date", today).maybeSingle<DailyPlan>(),
  ]);
  const { data: answers } = session
    ? await supabase.from("accountability_answers").select("*").eq("session_id", session.id)
    : { data: [] as AccountabilityAnswer[] };

  const initial: Record<string, string> = { intention: plan?.intention ?? "" };
  (cs as Commitment[] | null)?.slice(0, 3).forEach((c, i) => {
    initial[`c${i + 1}_title`] = c.title;
    initial[`c${i + 1}_time`] = c.promised_by ? formatInZone(c.promised_by, profile.timezone, "HH:mm") : "";
    initial[`c${i + 1}_to`] = c.made_to === "self" ? "" : c.made_to;
  });
  for (const a of (answers ?? []) as AccountabilityAnswer[]) {
    initial[a.question_key] = a.answer;
    if (a.follow_up_answer) initial[`fu_${a.question_key}`] = a.follow_up_answer;
  }
  const kept = (cs as Commitment[] | null)?.filter((c) => c.status !== "open").length ?? 0;

  return (
    <>
      <PageHeader
        back="/checkin"
        title="Morning commitments"
        subtitle={formatLocalDate(today)}
      />
      {session?.status === "completed" && (
        <p className="mb-8 rounded-[10px] bg-surface px-4 py-3 text-sm text-ivory-dim">
          Already completed today. Saving again replaces today&apos;s open commitments{kept ? `; the ${kept} you've already resolved stay as recorded` : ""}.
        </p>
      )}
      <MorningForm initial={initial} />
    </>
  );
}
