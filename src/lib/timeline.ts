import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { eventsBetween } from "./records";
import { prepPlan } from "./scheduling";
import { prayerConfig, type PrayerSettingsRow } from "./reminders";
import { PRAYERS, PRAYER_LABEL, prayerTimesFor } from "./prayer";
import { dayBoundsUtc, zonedToUtc } from "./time";
import type { ActivityOccurrence, Commitment, OccurrenceStatus, Task } from "./types";

/**
 * The Daily Command Center: one ordered timeline combining appointments,
 * workouts, tasks with times, commitments, prayers, focus sessions, check-ins
 * and preparation/travel buffers.
 */

export type ItemState = "upcoming" | "active" | "completed" | "late" | "awaiting" | "skipped" | "rescheduled" | "excused";
export type ItemType = "event" | "buffer" | "task" | "commitment" | "prayer" | "focus" | "checkin";

export interface TimelineItem {
  id: string;                    // unique within the day
  type: ItemType;
  ref: string;                   // entity id (event id, task id, …)
  occStart?: number;             // event occurrences: original start (ms)
  title: string;
  subtitle?: string;
  kind?: string;                 // activity kind for events
  start: string;                 // ISO
  end: string | null;            // ISO
  state: ItemState;
  draggable: boolean;            // can be rescheduled by dragging
  href?: string;
  meta?: Record<string, string | number | boolean | null>;
}

export interface Timeline { items: TimelineItem[]; untimedTasks: Task[]; now: string }

const occState = (s: OccurrenceStatus | undefined, start: Date, end: Date, now: Date): ItemState => {
  switch (s) {
    case "completed": return "completed";
    case "completed_late": return "late";
    case "skipped": case "missed": return "skipped";
    case "rescheduled": return "rescheduled";
    case "excused": return "excused";
    case "awaiting_confirmation": return "awaiting";
    case "started": return "active";
  }
  if (now < start) return "upcoming";
  if (now <= end) return "active";
  return "awaiting";
};

export async function buildTimeline(db: SupabaseClient, date: string, tz: string, profile: { morning_checkin_time: string; evening_checkin_time: string }, middayTime: string | null): Promise<Timeline> {
  const now = new Date();
  const { start: dayStart, end: dayEnd } = dayBoundsUtc(date, tz);
  const [occs, { data: rows }, { data: tasks }, { data: commitments }, { data: ps }, { data: conf }, { data: focus }, { data: sessions }] = await Promise.all([
    eventsBetween(db, date, date, tz),
    db.from("activity_occurrences").select("*").gte("occurrence_start", dayStart.toISOString()).lt("occurrence_start", dayEnd.toISOString()),
    db.from("tasks").select("*").or(`scheduled_for.eq.${date},and(due_at.gte.${dayStart.toISOString()},due_at.lt.${dayEnd.toISOString()})`).neq("status", "cancelled").order("created_at"),
    db.from("commitments").select("*").eq("commitment_date", date).order("promised_by"),
    db.from("prayer_settings").select("*").maybeSingle<PrayerSettingsRow>(),
    db.from("prayer_confirmations").select("prayer,status").eq("prayer_date", date),
    db.from("focus_sessions").select("id,intention,started_at,ends_at,ended_at,status,planned_minutes").gte("started_at", dayStart.toISOString()).lt("started_at", dayEnd.toISOString()),
    db.from("accountability_sessions").select("kind,status").eq("session_date", date),
  ]);
  const byKey = new Map(((rows ?? []) as ActivityOccurrence[]).map((r) => [`${r.event_id}:${Date.parse(r.occurrence_start)}`, r]));
  const items: TimelineItem[] = [];

  // Occurrence rows for one-off events that were moved to another day still belong on this day's record.
  const seen = new Set<string>();
  for (const o of occs) {
    const ev = o.event;
    const key = `${ev.id}:${o.start.getTime()}`;
    seen.add(key);
    const row = byKey.get(key);
    const end = o.end ?? new Date(o.start.getTime() + 60 * 60_000);
    if (ev.all_day) {
      items.push({ id: `ev-${key}`, type: "event", ref: ev.id, occStart: o.start.getTime(), title: ev.title, subtitle: "All day", kind: ev.kind ?? "appointment",
        start: dayStart.toISOString(), end: null, state: "upcoming", draggable: false, href: `/plan/${ev.id}`, meta: { allDay: true } });
      continue;
    }
    const plan = prepPlan(o.start, ev.prep_minutes, ev.travel_minutes);
    const state = occState(row?.status, o.start, end, now);
    if (ev.prep_minutes > 0 && state === "upcoming") items.push({ id: `prep-${key}`, type: "buffer", ref: ev.id, title: `Prepare for ${ev.title}`, start: plan.beginPrepAt.toISOString(), end: plan.leaveBy.toISOString(), state: now > plan.beginPrepAt ? "active" : "upcoming", draggable: false, meta: { buffer: "prep" } });
    if (ev.travel_minutes > 0 && state === "upcoming") items.push({ id: `travel-${key}`, type: "buffer", ref: ev.id, title: `Travel to ${ev.title}`, start: plan.leaveBy.toISOString(), end: o.start.toISOString(), state: now > plan.leaveBy ? "active" : "upcoming", draggable: false, meta: { buffer: "travel" } });
    items.push({
      id: `ev-${key}`, type: "event", ref: ev.id, occStart: o.start.getTime(), title: ev.title, kind: ev.kind ?? "appointment",
      subtitle: [ev.location, row?.status === "rescheduled" && row.rescheduled_to ? `moved to ${new Date(row.rescheduled_to).toLocaleString("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit" })}` : null, row?.skip_reason ? `skipped: ${row.skip_reason}` : null].filter(Boolean).join(" · ") || undefined,
      start: o.start.toISOString(), end: end.toISOString(), state, draggable: state === "upcoming" || state === "awaiting", href: `/plan/${ev.id}`,
      meta: { started: row?.status === "started", accountability: ev.accountability ?? "light", importance: ev.importance, delay: row?.delay_minutes ?? null, notes: row?.notes ?? null, duration: row?.duration_minutes ?? null, recurring: ev.recurrence !== "none" },
    });
  }
  // Original records of activities that were moved away from this day.
  for (const r of (rows ?? []) as ActivityOccurrence[]) {
    const key = `${r.event_id}:${Date.parse(r.occurrence_start)}`;
    if (seen.has(key)) continue;
    items.push({ id: `ev-${key}`, type: "event", ref: r.event_id, occStart: Date.parse(r.occurrence_start), title: r.title, kind: r.kind,
      subtitle: r.rescheduled_to ? `moved to ${new Date(r.rescheduled_to).toLocaleString("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit" })}` : undefined,
      start: r.occurrence_start, end: r.occurrence_end, state: occState(r.status, new Date(r.occurrence_start), new Date(r.occurrence_end ?? r.occurrence_start), now), draggable: false });
  }

  const untimed: Task[] = [];
  for (const t of (tasks ?? []) as Task[]) {
    if (!t.due_at) { if (t.scheduled_for === date) untimed.push(t); continue; }
    const due = new Date(t.due_at);
    const state: ItemState = t.status === "done" ? (t.original_due_at && t.completed_at && Date.parse(t.completed_at) > Date.parse(t.original_due_at) ? "late" : "completed") : t.status === "missed" ? "skipped" : due < now ? "awaiting" : "upcoming";
    items.push({ id: `task-${t.id}`, type: "task", ref: t.id, title: t.title, subtitle: t.original_due_at && t.original_due_at !== t.due_at ? `originally ${new Date(t.original_due_at).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" })}` : undefined,
      start: due.toISOString(), end: null, state, draggable: t.status === "pending", meta: { priority: t.is_top_priority, notes: t.notes } });
  }

  for (const c of (commitments ?? []) as Commitment[]) {
    if (!c.promised_by) continue;
    const by = new Date(c.promised_by);
    const state: ItemState = c.status === "kept" ? "completed" : c.status === "kept_late" ? "late" : c.status === "broken" ? "skipped" : c.status === "released" ? "excused" : by < now ? "awaiting" : "upcoming";
    items.push({ id: `com-${c.id}`, type: "commitment", ref: c.id, title: c.title,
      subtitle: [c.made_to !== "self" ? `promised to ${c.made_to}` : null, c.original_promised_by && c.original_promised_by !== c.promised_by ? `originally ${new Date(c.original_promised_by).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" })}` : null, c.first_action && c.status === "open" ? `start: ${c.first_action}` : null].filter(Boolean).join(" · ") || undefined,
      start: by.toISOString(), end: null, state, draggable: c.status === "open", meta: { madeTo: c.made_to } });
  }

  const cfg = ps ? prayerConfig(ps, tz) : null;
  if (cfg) {
    const times = prayerTimesFor(date, cfg);
    const done = new Map((conf ?? []).map((c) => [c.prayer, c.status]));
    PRAYERS.forEach((p, idx) => {
      const next = idx < PRAYERS.length - 1 ? times[PRAYERS[idx + 1]] : dayEnd;
      const state: ItemState = done.has(p) ? "completed" : times[p] > now ? "upcoming" : next && next > now ? "active" : "awaiting";
      items.push({ id: `prayer-${p}`, type: "prayer", ref: p, title: PRAYER_LABEL[p], start: times[p].toISOString(), end: null, state, draggable: false,
        subtitle: done.has(p) ? (done.get(p) === "prayed_late" ? "prayed late" : "prayed") : state === "awaiting" ? "not confirmed — never counted as missed" : undefined });
    });
  }

  for (const f of focus ?? []) {
    items.push({ id: `focus-${f.id}`, type: "focus", ref: f.id, title: f.intention || `${f.planned_minutes}-minute focus`, start: f.started_at, end: f.ended_at ?? f.ends_at,
      state: f.status === "completed" ? "completed" : f.status === "abandoned" ? "skipped" : "active", draggable: false, href: "/rhythm" });
  }

  const doneKinds = new Set((sessions ?? []).filter((s) => s.status === "completed").map((s) => s.kind));
  const checkins = [
    { kind: "morning", time: profile.morning_checkin_time, title: "Morning plan" },
    ...(middayTime ? [{ kind: "midday", time: middayTime.slice(0, 5), title: "Midday check-in" }] : []),
    { kind: "evening", time: profile.evening_checkin_time, title: "Evening review" },
  ];
  for (const c of checkins) {
    const at = zonedToUtc(date, c.time.slice(0, 5), tz);
    items.push({ id: `checkin-${c.kind}`, type: "checkin", ref: c.kind, title: c.title, start: at.toISOString(), end: null,
      state: doneKinds.has(c.kind) ? "completed" : at > now ? "upcoming" : "awaiting", draggable: false, href: `/checkin/${c.kind}` });
  }

  items.sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || (a.type === "buffer" ? -1 : 0));
  return { items, untimedTasks: untimed, now: now.toISOString() };
}
