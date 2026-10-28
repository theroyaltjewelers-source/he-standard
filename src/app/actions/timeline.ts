"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { applyOccurrenceAction, isOccurrenceOf } from "@/lib/occurrences";
import { findConflicts } from "@/lib/conflicts";
import { syncCommitmentReminders, syncTaskReminders } from "@/lib/reminders";
import { localDateString, zonedToUtc } from "@/lib/time";
import type { CalendarEvent, Commitment, Task } from "@/lib/types";

/**
 * Actions from the Daily Command Center. Each returns only after the database
 * confirmed the change. Moves are checked for conflicts first; the caller must
 * confirm (ack) before an overlapping time is saved.
 */

export type TimelineResult = { ok?: true; message?: string; error?: string; conflicts?: string[] };

const refresh = () => { revalidatePath("/today"); revalidatePath("/progress"); revalidatePath("/word"); revalidatePath("/plan"); };
const localTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

const occSchema = z.object({
  eventId: z.uuid(),
  start: z.number().int(),
  type: z.enum(["start", "complete", "late", "skip", "excuse", "reschedule", "note", "reopen"]),
  reason: z.string().max(500).optional(),
  minutes: z.number().int().min(5).max(240).optional(),
  to: localTime.optional(),
  notes: z.string().max(2000).optional(),
  durationMinutes: z.number().int().min(1).max(600).optional(),
  workoutType: z.enum(["strength", "cardio", "mobility", "sport", "recovery", "other"]).optional(),
  intensity: z.number().int().min(1).max(5).optional(),
  ack: z.boolean().optional(),
});

export async function occurrenceAction(input: z.input<typeof occSchema>): Promise<TimelineResult> {
  const parsed = occSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const i = parsed.data;
  const { supabase, user, profile } = await requireUser();
  const tz = profile.timezone;
  const { data: ev } = await supabase.from("events").select("*").eq("id", i.eventId).maybeSingle<CalendarEvent>();
  if (!ev) return { error: "That activity no longer exists." };
  const start = new Date(i.start);
  if (!isOccurrenceOf(ev, start, tz)) return { error: "That occurrence isn't on the schedule." };
  if ((i.type === "skip" || i.type === "excuse") && (!i.reason || i.reason.trim().split(/\s+/).length < 2)) return { error: "Add a short reason — a few words is enough." };
  if (i.type === "reschedule" && !i.to) return { error: "Choose the new time." };

  let to: Date | undefined;
  if (i.type === "reschedule") {
    to = zonedToUtc(i.to!.slice(0, 10), i.to!.slice(11, 16), tz);
    const dur = ev.ends_at ? Date.parse(ev.ends_at) - Date.parse(ev.starts_at) : 60 * 60_000;
    if (!i.ack) {
      const conflicts = await findConflicts(supabase, to, new Date(to.getTime() + dur), tz, ev.id, ev.prep_minutes + ev.travel_minutes);
      if (conflicts.length) return { conflicts };
    }
  }
  const action =
    i.type === "complete" ? { type: "complete" as const, durationMinutes: i.durationMinutes, workoutType: i.workoutType, intensity: i.intensity, notes: i.notes }
    : i.type === "late" ? { type: "late" as const, minutes: i.minutes }
    : i.type === "skip" ? { type: "skip" as const, reason: i.reason! }
    : i.type === "excuse" ? { type: "excuse" as const, reason: i.reason! }
    : i.type === "reschedule" ? { type: "reschedule" as const, to: to! }
    : i.type === "note" ? { type: "note" as const, notes: i.notes ?? "" }
    : { type: i.type };
  try {
    const out = await applyOccurrenceAction(supabase, user.id, ev, start, action, "timeline", tz);
    await supabase.from("audit_logs").insert({ user_id: user.id, actor: "user", action: `activity.${i.type}`, entity_type: "event", entity_id: ev.id, detail: { occurrence: start.toISOString(), to: to?.toISOString() ?? null } }).then(() => null, () => null);
    refresh();
    return { ok: true, message: out.message };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

const taskSchema = z.object({
  id: z.uuid(),
  type: z.enum(["complete", "skip", "reschedule", "delay", "note"]),
  reason: z.string().max(500).optional(),
  minutes: z.number().int().min(5).max(24 * 60).optional(),
  to: localTime.optional(),
  notes: z.string().max(2000).optional(),
  ack: z.boolean().optional(),
});

export async function taskAction(input: z.input<typeof taskSchema>): Promise<TimelineResult> {
  const parsed = taskSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const i = parsed.data;
  const { supabase, user, profile } = await requireUser();
  const tz = profile.timezone;
  const { data: t } = await supabase.from("tasks").select("*").eq("id", i.id).maybeSingle<Task>();
  if (!t) return { error: "That task no longer exists." };
  let patch: Record<string, unknown> = {};
  let message = "";
  if (i.type === "complete") {
    patch = { status: "done", completed_at: new Date().toISOString(), verification: "self_reported" };
    message = "Task done";
  } else if (i.type === "skip") {
    if (!i.reason?.trim()) return { error: "Add a short reason." };
    patch = { status: "missed", miss_reason: i.reason, completed_at: null, verification: "none" };
    message = "Recorded as not done";
  } else if (i.type === "note") {
    patch = { notes: i.notes ?? null };
    message = "Note saved";
  } else {
    const base = t.due_at ? new Date(t.due_at) : new Date();
    const to = i.type === "delay" ? new Date(base.getTime() + (i.minutes ?? 30) * 60_000) : i.to ? zonedToUtc(i.to.slice(0, 10), i.to.slice(11, 16), tz) : null;
    if (!to) return { error: "Choose the new time." };
    if (!i.ack) {
      const conflicts = await findConflicts(supabase, to, new Date(to.getTime() + 15 * 60_000), tz, null);
      if (conflicts.length) return { conflicts };
    }
    const newDay = localDateString(to, tz);
    patch = {
      due_at: to.toISOString(), scheduled_for: newDay,
      original_due_at: t.original_due_at ?? t.due_at, original_scheduled_for: t.original_scheduled_for ?? t.scheduled_for,
      postponed_count: newDay !== t.scheduled_for ? t.postponed_count + 1 : t.postponed_count,
    };
    message = `Moved to ${to.toLocaleString("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit" })}`;
  }
  const { data, error } = await supabase.from("tasks").update(patch).eq("id", t.id).select("*").single<Task>();
  if (error) return { error: error.message };
  await syncTaskReminders(supabase, user.id, data, tz);
  refresh();
  return { ok: true, message };
}

const comSchema = z.object({
  id: z.uuid(),
  type: z.enum(["complete", "skip", "excuse", "reschedule", "delay"]),
  reason: z.string().max(2000).optional(),
  minutes: z.number().int().min(5).max(24 * 60).optional(),
  to: localTime.optional(),
  ack: z.boolean().optional(),
});

export async function commitmentAction(input: z.input<typeof comSchema>): Promise<TimelineResult> {
  const parsed = comSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const i = parsed.data;
  const { supabase, user, profile } = await requireUser();
  const tz = profile.timezone;
  const { data: c } = await supabase.from("commitments").select("*").eq("id", i.id).maybeSingle<Commitment>();
  if (!c) return { error: "That commitment no longer exists." };
  let patch: Record<string, unknown> = {};
  let message = "";
  const deadline = c.original_promised_by ?? c.promised_by;
  if (i.type === "complete") {
    const late = deadline ? Date.parse(deadline) + 5 * 60_000 < Date.now() : false;
    patch = { status: late ? "kept_late" : "kept", resolved_at: new Date().toISOString(), verification: "self_reported" };
    message = late ? "Kept — after the original deadline" : "Kept";
  } else if (i.type === "skip") {
    if (!i.reason || i.reason.trim().split(/\s+/).length < 4) return { error: "Say what happened immediately before — a sentence is enough." };
    patch = { status: "broken", failure_context: i.reason, resolved_at: new Date().toISOString(), verification: "none" };
    message = "Recorded as not kept";
  } else if (i.type === "excuse") {
    if (!i.reason?.trim()) return { error: "Who released you from it, and why?" };
    patch = { status: "released", failure_context: i.reason, resolved_at: new Date().toISOString() };
    message = "Released by agreement";
  } else {
    const base = c.promised_by ? new Date(c.promised_by) : new Date();
    const to = i.type === "delay" ? new Date(base.getTime() + (i.minutes ?? 30) * 60_000) : i.to ? zonedToUtc(i.to.slice(0, 10), i.to.slice(11, 16), tz) : null;
    if (!to) return { error: "Choose the new time." };
    if (!i.ack) {
      const conflicts = await findConflicts(supabase, to, new Date(to.getTime() + 15 * 60_000), tz, null);
      if (conflicts.length) return { conflicts };
    }
    patch = { promised_by: to.toISOString(), original_promised_by: c.original_promised_by ?? c.promised_by, reschedule_count: (c.reschedule_count ?? 0) + 1 };
    message = `New time ${to.toLocaleString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" })} — the original deadline stays on record`;
  }
  const { data, error } = await supabase.from("commitments").update(patch).eq("id", c.id).select("*").single<Commitment>();
  if (error) return { error: error.message };
  await syncCommitmentReminders(supabase, user.id, data, tz);
  refresh();
  return { ok: true, message };
}

/** Conflict preview for drag-and-drop before anything is saved. */
export async function previewMove(input: { to: string; durationMinutes: number; ignoreEventId?: string | null; leadMinutes?: number }): Promise<{ conflicts: string[]; error?: string }> {
  const ok = localTime.safeParse(input.to);
  if (!ok.success) return { conflicts: [], error: "Bad time" };
  const { supabase, profile } = await requireUser();
  const to = zonedToUtc(input.to.slice(0, 10), input.to.slice(11, 16), profile.timezone);
  const conflicts = await findConflicts(supabase, to, new Date(to.getTime() + Math.max(5, input.durationMinutes) * 60_000), profile.timezone, input.ignoreEventId ?? null, input.leadMinutes ?? 0);
  return { conflicts };
}

/** Confirm a prayer from the timeline (never auto-marked missed). */
export async function confirmPrayerTimeline(prayer: string, date: string): Promise<TimelineResult> {
  const { supabase, user } = await requireUser();
  if (!["fajr", "dhuhr", "asr", "maghrib", "isha"].includes(prayer) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Unknown prayer" };
  const { error } = await supabase.from("prayer_confirmations").upsert({ user_id: user.id, prayer_date: date, prayer, status: "prayed", source: "app" }, { onConflict: "user_id,prayer_date,prayer" });
  if (error) return { error: error.message };
  await supabase.from("reminders").update({ status: "cancelled" }).eq("entity_type", "prayer").like("dedupe_key", `prayer:${date}:${prayer}:%`).eq("status", "scheduled");
  revalidatePath("/today");
  revalidatePath("/faith");
  return { ok: true, message: "Prayer confirmed" };
}
