import Link from "next/link";
import { requireUser } from "@/lib/session";
import { formatClock } from "@/lib/time";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Check-in" };

export default async function Checkin() {
  const { supabase, profile, today } = await requireUser();
  const { data } = await supabase.from("accountability_sessions").select("kind,status").eq("session_date", today);
  const done = (k: string) => data?.some((s) => s.kind === k && s.status === "completed");
  return (
    <>
      <PageHeader title="Check-in" subtitle="Two short interviews a day: what you will do, and what you did." />
      <div className="space-y-3">
        {[
          { k: "morning", title: "Morning commitments", desc: "Three commitments with times, the obstacles, and your plan for them.", time: profile.morning_checkin_time },
          { k: "evening", title: "Evening accountability", desc: "What you promised, what happened, and what changes tomorrow.", time: profile.evening_checkin_time },
        ].map((s) => (
          <Link key={s.k} href={`/checkin/${s.k}`} className="block rounded-[14px] border border-line p-5 hover:border-ivory-faint">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="h-section">{s.title}</h2>
              <span className={`text-sm ${done(s.k) ? "text-emerald" : "text-ivory-dim"}`}>{done(s.k) ? "Complete" : formatClock(s.time)}</span>
            </div>
            <p className="mt-1 text-sm text-ivory-dim">{s.desc}</p>
          </Link>
        ))}
      </div>
    </>
  );
}
