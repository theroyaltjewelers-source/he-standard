"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { buildCheckinRows } from "@/lib/reminders";
import { CATEGORIES } from "@/lib/reminder-policy";

const s = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
export type PrefState = { error?: string; ok?: boolean } | undefined;

const schema = z.object({
  theme: z.enum(["dark", "light", "system"]),
  reminder_intensity: z.enum(["gentle", "balanced", "firm", "custom"]),
  custom_follow_up_minutes: z.array(z.number().int().min(5).max(720)).max(5),
  voice_replies: z.boolean(), haptics: z.boolean(), sounds: z.boolean(),
  midday_checkin_time: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  weekly_report_day: z.number().int().min(0).max(6),
});

export async function savePreferences(_: PrefState, form: FormData): Promise<PrefState> {
  const { supabase, user, profile } = await requireUser();
  const custom = s(form, "custom_follow_up_minutes").split(/[,\s]+/).filter(Boolean).map(Number).filter((n) => Number.isFinite(n));
  const parsed = schema.safeParse({
    theme: s(form, "theme") || "dark", reminder_intensity: s(form, "reminder_intensity") || "balanced",
    custom_follow_up_minutes: [...new Set(custom)].sort((a, b) => a - b),
    voice_replies: form.get("voice_replies") === "on", haptics: form.get("haptics") === "on", sounds: form.get("sounds") === "on",
    midday_checkin_time: form.get("midday_enabled") === "on" ? s(form, "midday_checkin_time") || "13:00" : null,
    weekly_report_day: Number(s(form, "weekly_report_day") || 0),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].path.join(".") === "custom_follow_up_minutes" ? "Custom follow-ups: up to five values between 5 and 720 minutes." : parsed.error.issues[0].message };
  if (parsed.data.reminder_intensity === "custom" && parsed.data.custom_follow_up_minutes.length === 0) return { error: "Add at least one custom follow-up time, or choose another intensity." };
  const categories = Object.fromEntries(CATEGORIES.map((c) => [c.key, { enabled: form.get(`cat_${c.key}`) === "on", quiet_override: form.get(`quiet_${c.key}`) === "on" }]));
  const { error } = await supabase.from("user_preferences").upsert({ user_id: user.id, ...parsed.data, categories }, { onConflict: "user_id" });
  if (error) return { error: error.message };

  const jar = await cookies();
  const year = 60 * 60 * 24 * 365;
  jar.set("theme", parsed.data.theme, { path: "/", maxAge: year, sameSite: "lax" });
  jar.set("haptics", parsed.data.haptics ? "on" : "off", { path: "/", maxAge: year, sameSite: "lax" });

  // Midday time may have changed: rebuild upcoming check-in reminders.
  await supabase.from("reminders").delete().eq("entity_type", "checkin").eq("status", "scheduled");
  const rows = buildCheckinRows({ ...profile, midday_checkin_time: parsed.data.midday_checkin_time });
  if (rows.length) await supabase.from("reminders").upsert(rows, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true });

  revalidatePath("/", "layout");
  return { ok: true };
}
