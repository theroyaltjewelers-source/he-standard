import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeIntegrity, type IntegrityResult } from "./integrity";
import { occurrences } from "./scheduling";
import { dayBoundsUtc, localDateString, shiftDate } from "./time";
import type { CalendarEvent, Commitment, Task } from "./types";

/** Integrity results for each day in [from, to] (inclusive), from recorded data only. */
export async function integritySeries(db: SupabaseClient, from: string, to: string, today: string) {
  const [{ data: cs }, { data: ts }, { data: ss }] = await Promise.all([
    db.from("commitments").select("commitment_date,status,verification,failure_context").gte("commitment_date", from).lte("commitment_date", to),
    db.from("tasks").select("scheduled_for,status,verification,miss_reason").gte("scheduled_for", from).lte("scheduled_for", to),
    db.from("accountability_sessions").select("session_date,kind,status").eq("kind", "evening").gte("session_date", from).lte("session_date", to),
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
  const [{ data: single }, { data: recurring }] = await Promise.all([
    db.from("events").select("*").eq("recurrence", "none").gte("starts_at", start.toISOString()).lt("starts_at", end.toISOString()),
    db.from("events").select("*").neq("recurrence", "none").lt("starts_at", end.toISOString()),
  ]);
  const out: Occurrence[] = [];
  for (const ev of [...(single ?? []), ...(recurring ?? [])] as CalendarEvent[]) {
    const dur = ev.ends_at ? Date.parse(ev.ends_at) - Date.parse(ev.starts_at) : null;
    for (const o of occurrences({ startsAt: new Date(ev.starts_at), recurrence: ev.recurrence, until: ev.recurrence_until, timeZone, from: start, to: end })) {
      out.push({ event: ev, start: o, end: dur !== null ? new Date(o.getTime() + dur) : null, date: localDateString(o, timeZone) });
    }
  }
  return out.sort((a, b) => +a.start - +b.start);
}
