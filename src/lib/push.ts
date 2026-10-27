import "server-only";
import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";
import type { Profile, Reminder } from "./types";
import { inQuietHours, quietHoursEnd } from "./scheduling";
import { localDateString } from "./time";

let configured = false;
function configure() {
  if (configured) return;
  webpush.setVapidDetails(env.vapidSubject(), env.vapidPublicKey(), env.vapidPrivateKey());
  configured = true;
}

interface Sub {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  failure_count: number;
}

export interface SendResult {
  subscriptions: number;
  accepted: number;
  failed: number;
  errors: string[];
}

/**
 * Sends one push message to every registered device of a user and records the
 * push service's response per device in `notifications`. "accepted" means the
 * push service (Apple/Google/Mozilla) returned 201 — that is the strongest
 * delivery guarantee available server-side. "displayed" is recorded later only
 * if the device's service worker reports back.
 */
export async function sendPushToUser(
  admin: SupabaseClient,
  userId: string,
  msg: { title: string; body?: string | null; url?: string; reminderId?: string | null },
): Promise<SendResult> {
  configure();
  const { data: subs, error } = await admin
    .from("push_subscriptions")
    .select("id,endpoint,p256dh,auth,failure_count")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  const result: SendResult = { subscriptions: subs?.length ?? 0, accepted: 0, failed: 0, errors: [] };

  for (const s of (subs ?? []) as Sub[]) {
    const { data: n, error: nErr } = await admin
      .from("notifications")
      .insert({ user_id: userId, reminder_id: msg.reminderId ?? null, subscription_id: s.id, title: msg.title, body: msg.body ?? null, status: "pending" })
      .select("id")
      .single();
    if (nErr || !n) {
      result.failed++;
      result.errors.push(`log: ${nErr?.message}`);
      continue;
    }
    const payload = JSON.stringify({ id: n.id, title: msg.title, body: msg.body ?? "", url: msg.url ?? "/today", tag: msg.reminderId ?? n.id });
    try {
      const res = await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
        TTL: 60 * 60 * 4,
        urgency: "high",
      });
      result.accepted++;
      // Only promote pending→accepted; the device may already have reported "displayed".
      await admin.from("notifications").update({ status: "accepted", push_service_status: res.statusCode }).eq("id", n.id).eq("status", "pending");
      await admin.from("push_subscriptions").update({ last_success_at: new Date().toISOString(), failure_count: 0 }).eq("id", s.id);
    } catch (e: unknown) {
      const err = e as { statusCode?: number; body?: string; message?: string };
      const code = err.statusCode ?? null;
      const text = `${code ?? "network"}: ${(err.body || err.message || "unknown error").slice(0, 300)}`;
      result.failed++;
      result.errors.push(text);
      await admin.from("notifications").update({ status: "failed", push_service_status: code, error: text }).eq("id", n.id);
      if (code === 404 || code === 410) {
        // The device unsubscribed or the subscription expired.
        await admin.from("push_subscriptions").delete().eq("id", s.id);
      } else {
        await admin.from("push_subscriptions").update({ failure_count: s.failure_count + 1 }).eq("id", s.id);
      }
    }
  }
  return result;
}

type ProfileLite = Pick<Profile, "id" | "timezone" | "quiet_hours_start" | "quiet_hours_end">;

/** Is the thing this reminder is about still relevant? Avoids nagging about finished work. */
async function stillRelevant(admin: SupabaseClient, r: Reminder, tz: string): Promise<boolean> {
  if (!r.entity_id && r.entity_type !== "checkin") return true;
  if (r.entity_type === "task") {
    const { data } = await admin.from("tasks").select("status").eq("id", r.entity_id!).maybeSingle();
    return data?.status === "pending";
  }
  if (r.entity_type === "commitment") {
    const { data } = await admin.from("commitments").select("status").eq("id", r.entity_id!).maybeSingle();
    return data?.status === "open";
  }
  if (r.entity_type === "event") {
    const { data } = await admin.from("events").select("id").eq("id", r.entity_id!).maybeSingle();
    return !!data;
  }
  if (r.entity_type === "checkin" && r.dedupe_key) {
    const [, kind, day] = r.dedupe_key.split(":");
    const { data } = await admin
      .from("accountability_sessions")
      .select("status")
      .eq("user_id", r.user_id)
      .eq("kind", kind)
      .eq("session_date", day ?? localDateString(new Date(r.send_at), tz))
      .maybeSingle();
    return data?.status !== "completed";
  }
  return true;
}

export interface DispatchSummary {
  claimed: number;
  sent: number;
  partial: number;
  failed: number;
  retried: number;
  deferred: number;
  skipped: number;
  noDevice: number;
  released: number;
}

export async function dispatchDueReminders(admin: SupabaseClient, limit = 100): Promise<DispatchSummary> {
  const summary: DispatchSummary = { claimed: 0, sent: 0, partial: 0, failed: 0, retried: 0, deferred: 0, skipped: 0, noDevice: 0, released: 0 };
  const { data: released } = await admin.rpc("release_stuck_reminders");
  summary.released = Number(released ?? 0);

  const { data: claimed, error } = await admin.rpc("claim_due_reminders", { p_limit: limit });
  if (error) throw new Error(`claim_due_reminders: ${error.message}`);
  const reminders = (claimed ?? []) as Reminder[];
  summary.claimed = reminders.length;
  if (!reminders.length) return summary;

  const userIds = Array.from(new Set(reminders.map((r) => r.user_id)));
  const { data: profiles } = await admin.from("profiles").select("id,timezone,quiet_hours_start,quiet_hours_end").in("id", userIds);
  const byId = new Map((profiles ?? []).map((p: ProfileLite) => [p.id, p]));
  const now = new Date();

  for (const r of reminders) {
    const p = byId.get(r.user_id);
    const tz = p?.timezone ?? "UTC";
    const done = (patch: Partial<Reminder>) => admin.from("reminders").update(patch).eq("id", r.id);

    if (!(await stillRelevant(admin, r, tz))) {
      await done({ status: "cancelled", last_error: "no longer relevant" });
      summary.skipped++;
      continue;
    }
    // Missed by more than 6 hours (e.g. scheduler was down): don't send stale nudges.
    if (now.getTime() - new Date(r.send_at).getTime() > 6 * 3600_000) {
      await done({ status: "cancelled", last_error: "too late to be useful" });
      summary.skipped++;
      continue;
    }
    if (r.respect_quiet_hours && p && p.quiet_hours_start && p.quiet_hours_end && inQuietHours(now, p.quiet_hours_start, p.quiet_hours_end, tz)) {
      await done({ status: "scheduled", send_at: quietHoursEnd(now, p.quiet_hours_end, tz).toISOString(), attempts: Math.max(0, r.attempts - 1) });
      summary.deferred++;
      continue;
    }

    let res: SendResult;
    try {
      res = await sendPushToUser(admin, r.user_id, { title: r.title, body: r.body, url: r.url, reminderId: r.id });
    } catch (e) {
      res = { subscriptions: 1, accepted: 0, failed: 1, errors: [(e as Error).message] };
    }

    if (res.subscriptions === 0) {
      await done({ status: "no_device", last_error: "No device has notifications enabled." });
      summary.noDevice++;
    } else if (res.accepted === res.subscriptions) {
      await done({ status: "sent", last_error: null });
      summary.sent++;
    } else if (res.accepted > 0) {
      await done({ status: "partial", last_error: res.errors.join(" | ").slice(0, 500) });
      summary.partial++;
    } else if (r.attempts < 3) {
      await done({ status: "scheduled", send_at: new Date(now.getTime() + 2 * 60_000 * r.attempts).toISOString(), last_error: res.errors.join(" | ").slice(0, 500) });
      summary.retried++;
    } else {
      await done({ status: "failed", last_error: res.errors.join(" | ").slice(0, 500) });
      summary.failed++;
    }
  }
  return summary;
}
