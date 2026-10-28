import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncCommitmentReminders, syncTaskReminders } from "@/lib/reminders";
import { SNOOZE_MINUTES } from "@/lib/reminder-policy";
import { parseLifecycleKey } from "@/lib/lifecycle";
import { applyOccurrenceAction, isOccurrenceOf } from "@/lib/occurrences";
import type { CalendarEvent, Commitment, Profile, Reminder, Task } from "@/lib/types";

/**
 * Notification action buttons. Called by the service worker with the user's
 * session cookie; ownership is enforced by RLS on the reminder lookup.
 *
 * Every action carries an idempotency key (notification id + action): a
 * retried request returns the stored result instead of acting twice.
 * Actions that need more input (skip with a reason, reschedule) return a URL
 * for the service worker to open.
 */
const ACTIONS = ["done", "prayed", "snooze", "open", "start", "completed", "late", "remind", "skip", "reschedule"] as const;
const body = z.object({
  notification_id: z.uuid().optional(),
  reminder_id: z.uuid(),
  action: z.enum(ACTIONS),
  idempotency_key: z.string().min(8).max(200).optional(),
});

export async function POST(req: Request) {
  const db = await createClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const { reminder_id, action, notification_id } = parsed.data;
  const key = parsed.data.idempotency_key ?? (notification_id ? `${notification_id}:${action}` : null);
  const admin = createAdminClient();

  // Idempotency: claim the key first; a duplicate returns the original result.
  if (key) {
    const { error: claimErr } = await admin.from("notification_action_log").insert({ idempotency_key: key, user_id: auth.user.id, reminder_id, action, result: { pending: true } });
    if (claimErr) {
      const { data: prior } = await admin.from("notification_action_log").select("result,user_id").eq("idempotency_key", key).maybeSingle();
      if (prior && prior.user_id === auth.user.id) return NextResponse.json({ ok: true, duplicate: true, ...(prior.result as object) });
      return NextResponse.json({ error: "conflict" }, { status: 409 });
    }
  }

  const finish = async (res: { result: string; open?: string }, status = 200) => {
    if (key) await admin.from("notification_action_log").update({ result: res }).eq("idempotency_key", key);
    if (notification_id) await admin.from("notifications").update({ action, action_at: new Date().toISOString() }).eq("id", notification_id).eq("user_id", auth.user!.id);
    await admin.from("audit_logs").insert({ user_id: auth.user!.id, actor: "user", action: `notification.${action}`, entity_type: r?.entity_type ?? null, entity_id: r?.entity_id ?? null, detail: { reminder_id, ...res } });
    return NextResponse.json({ ok: status < 400, ...res }, { status });
  };

  const { data: r } = await db.from("reminders").select("*").eq("id", reminder_id).maybeSingle<Reminder>();
  if (!r) {
    if (key) await admin.from("notification_action_log").delete().eq("idempotency_key", key);
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const { data: profile } = await db.from("profiles").select("timezone").eq("id", auth.user.id).single<Pick<Profile, "timezone">>();
  const tz = profile?.timezone ?? "UTC";

  try {
    // Lifecycle actions for scheduled activities
    const life = parseLifecycleKey(r.dedupe_key);
    if (r.entity_type === "event" && r.entity_id && ["start", "completed", "late", "skip", "reschedule"].includes(action)) {
      const { data: ev } = await db.from("events").select("*").eq("id", r.entity_id).maybeSingle<CalendarEvent>();
      if (!ev) return finish({ result: "activity no longer exists" });
      const occStart = life ? new Date(life.occurrence) : new Date(ev.starts_at);
      if (!isOccurrenceOf(ev, occStart, tz)) return finish({ result: "occurrence not found" }, 404);
      const date = occStart.toLocaleDateString("en-CA", { timeZone: tz });
      if (action === "skip" || action === "reschedule") {
        return finish({ result: "needs input", open: `/today?date=${date}&occ=${ev.id}.${occStart.getTime()}&do=${action}#occ-${ev.id}` });
      }
      const type = action === "start" ? "start" : action === "completed" ? "complete" : "late";
      const out = await applyOccurrenceAction(db, auth.user.id, ev, occStart, { type } as never, "notification", tz);
      return finish({ result: out.message });
    }

    if ((action === "done" || action === "completed") && r.entity_id && r.entity_type === "task") {
      const { data } = await db.from("tasks").update({ status: "done", completed_at: new Date().toISOString(), verification: "self_reported" }).eq("id", r.entity_id).eq("status", "pending").select("*").maybeSingle<Task>();
      if (data) await syncTaskReminders(db, auth.user.id, data, tz);
      return finish({ result: data ? "task done" : "task was not open" });
    }
    if ((action === "done" || action === "completed") && r.entity_id && r.entity_type === "commitment") {
      const { data: c } = await db.from("commitments").select("promised_by,original_promised_by").eq("id", r.entity_id).maybeSingle();
      const deadline = c?.original_promised_by ?? c?.promised_by;
      const late = deadline ? Date.parse(deadline) < Date.now() : false;
      const { data } = await db.from("commitments").update({ status: late ? "kept_late" : "kept", resolved_at: new Date().toISOString(), verification: "self_reported" }).eq("id", r.entity_id).eq("status", "open").select("*").maybeSingle<Commitment>();
      if (data) await syncCommitmentReminders(db, auth.user.id, data, tz);
      return finish({ result: data ? (late ? "commitment kept late" : "commitment kept") : "commitment was not open" });
    }
    if (action === "prayed" && r.entity_type === "prayer" && r.dedupe_key) {
      const [, day, prayer] = r.dedupe_key.split(":");
      await db.from("prayer_confirmations").upsert({ user_id: auth.user.id, prayer_date: day, prayer, status: "prayed", source: "notification" }, { onConflict: "user_id,prayer_date,prayer" });
      await db.from("reminders").update({ status: "cancelled" }).eq("entity_type", "prayer").like("dedupe_key", `prayer:${day}:${prayer}:%`).eq("status", "scheduled");
      return finish({ result: `${prayer} confirmed` });
    }
    if (action === "snooze" || action === "remind") {
      await db.from("reminders").insert({
        user_id: auth.user.id, entity_type: r.entity_type, entity_id: r.entity_id, category: r.category, title: r.title, body: r.body, url: r.url,
        send_at: new Date(Date.now() + SNOOZE_MINUTES * 60_000).toISOString(), respect_quiet_hours: false, actions: r.actions, snoozed_from: r.id, priority: r.priority ?? 2,
        dedupe_key: r.dedupe_key ? `${r.dedupe_key}:snooze:${Date.now()}` : null,
      });
      return finish({ result: `snoozed ${SNOOZE_MINUTES} min` });
    }
    return finish({ result: "opened", open: r.url });
  } catch (e) {
    if (key) await admin.from("notification_action_log").delete().eq("idempotency_key", key); // allow a retry
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
