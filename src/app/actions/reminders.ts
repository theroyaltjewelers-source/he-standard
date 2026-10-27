"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { zonedToUtc } from "@/lib/time";

export type ReminderState = { error?: string; ok?: boolean } | undefined;
const s = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");

export async function createCustomReminder(_: ReminderState, form: FormData): Promise<ReminderState> {
  const { supabase, user, profile } = await requireUser();
  const title = s(form, "title");
  const date = s(form, "date");
  const time = s(form, "time");
  if (!title) return { error: "What should the reminder say?" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return { error: "Set a date and time." };
  const at = zonedToUtc(date, time, profile.timezone);
  if (at.getTime() < Date.now() + 30_000) return { error: "Choose a time in the future." };
  const { error } = await supabase.from("reminders").insert({
    user_id: user.id, entity_type: "custom", title, body: s(form, "body") || null, url: "/today",
    send_at: at.toISOString(), respect_quiet_hours: form.get("respect_quiet") === "on",
  });
  if (error) return { error: error.message };
  revalidatePath("/reminders");
  return { ok: true };
}

export async function cancelReminder(form: FormData) {
  const { supabase } = await requireUser();
  await supabase.from("reminders").update({ status: "cancelled" }).eq("id", s(form, "id")).eq("status", "scheduled");
  revalidatePath("/reminders");
}

export async function removeDevice(form: FormData) {
  const { supabase } = await requireUser();
  await supabase.from("push_subscriptions").delete().eq("id", s(form, "id"));
  revalidatePath("/reminders");
}
