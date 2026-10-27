"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { isValidTimeZone } from "@/lib/time";
import { buildCheckinRows } from "@/lib/reminders";
import { FOCUS_AREAS, CHALLENGES } from "@/lib/types";

const time = z.string().regex(/^\d{2}:\d{2}$/);
const schema = z.object({
  display_name: z.string().trim().max(60).optional().default(""),
  timezone: z.string().refine(isValidTimeZone, "Choose a valid time zone."),
  morning_checkin_time: time,
  evening_checkin_time: time,
  quiet_hours_start: time.or(z.literal("")),
  quiet_hours_end: time.or(z.literal("")),
  focus_areas: z.array(z.enum(FOCUS_AREAS.map((f) => f.key) as [string, ...string[]])).default([]),
  challenges: z.array(z.enum(CHALLENGES as unknown as [string, ...string[]])).default([]),
  ai_analysis_consent: z.boolean(),
  hijri_adjustment_days: z.coerce.number().int().min(-2).max(2).default(0),
});

export type FormState = { error?: string; ok?: boolean } | undefined;

function read(form: FormData) {
  return schema.safeParse({
    display_name: form.get("display_name") ?? "",
    timezone: form.get("timezone"),
    morning_checkin_time: form.get("morning_checkin_time"),
    evening_checkin_time: form.get("evening_checkin_time"),
    quiet_hours_start: form.get("quiet_hours_start") ?? "",
    quiet_hours_end: form.get("quiet_hours_end") ?? "",
    focus_areas: form.getAll("focus_areas"),
    challenges: form.getAll("challenges"),
    ai_analysis_consent: form.get("ai_analysis_consent") === "on",
    hijri_adjustment_days: form.get("hijri_adjustment_days") ?? 0,
  });
}

async function save(form: FormData, completeOnboarding: boolean): Promise<FormState> {
  const { supabase, user, profile } = await requireUser({ allowIncomplete: true });
  const parsed = read(form);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  const consentChanged = d.ai_analysis_consent !== profile.ai_analysis_consent;
  const { error } = await supabase
    .from("profiles")
    .update({
      display_name: d.display_name || null,
      timezone: d.timezone,
      morning_checkin_time: d.morning_checkin_time,
      evening_checkin_time: d.evening_checkin_time,
      quiet_hours_start: d.quiet_hours_start || null,
      quiet_hours_end: d.quiet_hours_end || null,
      focus_areas: d.focus_areas,
      challenges: d.challenges,
      hijri_adjustment_days: d.hijri_adjustment_days,
      ai_analysis_consent: d.ai_analysis_consent,
      ...(consentChanged ? { ai_consent_updated_at: new Date().toISOString() } : {}),
      ...(completeOnboarding && !profile.onboarding_completed_at ? { onboarding_completed_at: new Date().toISOString() } : {}),
    })
    .eq("id", user.id);
  if (error) return { error: error.message };

  // Check-in times may have changed: rebuild the upcoming check-in reminders.
  await supabase.from("reminders").delete().eq("entity_type", "checkin").eq("status", "scheduled");
  const { data: prefs } = await supabase.from("user_preferences").select("midday_checkin_time").maybeSingle();
  const rows = buildCheckinRows({ id: user.id, timezone: d.timezone, morning_checkin_time: d.morning_checkin_time, evening_checkin_time: d.evening_checkin_time, midday_checkin_time: prefs?.midday_checkin_time ?? null });
  if (rows.length) await supabase.from("reminders").upsert(rows, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true });

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function completeOnboarding(_: FormState, form: FormData): Promise<FormState> {
  const r = await save(form, true);
  if (r?.error) return r;
  redirect("/today?welcome=1");
}

export async function updateSettings(_: FormState, form: FormData): Promise<FormState> {
  return save(form, false);
}
