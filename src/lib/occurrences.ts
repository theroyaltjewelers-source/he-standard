import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { completionStatus } from "./lifecycle";
import { occurrences as expand } from "./scheduling";
import { syncEventReminders, insertRows } from "./reminders";
import { actionsFor } from "./reminder-policy";
import { localDateString } from "./time";
import { createAdminClient } from "./supabase/admin";
import { pushOrQueue } from "./sync";
import type { ActivityOccurrence, CalendarEvent } from "./types";

/**
 * The lifecycle record of one occurrence of a scheduled activity. The row's
 * occurrence_start is the ORIGINAL scheduled time and is never rewritten:
 * rescheduling marks it "rescheduled" and points to the new time.
 */

export type OccurrenceAction =
  | { type: "start"; actualAt?: Date | null }
  | { type: "complete"; durationMinutes?: number | null; workoutType?: string | null; intensity?: number | null; notes?: string | null; actualAt?: Date | null }
  | { type: "late"; minutes?: number }
  | { type: "skip"; reason: string }
  | { type: "excuse"; reason: string }
  | { type: "reschedule"; to: Date }
  | { type: "note"; notes: string }
  | { type: "reopen" };

export type Source = "app" | "notification" | "coach" | "timeline" | "system";

export async function ensureOccurrence(db: SupabaseClient, userId: string, ev: CalendarEvent, start: Date): Promise<ActivityOccurrence> {
  const iso = start.toISOString();
  const { data: existing } = await db.from("activity_occurrences").select("*").eq("event_id", ev.id).eq("occurrence_start", iso).maybeSingle<ActivityOccurrence>();
  if (existing) return existing;
  const dur = ev.ends_at ? Date.parse(ev.ends_at) - Date.parse(ev.starts_at) : 60 * 60_000;
  const { data, error } = await db.from("activity_occurrences").upsert({
    user_id: userId, event_id: ev.id, occurrence_start: iso, occurrence_end: new Date(start.getTime() + dur).toISOString(),
    title: ev.title, kind: ev.kind ?? "appointment", status: "scheduled",
  }, { onConflict: "event_id,occurrence_start" }).select("*").single<ActivityOccurrence>();
  if (error) throw new Error(`Could not record the activity: ${error.message}`);
  return data;
}

/** Validates that `start` is a real occurrence of the event (guards against forged times). */
export function isOccurrenceOf(ev: CalendarEvent, start: Date, tz: string): boolean {
  if (Date.parse(ev.starts_at) === start.getTime()) return true;
  if (ev.recurrence === "none") return false;
  const list = expand({ startsAt: new Date(ev.starts_at), recurrence: ev.recurrence, until: ev.recurrence_until, timeZone: ev.timezone || tz, from: new Date(start.getTime() - 1000), to: new Date(start.getTime() + 1000) });
  return list.some((d) => d.getTime() === start.getTime());
}

async function cancelStageReminders(db: SupabaseClient, ev: CalendarEvent, start: Date, stagePrefix = "life-") {
  await db.from("reminders").update({ status: "cancelled", last_error: "answered" })
    .eq("entity_type", "event").eq("entity_id", ev.id).eq("status", "scheduled")
    .like("dedupe_key", `event:${ev.id}:${start.toISOString()}:${stagePrefix}%`);
}

export async function applyOccurrenceAction(db: SupabaseClient, userId: string, ev: CalendarEvent, start: Date, action: OccurrenceAction, source: Source, tz: string): Promise<{ occurrence: ActivityOccurrence; message: string; newEventId?: string }> {
  const occ = await ensureOccurrence(db, userId, ev, start);
  const now = new Date();
  const evidence = source === "system" ? "unverified" : "self_reported";
  // Reported after the day ended → retrospective self-report (never shown as contemporaneous).
  const retrospective = localDateString(start, tz) < localDateString(now, tz);
  const stamp = { confirmed_at: now.toISOString(), retrospective: retrospective || occ.retrospective === true };
  let patch: Partial<ActivityOccurrence> & Record<string, unknown> = {};
  let message = "";
  let newEventId: string | undefined;

  switch (action.type) {
    case "start": {
      const at = action.actualAt ?? now;
      const delay = Math.max(0, Math.round((at.getTime() - start.getTime()) / 60_000));
      patch = { status: "started", started_at: occ.started_at ?? at.toISOString(), delay_minutes: delay > 0 ? delay : occ.delay_minutes, evidence, source, ...stamp };
      await cancelStageReminders(db, ev, start, "life-start");
      message = `Started ${ev.title}`;
      break;
    }
    case "complete": {
      const planned = occ.occurrence_end ? Math.round((Date.parse(occ.occurrence_end) - start.getTime()) / 60_000) : 60;
      // For a retrospective report the user tells us when it actually happened.
      const reportedStart = action.actualAt ?? null;
      const startedAt = occ.started_at ? new Date(occ.started_at) : reportedStart;
      const status = completionStatus({ scheduledStart: start, startedAt, delayMinutes: occ.delay_minutes });
      const duration = action.durationMinutes ?? (startedAt && !reportedStart ? Math.max(1, Math.round((now.getTime() - startedAt.getTime()) / 60_000)) : planned);
      const completedAt = reportedStart ? new Date(reportedStart.getTime() + duration * 60_000) : retrospective ? new Date(start.getTime() + duration * 60_000) : now;
      patch = { status, started_at: occ.started_at ?? reportedStart?.toISOString() ?? null, completed_at: completedAt.toISOString(), duration_minutes: Math.min(duration, 1440), notes: action.notes ?? occ.notes, evidence, source, ...stamp };
      await cancelStageReminders(db, ev, start);
      if ((ev.kind ?? "appointment") === "workout") {
        const { data: existing } = await db.from("workout_logs").select("id").eq("occurrence_id", occ.id).maybeSingle();
        const log = {
          user_id: userId, occurrence_id: occ.id, performed_on: localDateString(startedAt ?? start, tz), started_at: (startedAt ?? start).toISOString(),
          duration_minutes: Math.min(duration, 600), workout_type: action.workoutType ?? "other", intensity: action.intensity ?? null, notes: action.notes ?? null,
          source: source === "system" ? "app" : source,
        };
        if (existing) await db.from("workout_logs").update(log).eq("id", existing.id);
        else await db.from("workout_logs").insert(log);
      }
      message = `${status === "completed_late" ? `Completed ${ev.title} (started late)` : `Completed ${ev.title}`}${stamp.retrospective ? " — recorded as reported later" : ""}`;
      break;
    }
    case "late": {
      const minutes = Math.max(5, Math.min(180, action.minutes ?? 15));
      const delay = (occ.delay_minutes ?? 0) + minutes;
      patch = { delay_minutes: delay, source };
      const n = Math.round(delay / 5);
      await insertRows(db, [{
        user_id: userId, entity_type: "event", entity_id: ev.id, category: ev.kind === "workout" ? "fitness" : "appointments",
        dedupe_key: `event:${ev.id}:${start.toISOString()}:life-start-late${n}`,
        title: `Ready now? ${ev.title}`, body: `You said you were running ${minutes} min late.`,
        url: `/today?date=${localDateString(start, tz)}#occ-${ev.id}`, send_at: new Date(now.getTime() + minutes * 60_000).toISOString(),
        respect_quiet_hours: false, actions: actionsFor("event", "life-start"),
      }]);
      message = `Noted: running ${minutes} min late`;
      break;
    }
    case "skip":
      patch = { status: "skipped", skip_reason: action.reason.slice(0, 500), evidence, source, ...stamp };
      await cancelStageReminders(db, ev, start);
      message = `Skipped ${ev.title}`;
      break;
    case "excuse":
      patch = { status: "excused", skip_reason: action.reason.slice(0, 500), evidence, source, ...stamp };
      await cancelStageReminders(db, ev, start);
      message = `Excused ${ev.title}`;
      break;
    case "note":
      patch = { notes: action.notes.slice(0, 2000) };
      message = "Note saved";
      break;
    case "reopen":
      patch = { status: "scheduled", started_at: null, completed_at: null, duration_minutes: null, skip_reason: null, rescheduled_to: null, confirmed_at: null, retrospective: false };
      if ((ev.kind ?? "appointment") === "workout") await db.from("workout_logs").delete().eq("occurrence_id", occ.id);
      message = "Reopened";
      break;
    case "reschedule": {
      const to = action.to;
      const dur = occ.occurrence_end ? Date.parse(occ.occurrence_end) - start.getTime() : 60 * 60_000;
      patch = { status: "rescheduled", rescheduled_to: to.toISOString(), source };
      await cancelStageReminders(db, ev, start);
      let target: CalendarEvent;
      if (ev.recurrence === "none") {
        // One-off: move the event itself. The original time stays on record in
        // this occurrence row ("rescheduled" → rescheduled_to).
        const { data: moved, error } = await db.from("events").update({
          starts_at: to.toISOString(), ends_at: new Date(to.getTime() + dur).toISOString(), ...(ev.external_source ? { sync_status: "pending_push" } : {}),
        }).eq("id", ev.id).select("*").single<CalendarEvent>();
        if (error) throw new Error(`Could not reschedule: ${error.message}`);
        target = moved;
      } else {
        // One instance of a recurring activity: add a one-off at the new time.
        const { data: copy, error } = await db.from("events").insert({
          user_id: userId, title: ev.title, location: ev.location, notes: ev.notes, starts_at: to.toISOString(), ends_at: new Date(to.getTime() + dur).toISOString(),
          all_day: false, importance: ev.importance, prep_minutes: ev.prep_minutes, travel_minutes: ev.travel_minutes, reminder_offsets: ev.reminder_offsets,
          recurrence: "none", kind: ev.kind ?? "appointment", accountability: ev.accountability ?? "light", rescheduled_from: ev.id, plan_confirmed_at: ev.plan_confirmed_at, timezone: ev.timezone ?? tz,
        }).select("*").single<CalendarEvent>();
        if (error) throw new Error(`Could not reschedule: ${error.message}`);
        target = copy;
        newEventId = copy.id;
      }
      await syncEventReminders(db, userId, target, tz);
      await pushOrQueue(createAdminClient(), userId, target, tz); // failures are queued for retry
      message = `Moved to ${to.toLocaleString("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit" })}`;
      break;
    }
  }
  const { data, error } = await db.from("activity_occurrences").update(patch).eq("id", occ.id).select("*").single<ActivityOccurrence>();
  if (error) throw new Error(`Could not save: ${error.message}`);
  return { occurrence: data, message, newEventId };
}

/**
 * Planner sweep: make sure every accountable occurrence that has started has
 * a lifecycle row, and mark unanswered ones that ended 3+ hours ago as
 * "awaiting confirmation" (never completed, never missed).
 */
export async function sweepOccurrences(admin: SupabaseClient, userId: string, tz: string, now = new Date(), since?: Date) {
  // Look back 36 h normally; after an outage or long inactivity, back to the last reconciliation (max 30 days).
  const floor = new Date(now.getTime() - 30 * 864e5);
  const from = since && since < new Date(now.getTime() - 36 * 3600_000) ? (since > floor ? since : floor) : new Date(now.getTime() - 36 * 3600_000);
  const { data: events } = await admin.from("events").select("*").eq("user_id", userId).neq("accountability", "off").eq("all_day", false)
    .or(`recurrence.neq.none,starts_at.gte.${from.toISOString()}`);
  let created = 0;
  for (const ev of (events ?? []) as CalendarEvent[]) {
    const starts = expand({ startsAt: new Date(ev.starts_at), recurrence: ev.recurrence, until: ev.recurrence_until, timeZone: ev.timezone || tz, from, to: now });
    const dur = ev.ends_at ? Date.parse(ev.ends_at) - Date.parse(ev.starts_at) : 60 * 60_000;
    const rows = starts.map((s) => ({
      user_id: userId, event_id: ev.id, occurrence_start: s.toISOString(), occurrence_end: new Date(s.getTime() + dur).toISOString(),
      title: ev.title, kind: ev.kind ?? "appointment", status: "scheduled",
    }));
    if (rows.length) {
      const { error } = await admin.from("activity_occurrences").upsert(rows, { onConflict: "event_id,occurrence_start", ignoreDuplicates: true });
      if (!error) created += rows.length;
    }
  }
  const cutoff = new Date(now.getTime() - 3 * 3600_000).toISOString();
  const { data: stale } = await admin.from("activity_occurrences").update({ status: "awaiting_confirmation" })
    .eq("user_id", userId).in("status", ["scheduled", "started"]).lt("occurrence_end", cutoff).select("id");
  return { considered: created, awaiting: stale?.length ?? 0 };
}
