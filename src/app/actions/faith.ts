"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { requireUser } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { regeneratePrayerReminders, savePrayerSchedule, type PrayerSettingsRow } from "@/lib/reminders";
import { distanceKm, PRAYERS, RELOCATE_THRESHOLD_KM, METHODS } from "@/lib/prayer";
import { isValidTimeZone } from "@/lib/time";
import { env } from "@/lib/env";

const s = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
const refresh = () => { revalidatePath("/faith"); revalidatePath("/today"); };

export async function confirmPrayer(form: FormData) {
  const { supabase, user, today } = await requireUser();
  const prayer = z.enum(PRAYERS).parse(s(form, "prayer"));
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(s(form, "date"));
  const status = s(form, "status") === "prayed_late" ? "prayed_late" : s(form, "status") === "qada" ? "qada" : "prayed";
  await supabase.from("prayer_confirmations").upsert({
    user_id: user.id, prayer_date: date, prayer, status, source: "app", retrospective: date < today,
    in_congregation: form.get("jamaah") === "on" ? true : null, reflection: s(form, "reflection") || null,
  }, { onConflict: "user_id,prayer_date,prayer" });
  await supabase.from("reminders").update({ status: "cancelled" }).eq("entity_type", "prayer").like("dedupe_key", `prayer:${date}:${prayer}:%`).eq("status", "scheduled");
  refresh();
}

export async function unconfirmPrayer(form: FormData) {
  const { supabase } = await requireUser();
  await supabase.from("prayer_confirmations").delete().eq("prayer_date", s(form, "date")).eq("prayer", s(form, "prayer"));
  refresh();
}

async function applySettingsChange(settings: PrayerSettingsRow, tz: string, today: string) {
  const { supabase } = await requireUser();
  await regeneratePrayerReminders(supabase, settings, tz);
  await savePrayerSchedule(supabase, settings, tz, today);
}

export type LocState = { error?: string; ok?: string; moved?: boolean } | undefined;

/**
 * Save a location (from the device or a chosen city). Recalculates the
 * schedule and replaces future prayer reminders (old ones are deleted first,
 * so there are never duplicates). Updates the profile time zone when travel
 * crosses zones.
 */
export async function setPrayerLocation(input: { latitude: number; longitude: number; label?: string | null; source: "device" | "manual"; timeZone?: string | null; onlyIfMoved?: boolean }): Promise<LocState> {
  const { supabase, user, profile, today } = await requireUser();
  const parsed = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }).safeParse(input);
  if (!parsed.success) return { error: "That location isn't valid." };
  const { data: current } = await supabase.from("prayer_settings").select("*").maybeSingle<PrayerSettingsRow & { location_source: string | null }>();
  if (!current) return { error: "Prayer settings missing." };
  const moved = current.latitude == null || current.longitude == null
    ? true
    : distanceKm({ lat: current.latitude, lon: current.longitude }, { lat: input.latitude, lon: input.longitude }) >= RELOCATE_THRESHOLD_KM;
  if (input.onlyIfMoved && !moved) return { ok: "Location unchanged.", moved: false };

  let tz = profile.timezone;
  if (input.timeZone && isValidTimeZone(input.timeZone) && input.timeZone !== profile.timezone) {
    tz = input.timeZone;
    await supabase.from("profiles").update({ timezone: tz }).eq("id", user.id);
  }
  const label = input.label || (input.source === "device" ? `Near ${input.latitude.toFixed(2)}, ${input.longitude.toFixed(2)}` : null);
  const { data: updated, error } = await supabase.from("prayer_settings").update({
    latitude: Math.round(input.latitude * 1e4) / 1e4, longitude: Math.round(input.longitude * 1e4) / 1e4, // ~11 m precision is plenty
    location_label: label, location_source: input.source, location_updated_at: new Date().toISOString(),
  }).eq("user_id", user.id).select("*").single<PrayerSettingsRow>();
  if (error) return { error: error.message };
  await applySettingsChange(updated, tz, today);
  await createAdminClient().from("audit_logs").insert({ user_id: user.id, actor: "user", action: "prayer.location_changed", detail: { source: input.source, label, timezone: tz } });
  refresh();
  return { ok: `Prayer times now calculated for ${label ?? "your location"}${tz !== profile.timezone ? ` (time zone ${tz})` : ""}.`, moved: true };
}

export async function searchCity(query: string): Promise<{ name: string; detail: string; latitude: number; longitude: number; timezone: string }[]> {
  await requireUser();
  const q = query.trim().slice(0, 80);
  if (q.length < 2) return [];
  try {
    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`, { signal: AbortSignal.timeout(8000) });
    const j = await res.json();
    return (j.results ?? []).map((r: { name: string; admin1?: string; country?: string; latitude: number; longitude: number; timezone: string }) => ({
      name: r.name, detail: [r.admin1, r.country].filter(Boolean).join(", "), latitude: r.latitude, longitude: r.longitude, timezone: r.timezone,
    }));
  } catch {
    return [];
  }
}

const settingsSchema = z.object({
  method: z.enum(METHODS.map((m) => m.key) as [string, ...string[]]),
  madhab: z.enum(["shafi", "hanafi"]),
  high_latitude_rule: z.enum(["recommended", "MiddleOfTheNight", "SeventhOfTheNight", "TwilightAngle"]),
  remind_before_minutes: z.coerce.number().int().min(0).max(60),
  follow_up_minutes: z.coerce.number().int().min(0).max(180),
  reminders_enabled: z.boolean(), pre_next_reminder: z.boolean(), notify_during_quiet: z.boolean(), auto_location: z.boolean(),
  mosque_note: z.string().max(200),
});

export type SettingsState = { error?: string; ok?: boolean } | undefined;

export async function savePrayerSettings(_: SettingsState, form: FormData): Promise<SettingsState> {
  const { supabase, user, profile, today } = await requireUser();
  const parsed = settingsSchema.safeParse({
    method: s(form, "method"), madhab: s(form, "madhab"), high_latitude_rule: s(form, "high_latitude_rule"),
    remind_before_minutes: s(form, "remind_before_minutes") || 0, follow_up_minutes: s(form, "follow_up_minutes") || 0,
    reminders_enabled: form.get("reminders_enabled") === "on", pre_next_reminder: form.get("pre_next_reminder") === "on",
    notify_during_quiet: form.get("notify_during_quiet") === "on", auto_location: form.get("auto_location") === "on", mosque_note: s(form, "mosque_note"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const offsets = Object.fromEntries(PRAYERS.map((p) => [p, Math.max(-30, Math.min(30, Number(s(form, `offset_${p}`) || 0)))]));
  const { data, error } = await supabase.from("prayer_settings").update({ ...parsed.data, mosque_note: parsed.data.mosque_note || null, offsets }).eq("user_id", user.id).select("*").single<PrayerSettingsRow>();
  if (error) return { error: error.message };
  await applySettingsChange(data, profile.timezone, today);
  refresh();
  return { ok: true };
}

export async function logSpiritual(form: FormData) {
  const { supabase, user, today } = await requireUser();
  const kind = z.enum(["quran", "dhikr", "sunnah", "witr", "fast", "dua", "other"]).parse(s(form, "kind"));
  const amount = s(form, "amount") ? Math.max(0, Math.min(1000, Number(s(form, "amount")))) : null;
  const unit = { quran: "minutes", dhikr: "minutes", sunnah: "rak'ahs", witr: "rak'ahs", fast: null, dua: null, other: null }[kind];
  await supabase.from("spiritual_logs").insert({ user_id: user.id, log_date: s(form, "date") || today, kind, amount, unit, note: s(form, "note") || null });
  refresh();
}

export async function deleteSpiritual(form: FormData) {
  const { supabase } = await requireUser();
  await supabase.from("spiritual_logs").delete().eq("id", s(form, "id"));
  refresh();
}

/** Optional AI reflection on a stored verse. Stored separately and always labelled as commentary. */
export async function reflectOnVerse(form: FormData) {
  const { supabase, user, profile } = await requireUser();
  const key = env.anthropicKey();
  if (!key || !profile.ai_analysis_consent) return;
  const { data: v } = await supabase.from("quran_verses").select("*").eq("id", s(form, "verse_id")).single();
  if (!v) return;
  const client = new Anthropic({ apiKey: key, timeout: 30_000 });
  const res = await client.messages.create({
    model: env.anthropicModel(), max_tokens: 300,
    system: "Write a short personal reflection (<= 90 words) connecting the given verse translation to everyday discipline, honesty, patience or self-control. Do not quote any other verse or hadith. Do not issue religious rulings or tafsir claims. Speak as a thoughtful companion, not a scholar. Plain text.",
    messages: [{ role: "user", content: `Verse ${v.surah}:${v.ayah} (${v.translator}): ${v.translation}` }],
  });
  const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("").trim();
  if (text) await supabase.from("verse_reflections").insert({ user_id: user.id, verse_id: v.id, reflection: text, model: env.anthropicModel() });
  refresh();
}
