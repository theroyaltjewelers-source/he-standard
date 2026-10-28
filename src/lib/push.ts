import "server-only";
import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";
import { getVapidKeys } from "./app-config";
import type { Reminder, UserPreferences } from "./types";
import { inQuietHours, quietHoursEnd } from "./scheduling";
import { dayBoundsUtc, localDateString } from "./time";
import { budgetDecision, categorySetting, nextFollowUp, pauseDecision, type Category, type Intensity } from "./reminder-policy";
import { lifecycleRelevant, parseLifecycleKey } from "./lifecycle";
import type { OccurrenceStatus } from "./types";

let configured = false;
async function configure() {
  if (configured) return;
  const k = await getVapidKeys();
  webpush.setVapidDetails(env.vapidSubject(), k.publicKey, k.privateKey);
  configured = true;
}

interface Sub { id: string; endpoint: string; p256dh: string; auth: string; failure_count: number }

export interface SendResult { subscriptions: number; accepted: number; failed: number; errors: string[] }

/**
 * Sends one push message to every registered device of a user and records the
 * push service's response per device in `notifications`. "accepted" means the
 * push service returned 201. "displayed" is recorded only if the device reports back.
 */
export async function sendPushToUser(
  admin: SupabaseClient,
  userId: string,
  msg: { title: string; body?: string | null; url?: string; reminderId?: string | null; actions?: { action: string; title: string }[]; category?: string },
): Promise<SendResult> {
  await configure();
  const { data: subs, error } = await admin.from("push_subscriptions").select("id,endpoint,p256dh,auth,failure_count").eq("user_id", userId);
  if (error) throw new Error(error.message);
  const result: SendResult = { subscriptions: subs?.length ?? 0, accepted: 0, failed: 0, errors: [] };

  for (const s of (subs ?? []) as Sub[]) {
    const { data: n, error: nErr } = await admin.from("notifications")
      .insert({ user_id: userId, reminder_id: msg.reminderId ?? null, subscription_id: s.id, title: msg.title, body: msg.body ?? null, status: "pending" })
      .select("id").single();
    if (nErr || !n) { result.failed++; result.errors.push(`log: ${nErr?.message}`); continue; }
    const payload = JSON.stringify({ id: n.id, reminder_id: msg.reminderId ?? null, title: msg.title, body: msg.body ?? "", url: msg.url ?? "/today", tag: msg.reminderId ?? n.id, actions: msg.actions ?? [], category: msg.category ?? null });
    try {
      const res = await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 60 * 60 * 4, urgency: "high" });
      result.accepted++;
      await admin.from("notifications").update({ status: "accepted", push_service_status: res.statusCode }).eq("id", n.id).eq("status", "pending");
      await admin.from("push_subscriptions").update({ last_success_at: new Date().toISOString(), failure_count: 0 }).eq("id", s.id);
    } catch (e: unknown) {
      const err = e as { statusCode?: number; body?: string; message?: string };
      const code = err.statusCode ?? null;
      const text = `${code ?? "network"}: ${(err.body || err.message || "unknown error").slice(0, 300)}`;
      result.failed++;
      result.errors.push(text);
      await admin.from("notifications").update({ status: "failed", push_service_status: code, error: text }).eq("id", n.id);
      if (code === 404 || code === 410) await admin.from("push_subscriptions").delete().eq("id", s.id);
      else await admin.from("push_subscriptions").update({ failure_count: s.failure_count + 1 }).eq("id", s.id);
    }
  }
  return result;
}

interface ProfileLite { id: string; timezone: string; quiet_hours_start: string | null; quiet_hours_end: string | null }

/** Is the thing this reminder is about still relevant? Avoids nagging about finished work. */
async function stillRelevant(admin: SupabaseClient, r: Reminder, tz: string): Promise<boolean> {
  const id = r.entity_id;
  switch (r.entity_type) {
    case "task": { if (!id) return true; const { data } = await admin.from("tasks").select("status").eq("id", id).maybeSingle(); return data?.status === "pending"; }
    case "commitment": { if (!id) return true; const { data } = await admin.from("commitments").select("status").eq("id", id).maybeSingle(); return data?.status === "open"; }
    case "event": {
      if (!id) return true;
      const { data } = await admin.from("events").select("id").eq("id", id).maybeSingle();
      if (!data) return false;
      const life = parseLifecycleKey(r.dedupe_key);
      const occIso = life?.occurrence ?? (r.dedupe_key ?? "").split(":")[2];
      if (!occIso) return true;
      const { data: occ } = await admin.from("activity_occurrences").select("status").eq("event_id", id).eq("occurrence_start", occIso).maybeSingle();
      const status = occ?.status as OccurrenceStatus | undefined;
      if (life) return lifecycleRelevant(life.stage, status);
      // Preparation/departure reminders stop once the occurrence was moved, skipped or excused.
      return !status || !["rescheduled", "skipped", "excused"].includes(status);
    }
    case "focus": { if (!id) return true; const { data } = await admin.from("focus_sessions").select("status").eq("id", id).maybeSingle(); return data?.status === "active"; }
    case "finance": { if (!id) return true; const { data } = await admin.from("financial_entries").select("paid").eq("id", id).maybeSingle(); return data?.paid === false; }
    case "prayer": {
      const [, day, prayer] = (r.dedupe_key ?? "").split(":");
      if (!day || !prayer) return true;
      const { data } = await admin.from("prayer_confirmations").select("id").eq("user_id", r.user_id).eq("prayer_date", day).eq("prayer", prayer).maybeSingle();
      return !data;
    }
    case "checkin": {
      if (!r.dedupe_key) return true;
      const [, kind, day] = r.dedupe_key.split(":");
      const { data } = await admin.from("accountability_sessions").select("status").eq("user_id", r.user_id).eq("kind", kind).eq("session_date", day ?? localDateString(new Date(r.send_at), tz)).maybeSingle();
      return data?.status !== "completed";
    }
    default: return true;
  }
}

/** Reminders for this item that reached a device but were never opened or acted on. */
async function ignoredCount(admin: SupabaseClient, r: Reminder): Promise<number> {
  if (!r.entity_id) return 0;
  const { data } = await admin.from("reminders").select("id, notifications(status,action)").eq("entity_id", r.entity_id).in("status", ["sent", "partial"]).gte("send_at", new Date(Date.now() - 3 * 864e5).toISOString());
  return (data ?? []).filter((x) => {
    const ns = (x.notifications ?? []) as { status: string; action: string | null }[];
    return ns.length > 0 && !ns.some((n) => n.status === "clicked" || n.action);
  }).length;
}

/** After a "due" reminder for an open task/commitment, schedule the next follow-up (or offer to adjust the plan). */
async function scheduleFollowUp(admin: SupabaseClient, r: Reminder, prefs: UserPreferences | null) {
  const isDue = (r.entity_type === "task" || r.entity_type === "commitment") && ((r.dedupe_key ?? "").includes(":due:") || r.follow_up_of);
  if (!isDue || !r.entity_id) return;
  const root = r.follow_up_of ?? r.id;
  const nextIndex = (r.follow_up_index ?? 0);
  const decision = nextFollowUp((prefs?.reminder_intensity ?? "balanced") as Intensity, nextIndex, await ignoredCount(admin, r), prefs?.custom_follow_up_minutes ?? []);
  const { data: rootRow } = await admin.from("reminders").select("send_at,title").eq("id", root).maybeSingle();
  const base = rootRow ? Date.parse(rootRow.send_at) : Date.now();
  if (decision.kind === "follow_up") {
    await admin.from("reminders").upsert({
      user_id: r.user_id, entity_type: r.entity_type, entity_id: r.entity_id, category: r.category,
      dedupe_key: `${root}:fu:${nextIndex + 1}`, follow_up_of: root, follow_up_index: nextIndex + 1,
      title: `Still open: ${(rootRow?.title ?? r.title).replace(/^(Due now|Promised time): /, "")}`,
      body: "Done? Tap Done. Not happening? Open it and record what changed.", url: r.url,
      send_at: new Date(Math.max(base + decision.atMinutes! * 60_000, Date.now() + 60_000)).toISOString(),
      respect_quiet_hours: true, actions: r.actions,
    }, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true });
  } else if (decision.kind === "offer_adjustment") {
    await admin.from("reminders").upsert({
      user_id: r.user_id, entity_type: r.entity_type, entity_id: r.entity_id, category: "coaching",
      dedupe_key: `${root}:adjust`, follow_up_of: root, follow_up_index: 99,
      title: "Should we change the plan?", body: `Several reminders about “${(rootRow?.title ?? r.title).replace(/^(Due now|Promised time): /, "")}” went unanswered. I'll stop reminding. Want to reschedule it or break it down?`,
      url: "/coach", send_at: new Date(Date.now() + 60_000).toISOString(), respect_quiet_hours: true, actions: [],
    }, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true });
  }
}

export interface DispatchSummary { claimed: number; sent: number; partial: number; failed: number; retried: number; deferred: number; skipped: number; noDevice: number; released: number; disabled: number; paused: number; held: number }

export async function dispatchDueReminders(admin: SupabaseClient, limit = 100): Promise<DispatchSummary> {
  const summary: DispatchSummary = { claimed: 0, sent: 0, partial: 0, failed: 0, retried: 0, deferred: 0, skipped: 0, noDevice: 0, released: 0, disabled: 0, paused: 0, held: 0 };
  const { data: released } = await admin.rpc("release_stuck_reminders");
  summary.released = Number(released ?? 0);

  const { data: claimed, error } = await admin.rpc("claim_due_reminders", { p_limit: limit });
  if (error) throw new Error(`claim_due_reminders: ${error.message}`);
  const reminders = (claimed ?? []) as Reminder[];
  summary.claimed = reminders.length;
  if (!reminders.length) return summary;

  const userIds = Array.from(new Set(reminders.map((r) => r.user_id)));
  const [{ data: profiles }, { data: prefsRows }] = await Promise.all([
    admin.from("profiles").select("id,timezone,quiet_hours_start,quiet_hours_end").in("id", userIds),
    admin.from("user_preferences").select("*").in("user_id", userIds),
  ]);
  const byId = new Map((profiles ?? []).map((p: ProfileLite) => [p.id, p]));
  const prefsById = new Map(((prefsRows ?? []) as UserPreferences[]).map((p) => [p.user_id, p]));
  const now = new Date();
  // Normal/low-priority notifications already sent today, per user (for the daily budget).
  const sentToday = new Map<string, number>();
  for (const uid of userIds) {
    const prefs = prefsById.get(uid);
    if (!prefs?.daily_notification_budget) continue;
    const tz = byId.get(uid)?.timezone ?? "UTC";
    const since = dayBoundsUtc(localDateString(now, tz), tz).start.toISOString();
    const { count } = await admin.from("reminders").select("id", { count: "exact", head: true }).eq("user_id", uid).in("status", ["sent", "partial"]).gte("priority", 2).gte("processed_at", since);
    sentToday.set(uid, count ?? 0);
  }

  for (const r of reminders) {
    const p = byId.get(r.user_id);
    const prefs = prefsById.get(r.user_id) ?? null;
    const tz = p?.timezone ?? "UTC";
    const done = (patch: Partial<Reminder> & Record<string, unknown>) => admin.from("reminders").update(patch).eq("id", r.id);
    const cat = categorySetting(prefs?.categories, (r.category ?? "commitments") as Category);

    if (!cat.enabled) { await done({ status: "cancelled", last_error: `${r.category} notifications are turned off` }); summary.disabled++; continue; }
    if (pauseDecision(r.category, prefs?.paused_until, prefs?.pause_keeps_prayer ?? true, now) === "hold") {
      await done({ status: "cancelled", last_error: `Notifications paused until ${new Date(prefs!.paused_until!).toLocaleString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", weekday: "short" })}` });
      summary.paused++;
      continue;
    }
    if (!(await stillRelevant(admin, r, tz))) { await done({ status: "cancelled", last_error: "no longer relevant" }); summary.skipped++; continue; }
    if (now.getTime() - new Date(r.send_at).getTime() > 6 * 3600_000) { await done({ status: "cancelled", last_error: "too late to be useful" }); summary.skipped++; continue; }
    if (r.respect_quiet_hours && !cat.quiet_override && p?.quiet_hours_start && p.quiet_hours_end && inQuietHours(now, p.quiet_hours_start, p.quiet_hours_end, tz)) {
      await done({ status: "scheduled", send_at: quietHoursEnd(now, p.quiet_hours_end, tz).toISOString(), attempts: Math.max(0, r.attempts - 1) });
      summary.deferred++;
      continue;
    }

    const priority = r.priority ?? 2;
    if (budgetDecision(priority, sentToday.get(r.user_id) ?? 0, prefs?.daily_notification_budget) === "hold") {
      await done({ status: "cancelled", last_error: `Daily notification budget (${prefs!.daily_notification_budget}) reached — held back` });
      summary.held++;
      // One grouped notice per day so nothing disappears silently.
      await admin.from("reminders").upsert({
        user_id: r.user_id, entity_type: "custom", entity_id: null, category: "system", priority: 1,
        dedupe_key: `budget:${localDateString(now, tz)}`, title: "Today's notification limit reached",
        body: "Lower-priority reminders are held back until tomorrow. They're listed under Reminders → History.",
        url: "/reminders", send_at: new Date(now.getTime() + 30_000).toISOString(), respect_quiet_hours: true, actions: [],
      }, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true });
      continue;
    }

    let res: SendResult;
    try {
      res = await sendPushToUser(admin, r.user_id, { title: r.title, body: r.body, url: r.url, reminderId: r.id, actions: r.actions, category: r.category });
    } catch (e) {
      res = { subscriptions: 1, accepted: 0, failed: 1, errors: [(e as Error).message] };
    }

    if (res.subscriptions === 0) { await done({ status: "no_device", last_error: "No device has notifications enabled." }); summary.noDevice++; }
    else if (res.accepted === res.subscriptions) { await done({ status: "sent", last_error: null }); summary.sent++; }
    else if (res.accepted > 0) { await done({ status: "partial", last_error: res.errors.join(" | ").slice(0, 500) }); summary.partial++; }
    else if (r.attempts < 4) {
      // Exponential backoff: 1, 2, 4 minutes
      await done({ status: "scheduled", send_at: new Date(now.getTime() + 60_000 * 2 ** (r.attempts - 1)).toISOString(), last_error: res.errors.join(" | ").slice(0, 500) });
      summary.retried++;
      continue;
    } else { await done({ status: "failed", last_error: res.errors.join(" | ").slice(0, 500) }); summary.failed++; }

    if (res.accepted > 0) {
      if (priority >= 2) sentToday.set(r.user_id, (sentToday.get(r.user_id) ?? 0) + 1);
      try { await scheduleFollowUp(admin, r, prefs); } catch { /* follow-up scheduling must not block dispatch */ }
    }
  }
  return summary;
}
