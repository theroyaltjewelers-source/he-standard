import Link from "next/link";
import { requireUser } from "@/lib/session";
import { formatClock } from "@/lib/time";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Check-in" };

export default async function Checkin() {
  const { supabase, profile, today } = await requireUser();
  const [{ data }, { data: prefs }] = await Promise.all([
    supabase.from("accountability_sessions").select("kind,status").eq("session_date", today),
    supabase.from("user_preferences").select("midday_checkin_time").maybeSingle(),
  ]);
  const done = (k: string) => data?.some((s) => s.kind === k && s.status === "completed");
  return (
    <>
      <PageHeader title="Check-in" subtitle="What you will do, where you stand, and what you did." />
      <div className="space-y-3">
        {[
          { k: "morning", title: "Morning commitments", desc: "Up to three priorities with outcome, time, effort, obstacle and first action.", time: profile.morning_checkin_time },
          { k: "midday", title: "Midday check-in", desc: "Two minutes: what's done, what's left, what needs to change this afternoon.", time: prefs?.midday_checkin_time ?? "13:00" },
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
