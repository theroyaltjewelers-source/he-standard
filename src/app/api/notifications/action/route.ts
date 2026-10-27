import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncCommitmentReminders, syncTaskReminders } from "@/lib/reminders";
import { SNOOZE_MINUTES } from "@/lib/reminder-policy";
import type { Commitment, Profile, Reminder, Task } from "@/lib/types";

/**
 * Handles notification action buttons (Done, Prayed, Snooze). Called by the
 * service worker with the user's session cookie; ownership is enforced by RLS
 * on the reminder lookup.
 */
const body = z.object({ notification_id: z.uuid().optional(), reminder_id: z.uuid(), action: z.enum(["done", "prayed", "snooze", "open"]) });

export async function POST(req: Request) {
  const db = await createClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const { reminder_id, action, notification_id } = parsed.data;

  const { data: r } = await db.from("reminders").select("*").eq("id", reminder_id).maybeSingle<Reminder>();
  if (!r) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { data: profile } = await db.from("profiles").select("timezone").eq("id", auth.user.id).single<Pick<Profile, "timezone">>();
  const tz = profile?.timezone ?? "UTC";
  const admin = createAdminClient();
  let result = "ok";

  if (action === "done" && r.entity_id && r.entity_type === "task") {
    const { data } = await db.from("tasks").update({ status: "done", completed_at: new Date().toISOString(), verification: "self_reported" }).eq("id", r.entity_id).eq("status", "pending").select("*").maybeSingle<Task>();
    if (data) await syncTaskReminders(db, auth.user.id, data, tz);
    result = data ? "task done" : "task was not open";
  } else if (action === "done" && r.entity_id && r.entity_type === "commitment") {
    const { data: c } = await db.from("commitments").select("promised_by").eq("id", r.entity_id).maybeSingle();
    const late = c?.promised_by ? Date.parse(c.promised_by) < Date.now() : false;
    const { data } = await db.from("commitments").update({ status: late ? "kept_late" : "kept", resolved_at: new Date().toISOString(), verification: "self_reported" }).eq("id", r.entity_id).eq("status", "open").select("*").maybeSingle<Commitment>();
    if (data) await syncCommitmentReminders(db, auth.user.id, data, tz);
    result = data ? "commitment kept" : "commitment was not open";
  } else if (action === "prayed" && r.entity_type === "prayer" && r.dedupe_key) {
    const [, day, prayer] = r.dedupe_key.split(":");
    await db.from("prayer_confirmations").upsert({ user_id: auth.user.id, prayer_date: day, prayer, status: "prayed", source: "notification" }, { onConflict: "user_id,prayer_date,prayer" });
    await db.from("reminders").update({ status: "cancelled" }).eq("entity_type", "prayer").like("dedupe_key", `prayer:${day}:${prayer}:%`).eq("status", "scheduled");
    result = `${prayer} confirmed`;
  } else if (action === "snooze") {
    await db.from("reminders").insert({
      user_id: auth.user.id, entity_type: r.entity_type, entity_id: r.entity_id, category: r.category, title: r.title, body: r.body, url: r.url,
      send_at: new Date(Date.now() + SNOOZE_MINUTES * 60_000).toISOString(), respect_quiet_hours: false, actions: r.actions, snoozed_from: r.id,
      dedupe_key: r.entity_type === "prayer" && r.dedupe_key ? `${r.dedupe_key}:snooze:${Date.now()}` : null,
    });
    result = `snoozed ${SNOOZE_MINUTES} min`;
  }
  if (notification_id) await admin.from("notifications").update({ action, action_at: new Date().toISOString() }).eq("id", notification_id).eq("user_id", auth.user.id);
  await admin.from("audit_logs").insert({ user_id: auth.user.id, actor: "user", action: `notification.${action}`, entity_type: r.entity_type, entity_id: r.entity_id, detail: { reminder_id, result } });
  return NextResponse.json({ ok: true, result });
}
