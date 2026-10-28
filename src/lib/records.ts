import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeIntegrity, type IntegrityResult } from "./integrity";
import { occurrences } from "./scheduling";
import { overlapsDay } from "./series";
import { dayBoundsUtc, localDateString, shiftDate } from "./time";
import type { CalendarEvent, Commitment, Task } from "./types";

/** Integrity results for each day in [from, to] (inclusive), from recorded data only. */
export async function integritySeries(db: SupabaseClient, from: string, to: string, today: string, userId?: string) {
  // userId is required when called with the service-role client (planner); RLS scopes user clients anyway.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const own = (q: any) => (userId ? q.eq("user_id", userId) : q) as Promise<{ data: any[] | null }>;
  const [{ data: cs }, { data: ts }, { data: ss }] = await Promise.all([
    own(db.from("commitments").select("commitment_date,status,verification,failure_context").gte("commitment_date", from).lte("commitment_date", to)),
    own(db.from("tasks").select("scheduled_for,status,verification,miss_reason").gte("scheduled_for", from).lte("scheduled_for", to)),
    own(db.from("accountability_sessions").select("session_date,kind,status").eq("kind", "evening").gte("session_date", from).lte("session_date", to)),
  ]);
  const out: { date: string; result: IntegrityResult }[] = [];
  for (let d = from; d <= to; d = shiftDate(d, 1)) {
    const evening = (ss ?? []).some((x) => x.session_date === d && x.status === "completed");
    out.push({
      date: d,
      result: computeIntegrity({
        commitments: (cs ?? []).filter((c) => c.commitment_date === d) as Pick<Commitment, "status" | "verification" | "failure_context">[],
        tasks: (ts ?? []).filter((t) => t.scheduled_for === d) as Pick<Task, "status" | "verification" | "miss_reason">[],
        eveningReviewCompleted: evening,
        dayClosed: d < today || evening,
      }),
    });
  }
  return out;
}

export interface Occurrence {
  event: CalendarEvent;
  start: Date;
  end: Date | null;
  date: string;
}

/** Event occurrences (recurrences expanded) between two local dates inclusive. */
export async function eventsBetween(db: SupabaseClient, from: string, to: string, timeZone: string): Promise<Occurrence[]> {
  const start = dayBoundsUtc(from, timeZone).start;
  const end = dayBoundsUtc(to, timeZone).end;
  // Single events that start in the range, or started earlier and are still running (crossing midnight).
  const [{ data: single }, { data: recurring }] = await Promise.all([
    db.from("events").select("*").eq("recurrence", "none").lt("starts_at", end.toISOString()).or(`starts_at.gte.${start.toISOString()},ends_at.gt.${start.toISOString()}`),
    db.from("events").select("*").neq("recurrence", "none").lt("starts_at", end.toISOString()),
  ]);
  const out: Occurrence[] = [];
  for (const ev of [...(single ?? []), ...(recurring ?? [])] as CalendarEvent[]) {
    const dur = ev.ends_at ? Date.parse(ev.ends_at) - Date.parse(ev.starts_at) : null;
    // Recurrences keep the wall-clock time of the zone they were planned in, even while travelling.
    const zone = ev.timezone || timeZone;
    const lookBack = dur && dur > 0 ? dur : 0;
    for (const o of occurrences({ startsAt: new Date(ev.starts_at), recurrence: ev.recurrence, until: ev.recurrence_until, timeZone: zone, from: new Date(start.getTime() - lookBack), to: end })) {
      const oEnd = dur !== null ? new Date(o.getTime() + dur) : null;
      if (!overlapsDay(o, oEnd, start, end)) continue;
      out.push({ event: ev, start: o, end: oEnd, date: localDateString(o, timeZone) });
    }
  }
  return out.sort((a, b) => +a.start - +b.start);
}
