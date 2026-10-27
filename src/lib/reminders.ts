import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CalendarEvent, Commitment, Profile, Task } from "./types";
import { eventReminders, occurrences } from "./scheduling";
import { formatInZone, localDateString, shiftDate, todayIn, zonedToUtc } from "./time";

/**
 * Reminder generation. Every generated reminder has a stable dedupe_key so the
 * planner can run repeatedly without creating duplicates. Editing the source
 * item cancels its future reminders and regenerates them.
 */

type Row = {
  user_id: string;
  entity_type: "task" | "event" | "commitment" | "checkin" | "custom";
  entity_id: string | null;
  dedupe_key: string;
  title: string;
  body: string | null;
  url: string;
  send_at: string;
  respect_quiet_hours: boolean;
};

async function insertRows(db: SupabaseClient, rows: Row[]) {
  if (!rows.length) return;
  const { error } = await db.from("reminders").upsert(rows, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true });
  if (error) throw new Error(`Could not save reminders: ${error.message}`);
}

export async function cancelFutureReminders(db: SupabaseClient, entityType: Row["entity_type"], entityId: string) {
  // Delete (not just cancel) so regenerated reminders can reuse the dedupe key.
  const { error } = await db
    .from("reminders")
    .delete()
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .eq("status", "scheduled");
  if (error) throw new Error(`Could not update reminders: ${error.message}`);
}

/** Horizon for generating occurrences of recurring events. The planner job rolls it forward. */
const EVENT_HORIZON_DAYS = 8;

export function buildEventReminderRows(userId: string, ev: CalendarEvent, timeZone: string, now = new Date()): Row[] {
  const starts = new Date(ev.starts_at);
  const occ = occurrences({
    startsAt: starts,
    recurrence: ev.recurrence,
    until: ev.recurrence_until,
    timeZone,
    from: now,
    to: new Date(now.getTime() + EVENT_HORIZON_DAYS * 864e5),
  });
  const rows: Row[] = [];
  for (const o of occ) {
    for (const r of eventReminders({
      title: ev.title,
      startsAt: o,
      prepMinutes: ev.prep_minutes,
      travelMinutes: ev.travel_minutes,
      offsets: ev.all_day ? [] : ev.reminder_offsets,
      importance: ev.importance,
      timeZone,
      now,
    })) {
      rows.push({
        user_id: userId,
        entity_type: "event",
        entity_id: ev.id,
        dedupe_key: `event:${ev.id}:${o.toISOString()}:${r.key}`,
        title: r.title,
        body: r.body,
        url: `/plan?date=${localDateString(o, timeZone)}`,
        send_at: r.sendAt.toISOString(),
        respect_quiet_hours: r.respectQuietHours,
      });
    }
  }
  return rows;
}

export async function syncEventReminders(db: SupabaseClient, userId: string, ev: CalendarEvent, timeZone: string) {
  await cancelFutureReminders(db, "event", ev.id);
  await insertRows(db, buildEventReminderRows(userId, ev, timeZone));
}

export async function syncTaskReminders(db: SupabaseClient, userId: string, task: Task, timeZone: string) {
  await cancelFutureReminders(db, "task", task.id);
  if (task.status !== "pending") return;
  const rows: Row[] = [];
  const now = Date.now();
  if (task.due_at) {
    const due = new Date(task.due_at);
    const before = new Date(due.getTime() - 30 * 60_000);
    if (before.getTime() > now) {
      rows.push({
        user_id: userId, entity_type: "task", entity_id: task.id,
        dedupe_key: `task:${task.id}:due-30:${task.due_at}`,
        title: `Due at ${formatInZone(due, timeZone, "h:mm a")}: ${task.title}`,
        body: "Are you on track to finish it on time?",
        url: "/tasks", send_at: before.toISOString(), respect_quiet_hours: false,
      });
    }
  }
  // After a second postponement, ask once about the obstacle on the new day.
  if (task.postponed_count >= 2 && task.scheduled_for) {
    const at = zonedToUtc(task.scheduled_for, "10:00", timeZone);
    if (at.getTime() > now) {
      rows.push({
        user_id: userId, entity_type: "task", entity_id: task.id,
        dedupe_key: `task:${task.id}:postponed:${task.postponed_count}`,
        title: `Postponed ${task.postponed_count} times: ${task.title}`,
        body: "What obstacle is preventing you from starting?",
        url: "/tasks", send_at: at.toISOString(), respect_quiet_hours: true,
      });
    }
  }
  await insertRows(db, rows);
}

export async function syncCommitmentReminders(db: SupabaseClient, userId: string, c: Commitment, timeZone: string) {
  await cancelFutureReminders(db, "commitment", c.id);
  if (c.status !== "open" || !c.promised_by) return;
  const by = new Date(c.promised_by);
  const at = new Date(by.getTime() - 60 * 60_000);
  if (at.getTime() <= Date.now()) return;
  await insertRows(db, [{
    user_id: userId, entity_type: "commitment", entity_id: c.id,
    dedupe_key: `commitment:${c.id}:${c.promised_by}`,
    title: `${c.title} — by ${formatInZone(by, timeZone, "h:mm a")}`,
    body: "You committed to this. Are you still on track?",
    url: "/today", send_at: at.toISOString(), respect_quiet_hours: false,
  }]);
}

/** Morning and evening check-in prompts for today and tomorrow (local), if still ahead. */
export function buildCheckinRows(p: Pick<Profile, "id" | "timezone" | "morning_checkin_time" | "evening_checkin_time">, now = new Date()): Row[] {
  const today = todayIn(p.timezone, now);
  const rows: Row[] = [];
  for (const day of [today, shiftDate(today, 1)]) {
    const morning = zonedToUtc(day, p.morning_checkin_time.slice(0, 5), p.timezone);
    const evening = zonedToUtc(day, p.evening_checkin_time.slice(0, 5), p.timezone);
    if (morning > now) rows.push({
      user_id: p.id, entity_type: "checkin", entity_id: null, dedupe_key: `checkin:morning:${day}`,
      title: "Morning commitments",
      body: "Name today's three commitments and when each will be done.",
      url: "/checkin/morning", send_at: morning.toISOString(), respect_quiet_hours: false,
    });
    if (evening > now) rows.push({
      user_id: p.id, entity_type: "checkin", entity_id: null, dedupe_key: `checkin:evening:${day}`,
      title: "Evening accountability",
      body: "Review what you promised and what you did.",
      url: "/checkin/evening", send_at: evening.toISOString(), respect_quiet_hours: false,
    });
  }
  return rows;
}

/** Planner: run every ~15 minutes with the service-role client. */
export async function planAllUsers(admin: SupabaseClient, now = new Date()) {
  const { data: profiles, error } = await admin
    .from("profiles")
    .select("id,timezone,morning_checkin_time,evening_checkin_time,onboarding_completed_at")
    .not("onboarding_completed_at", "is", null);
  if (error) throw new Error(error.message);

  let created = 0;
  for (const p of profiles ?? []) {
    const rows = buildCheckinRows(p, now);
    // Roll recurring events forward.
    const { data: events } = await admin.from("events").select("*").eq("user_id", p.id).neq("recurrence", "none");
    for (const ev of (events ?? []) as CalendarEvent[]) rows.push(...buildEventReminderRows(p.id, ev, p.timezone, now));
    await insertRows(admin, rows);
    created += rows.length;
  }
  return { users: profiles?.length ?? 0, considered: created };
}
