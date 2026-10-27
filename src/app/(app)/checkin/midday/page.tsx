import Link from "next/link";
import { requireUser } from "@/lib/session";
import { formatInZone, formatLocalDate } from "@/lib/time";
import { PageHeader } from "@/components/page-header";
import type { AccountabilityAnswer, Commitment } from "@/lib/types";
import { MiddayForm } from "./form";

export const metadata = { title: "Midday check-in" };

export default async function Midday() {
  const { supabase, profile, today } = await requireUser();
  const [{ data: session }, { data: cs }] = await Promise.all([
    supabase.from("accountability_sessions").select("id,status").eq("session_date", today).eq("kind", "midday").maybeSingle(),
    supabase.from("commitments").select("*").eq("commitment_date", today).order("promised_by"),
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
  const commitments = (cs ?? []) as Commitment[];
  return (
    <>
      <PageHeader back="/checkin" title="Midday check-in" subtitle={formatLocalDate(today)} />
      <section className="mb-10 rounded-[14px] border border-line p-4">
        <h2 className="text-sm text-ivory-dim">Where today stands</h2>
        {commitments.length ? (
          <ul className="mt-2 space-y-1.5">
            {commitments.map((c) => (
              <li key={c.id} className="flex items-baseline justify-between gap-3">
                <span className={c.status === "open" ? "" : "text-ivory-dim line-through decoration-ivory-faint"}>{c.title}</span>
                <span className={`shrink-0 text-sm ${c.status === "open" ? "text-ivory-faint" : c.status === "broken" ? "text-brass" : "text-emerald"}`}>
                  {c.status === "open" ? (c.promised_by ? `by ${formatInZone(c.promised_by, profile.timezone, "h:mm a")}` : "open") : c.status.replace("_", " ")}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-ivory-dim">No priorities set this morning. <Link href="/checkin/morning" className="text-emerald hover:underline">Set them now</Link> — it isn&apos;t too late to plan the afternoon.</p>
        )}
      </section>
      {session?.status === "completed" && <p className="mb-8 rounded-[10px] bg-surface px-4 py-3 text-sm text-ivory-dim">Completed. You can revise your answers.</p>}
      <MiddayForm initial={initial} />
    </>
  );
}
