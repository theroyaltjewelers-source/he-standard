"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { cancelFutureReminders, syncEventReminders } from "@/lib/reminders";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteRemote, isConnected, pushEvent } from "@/lib/google";
import { zonedToUtc } from "@/lib/time";
import type { CalendarEvent } from "@/lib/types";

export type EventState = { error?: string } | undefined;

const schema = z.object({
  id: z.uuid().or(z.literal("")),
  title: z.string().min(1, "Give the appointment a name.").max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."),
  time: z.string().regex(/^\d{2}:\d{2}$/).or(z.literal("")),
  duration: z.coerce.number().int().min(0).max(24 * 60),
  all_day: z.boolean(),
  location: z.string().max(300),
  notes: z.string().max(4000),
  importance: z.enum(["normal", "high"]),
  prep_minutes: z.coerce.number().int().min(0).max(600),
  travel_minutes: z.coerce.number().int().min(0).max(600),
  offsets: z.array(z.coerce.number().int().min(1).max(10080)).max(6),
  recurrence: z.enum(["none", "daily", "weekly", "monthly"]),
  recurrence_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")),
  confirm_plan: z.boolean(),
});

const s = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");

export async function saveEvent(_: EventState, form: FormData): Promise<EventState> {
  const { supabase, user, profile } = await requireUser();
  const parsed = schema.safeParse({
    id: s(form, "id"), title: s(form, "title"), date: s(form, "date"), time: s(form, "time"),
    duration: s(form, "duration") || 60, all_day: form.get("all_day") === "on", location: s(form, "location"),
    notes: s(form, "notes"), importance: s(form, "importance") || "normal", prep_minutes: s(form, "prep_minutes") || 0,
    travel_minutes: s(form, "travel_minutes") || 0, offsets: form.getAll("offsets"), recurrence: s(form, "recurrence") || "none",
    recurrence_until: s(form, "recurrence_until"), confirm_plan: form.get("confirm_plan") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  if (!d.all_day && !d.time) return { error: "Set a start time, or mark it all day." };

  const starts = zonedToUtc(d.date, d.all_day ? "00:00" : d.time, profile.timezone);
  const ends = d.all_day ? null : new Date(starts.getTime() + d.duration * 60_000);
  const row = {
    user_id: user.id, title: d.title, location: d.location || null, notes: d.notes || null,
    starts_at: starts.toISOString(), ends_at: ends?.toISOString() ?? null, all_day: d.all_day,
    importance: d.importance, prep_minutes: d.all_day ? 0 : d.prep_minutes, travel_minutes: d.all_day ? 0 : d.travel_minutes,
    reminder_offsets: d.all_day ? [] : d.offsets, recurrence: d.recurrence,
    recurrence_until: d.recurrence !== "none" && d.recurrence_until ? d.recurrence_until : null,
    plan_confirmed_at: d.confirm_plan ? new Date().toISOString() : null,
    ...(d.id ? { sync_status: "pending_push" } : {}),
  };
  const q = d.id
    ? supabase.from("events").update(row).eq("id", d.id).select("*").single<CalendarEvent>()
    : supabase.from("events").insert(row).select("*").single<CalendarEvent>();
  const { data, error } = await q;
  if (error) return { error: error.message };
  await syncEventReminders(supabase, user.id, data, profile.timezone);
  const admin = createAdminClient();
  let googleError: string | null = null;
  if (await isConnected(admin, user.id)) {
    try { await pushEvent(admin, user.id, data, profile.timezone); }
    catch (e) { googleError = (e as Error).message; }
  }
  await admin.from("audit_logs").insert({ user_id: user.id, actor: "user", action: d.id ? "event.updated" : "event.created", entity_type: "event", entity_id: data.id, detail: { title: data.title, google_error: googleError } });
  revalidatePath("/plan");
  revalidatePath("/today");
  redirect(`/plan?date=${d.date}${googleError ? `&gerror=${encodeURIComponent(googleError.slice(0, 120))}` : ""}`);
}

export async function deleteEvent(form: FormData) {
  const { supabase } = await requireUser();
  const id = s(form, "id");
  const { data: ev } = await supabase.from("events").select("external_source,external_id,user_id").eq("id", id).maybeSingle();
  if (ev?.external_source === "google" && ev.external_id) {
    const admin = createAdminClient();
    if (await isConnected(admin, ev.user_id)) { try { await deleteRemote(admin, ev.user_id, ev.external_id); } catch { /* local delete continues */ } }
  }
  await cancelFutureReminders(supabase, "event", id);
  await supabase.from("events").delete().eq("id", id);
  revalidatePath("/plan");
  revalidatePath("/today");
  redirect("/plan");
}

export async function confirmEventPlan(form: FormData) {
  const { supabase } = await requireUser();
  await supabase.from("events").update({ plan_confirmed_at: new Date().toISOString() }).eq("id", s(form, "id"));
  revalidatePath("/plan");
  revalidatePath("/today");
}
