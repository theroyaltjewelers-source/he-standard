import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CalendarEvent, Commitment, Profile, Task } from "./types";
import { eventReminders, occurrences } from "./scheduling";
import { formatInZone, localDateString, shiftDate, todayIn, zonedToUtc } from "./time";
import { actionsFor, type Category } from "./reminder-policy";
import { PRAYERS, PRAYER_LABEL, prayerTimesFor, prayerWindowEnd, type PrayerConfig } from "./prayer";

/**
 * Reminder generation. Every generated reminder has a stable dedupe_key so the
 * planner can run repeatedly without creating duplicates. Editing the source
 * item deletes its future reminders and regenerates them.
 */

export type EntityType = "task" | "event" | "commitment" | "checkin" | "custom" | "prayer" | "habit" | "goal" | "finance" | "weekly_report" | "reflection" | "focus";

export type Row = {
  user_id: string;
  entity_type: EntityType;
  entity_id: string | null;
  dedupe_key: string;
  title: string;
  body: string | null;
  url: string;
  send_at: string;
  respect_quiet_hours: boolean;
  category: Category;
  actions?: { action: string; title: string }[];
  follow_up_of?: string | null;
  follow_up_index?: number;
};

export async function insertRows(db: SupabaseClient, rows: Row[]) {
  if (!rows.length) return;
  const withActions = rows.map((r) => ({ ...r, actions: r.actions ?? actionsFor(r.entity_type) }));
  const { error } = await db.from("reminders").upsert(withActions, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true });
  if (error) throw new Error(`Could not save reminders: ${error.message}`);
}

export async function cancelFutureReminders(db: SupabaseClient, entityType: EntityType, entityId: string) {
  // Delete (not just cancel) so regenerated reminders can reuse the dedupe key.
  const { error } = await db.from("reminders").delete().eq("entity_type", entityType).eq("entity_id", entityId).eq("status", "scheduled");
  if (error) throw new Error(`Could not update reminders: ${error.message}`);
}

/* --------------------------------- events --------------------------------- */

const EVENT_HORIZON_DAYS = 8;

export function buildEventReminderRows(userId: string, ev: CalendarEvent, timeZone: string, now = new Date()): Row[] {
  const occ = occurrences({
    startsAt: new Date(ev.starts_at), recurrence: ev.recurrence, until: ev.recurrence_until, timeZone,
    from: now, to: new Date(now.getTime() + EVENT_HORIZON_DAYS * 864e5),
  });
  const rows: Row[] = [];
  for (const o of occ) {
    for (const r of eventReminders({
      title: ev.title, startsAt: o, prepMinutes: ev.prep_minutes, travelMinutes: ev.travel_minutes,
      offsets: ev.all_day ? [] : ev.reminder_offsets, importance: ev.importance, timeZone, now,
    })) {
      rows.push({
        user_id: userId, entity_type: "event", entity_id: ev.id, category: "appointments",
        dedupe_key: `event:${ev.id}:${o.toISOString()}:${r.key}`,
        title: r.title, body: r.body, url: `/plan?date=${localDateString(o, timeZone)}`,
        send_at: r.sendAt.toISOString(), respect_quiet_hours: r.respectQuietHours,
      });
    }
  }
  return rows;
}

export async function syncEventReminders(db: SupabaseClient, userId: string, ev: CalendarEvent, timeZone: string) {
  await cancelFutureReminders(db, "event", ev.id);
  await insertRows(db, buildEventReminderRows(userId, ev, timeZone));
}

/* ------------------------------ tasks & commitments ------------------------------ */

export async function syncTaskReminders(db: SupabaseClient, userId: string, task: Task, timeZone: string) {
  await cancelFutureReminders(db, "task", task.id);
  if (task.status !== "pending") return;
  const rows: Row[] = [];
  const now = Date.now();
  if (task.due_at) {
    const due = new Date(task.due_at);
    const before = new Date(due.getTime() - 30 * 60_000);
    if (before.getTime() > now) rows.push({
      user_id: userId, entity_type: "task", entity_id: task.id, category: "commitments",
      dedupe_key: `task:${task.id}:pre:${task.due_at}`,
      title: `Due at ${formatInZone(due, timeZone, "h:mm a")}: ${task.title}`, body: "Are you on track to finish it on time?",
      url: "/word", send_at: before.toISOString(), respect_quiet_hours: false,
    });
    if (due.getTime() > now) rows.push({
      user_id: userId, entity_type: "task", entity_id: task.id, category: "commitments",
      dedupe_key: `task:${task.id}:due:${task.due_at}`,
      title: `Due now: ${task.title}`, body: "Mark it done, or tell me what got in the way.",
      url: "/word", send_at: due.toISOString(), respect_quiet_hours: false,
    });
  }
  if (task.postponed_count >= 2 && task.scheduled_for) {
    const at = zonedToUtc(task.scheduled_for, "10:00", timeZone);
    if (at.getTime() > now) rows.push({
      user_id: userId, entity_type: "task", entity_id: task.id, category: "coaching",
      dedupe_key: `task:${task.id}:postponed:${task.postponed_count}`,
      title: `Postponed ${task.postponed_count} times: ${task.title}`, body: "What obstacle is preventing you from starting?",
      url: "/coach", send_at: at.toISOString(), respect_quiet_hours: true, actions: [],
    });
  }
  await insertRows(db, rows);
}

export async function syncCommitmentReminders(db: SupabaseClient, userId: string, c: Commitment, timeZone: string) {
  await cancelFutureReminders(db, "commitment", c.id);
  if (c.status !== "open" || !c.promised_by) return;
  const by = new Date(c.promised_by);
  const rows: Row[] = [];
  const pre = new Date(by.getTime() - 60 * 60_000);
  if (pre.getTime() > Date.now()) rows.push({
    user_id: userId, entity_type: "commitment", entity_id: c.id, category: "commitments",
    dedupe_key: `commitment:${c.id}:pre:${c.promised_by}`,
    title: `${c.title} — by ${formatInZone(by, timeZone, "h:mm a")}`, body: "You committed to this. Are you still on track?",
    url: "/today", send_at: pre.toISOString(), respect_quiet_hours: false,
  });
  if (by.getTime() > Date.now()) rows.push({
    user_id: userId, entity_type: "commitment", entity_id: c.id, category: "commitments",
    dedupe_key: `commitment:${c.id}:due:${c.promised_by}`,
    title: `Promised time: ${c.title}`, body: "Did you keep it? Record what happened.",
    url: "/today", send_at: by.toISOString(), respect_quiet_hours: false,
  });
  await insertRows(db, rows);
}

/* --------------------------------- check-ins --------------------------------- */

type CheckinProfile = Pick<Profile, "id" | "timezone" | "morning_checkin_time" | "evening_checkin_time"> & { midday_checkin_time?: string | null };

export function buildCheckinRows(p: CheckinProfile, now = new Date()): Row[] {
  const today = todayIn(p.timezone, now);
  const rows: Row[] = [];
  const kinds: { kind: string; time: string | null | undefined; title: string; body: string }[] = [
    { kind: "morning", time: p.morning_checkin_time, title: "Morning priorities", body: "Three priorities: outcome, time, effort, obstacle, first action." },
    { kind: "midday", time: p.midday_checkin_time, title: "Midday check-in", body: "What's done, what's outstanding, what needs to change this afternoon?" },
    { kind: "evening", time: p.evening_checkin_time, title: "Evening accountability", body: "What you promised, what you did, and what changes tomorrow." },
  ];
  for (const day of [today, shiftDate(today, 1)]) {
    for (const k of kinds) {
      if (!k.time) continue;
      const at = zonedToUtc(day, k.time.slice(0, 5), p.timezone);
      if (at > now) rows.push({
        user_id: p.id, entity_type: "checkin", entity_id: null, category: "accountability",
        dedupe_key: `checkin:${k.kind}:${day}`, title: k.title, body: k.body,
        url: `/checkin/${k.kind}`, send_at: at.toISOString(), respect_quiet_hours: false, actions: [],
      });
    }
  }
  return rows;
}

/* ---------------------------------- prayer ---------------------------------- */

export interface PrayerSettingsRow {
  user_id: string;
  method: string;
  madhab: "shafi" | "hanafi";
  high_latitude_rule: PrayerConfig["highLatitudeRule"];
  offsets: Partial<Record<string, number>>;
  latitude: number | null;
  longitude: number | null;
  location_label: string | null;
  reminders_enabled: boolean;
  remind_before_minutes: number;
  follow_up_minutes: number;
  pre_next_reminder: boolean;
  notify_during_quiet: boolean;
}

export function prayerConfig(s: PrayerSettingsRow, timeZone: string): PrayerConfig | null {
  if (s.latitude == null || s.longitude == null) return null;
  return {
    latitude: s.latitude, longitude: s.longitude, method: s.method, madhab: s.madhab,
    highLatitudeRule: s.high_latitude_rule, offsets: s.offsets as PrayerConfig["offsets"], timeZone,
  };
}

/**
 * Prayer reminders for today and tomorrow: at the start time (optionally a few
 * minutes before), a follow-up if unconfirmed, and one more before the window
 * closes. Dispatch skips any of these once the prayer is confirmed.
 */
export function buildPrayerRows(s: PrayerSettingsRow, timeZone: string, now = new Date()): Row[] {
  const cfg = prayerConfig(s, timeZone);
  if (!cfg || !s.reminders_enabled) return [];
  const today = todayIn(timeZone, now);
  const rows: Row[] = [];
  for (const day of [today, shiftDate(today, 1)]) {
    const sched = prayerTimesFor(day, cfg);
    for (const p of PRAYERS) {
      const start = sched[p];
      const end = prayerWindowEnd(p, day, cfg);
      const label = PRAYER_LABEL[p];
      const base = { user_id: s.user_id, entity_type: "prayer" as const, entity_id: null, category: "prayer" as const, url: `/faith?date=${day}`, respect_quiet_hours: !s.notify_during_quiet };
      const at = new Date(start.getTime() - s.remind_before_minutes * 60_000);
      if (at > now) rows.push({ ...base, dedupe_key: `prayer:${day}:${p}:start`, send_at: at.toISOString(),
        title: s.remind_before_minutes ? `${label} at ${formatInZone(start, timeZone, "h:mm a")}` : `${label} — ${formatInZone(start, timeZone, "h:mm a")}`,
        body: `Time for ${label}. Tap Prayed once you have prayed.` });
      if (s.follow_up_minutes > 0) {
        const fu = new Date(start.getTime() + s.follow_up_minutes * 60_000);
        if (fu > now && fu < new Date(end.getTime() - 10 * 60_000)) rows.push({ ...base, dedupe_key: `prayer:${day}:${p}:follow`, send_at: fu.toISOString(),
          title: `Have you prayed ${label}?`, body: `${label} time continues until ${formatInZone(end, timeZone, "h:mm a")}.` });
      }
      if (s.pre_next_reminder) {
        const pre = new Date(end.getTime() - 20 * 60_000);
        const fuAt = start.getTime() + s.follow_up_minutes * 60_000;
        if (pre > now && pre.getTime() > fuAt + 15 * 60_000) rows.push({ ...base, dedupe_key: `prayer:${day}:${p}:closing`, send_at: pre.toISOString(),
          title: `${label} time ends at ${formatInZone(end, timeZone, "h:mm a")}`, body: "Still unconfirmed. Tap Prayed if you already have." });
      }
    }
  }
  return rows;
}

export async function regeneratePrayerReminders(db: SupabaseClient, s: PrayerSettingsRow, timeZone: string) {
  await db.from("reminders").delete().eq("user_id", s.user_id).eq("entity_type", "prayer").eq("status", "scheduled");
  await insertRows(db, buildPrayerRows(s, timeZone));
}

/** Store the computed schedule (what the app displays and what reminders were built from). */
export async function savePrayerSchedule(db: SupabaseClient, s: PrayerSettingsRow, timeZone: string, date: string) {
  const cfg = prayerConfig(s, timeZone);
  if (!cfg) return null;
  const t = prayerTimesFor(date, cfg);
  const times = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.toISOString()]));
  await db.from("prayer_schedules").upsert({
    user_id: s.user_id, schedule_date: date, times, latitude: cfg.latitude, longitude: cfg.longitude,
    method: cfg.method, madhab: cfg.madhab, timezone: timeZone, computed_at: new Date().toISOString(),
  }, { onConflict: "user_id,schedule_date" });
  return t;
}
