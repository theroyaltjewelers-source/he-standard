import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CalendarEvent } from "./types";
import { deleteRemote, isConnected, pushEvent } from "./google";

/**
 * Durable outbox for Google Calendar writes. The first attempt happens inline
 * (fast path); a failure is queued here and retried with exponential backoff
 * by the dispatcher. After MAX_ATTEMPTS the entry is marked dead and shown in
 * Settings → System health — it is never silently dropped.
 */
export const MAX_ATTEMPTS = 8;
export const backoffMs = (attempts: number) => Math.min(6 * 3600_000, 60_000 * 2 ** Math.max(0, attempts - 1)); // 1, 2, 4 … min, capped at 6 h

export async function enqueueSync(admin: SupabaseClient, userId: string, item: { eventId?: string | null; op: "upsert" | "delete"; externalId?: string | null; error?: string }, now = new Date()) {
  // Collapse duplicates: one pending upsert per event is enough (it always pushes the latest row).
  if (item.op === "upsert" && item.eventId) {
    const { data: existing } = await admin.from("sync_outbox").select("id").eq("user_id", userId).eq("event_id", item.eventId).eq("op", "upsert").eq("status", "pending").maybeSingle();
    if (existing) {
      await admin.from("sync_outbox").update({ last_error: item.error ?? null, updated_at: now.toISOString() }).eq("id", existing.id);
      return existing.id as string;
    }
  }
  const { data } = await admin.from("sync_outbox").insert({
    user_id: userId, event_id: item.eventId ?? null, op: item.op, external_id: item.externalId ?? null,
    attempts: 1, last_error: item.error ?? null, next_attempt_at: new Date(now.getTime() + backoffMs(1)).toISOString(),
  }).select("id").single();
  return (data?.id as string) ?? null;
}

/** Push now; on failure queue a retry. Returns a user-facing status line. */
export async function pushOrQueue(admin: SupabaseClient, userId: string, ev: CalendarEvent, tz: string): Promise<{ ok: boolean; status: string }> {
  if (!(await isConnected(admin, userId))) return { ok: true, status: "not connected" };
  try { await pushEvent(admin, userId, ev, tz); return { ok: true, status: "synced to Google Calendar" }; }
  catch (e) {
    const msg = (e as Error).message;
    await enqueueSync(admin, userId, { eventId: ev.id, op: "upsert", error: msg });
    return { ok: false, status: `saved here; Google Calendar will be retried automatically (${msg})` };
  }
}

export async function deleteOrQueue(admin: SupabaseClient, userId: string, externalId: string): Promise<{ ok: boolean; status: string }> {
  if (!(await isConnected(admin, userId))) return { ok: true, status: "not connected" };
  try { await deleteRemote(admin, userId, externalId); return { ok: true, status: "removed from Google Calendar" }; }
  catch (e) {
    const msg = (e as Error).message;
    await enqueueSync(admin, userId, { op: "delete", externalId, error: msg });
    return { ok: false, status: `Google Calendar removal will be retried (${msg})` };
  }
}

export interface OutboxSummary { outbox_done: number; outbox_retry: number; outbox_dead: number }

export async function processOutbox(admin: SupabaseClient, now = new Date(), limit = 20): Promise<OutboxSummary> {
  const out: OutboxSummary = { outbox_done: 0, outbox_retry: 0, outbox_dead: 0 };
  const { data: due } = await admin.from("sync_outbox").select("*").eq("status", "pending").lte("next_attempt_at", now.toISOString()).order("next_attempt_at").limit(limit);
  const tzCache = new Map<string, string>();
  for (const item of due ?? []) {
    // Claim the row so overlapping dispatcher runs never process it twice.
    const { data: claimed } = await admin.from("sync_outbox").update({ next_attempt_at: new Date(now.getTime() + 5 * 60_000).toISOString(), updated_at: now.toISOString() })
      .eq("id", item.id).eq("status", "pending").eq("next_attempt_at", item.next_attempt_at).select("id");
    if (!claimed?.length) continue;
    try {
      if (!(await isConnected(admin, item.user_id))) throw new Error("Google Calendar is disconnected");
      if (item.op === "upsert") {
        const { data: ev } = await admin.from("events").select("*").eq("id", item.event_id).eq("user_id", item.user_id).maybeSingle<CalendarEvent>();
        if (ev) {
          if (!tzCache.has(item.user_id)) {
            const { data: p } = await admin.from("profiles").select("timezone").eq("id", item.user_id).single();
            tzCache.set(item.user_id, p?.timezone ?? "UTC");
          }
          await pushEvent(admin, item.user_id, ev, tzCache.get(item.user_id)!);
        } // event deleted locally since → nothing to push
      } else if (item.external_id) {
        await deleteRemote(admin, item.user_id, item.external_id);
      }
      await admin.from("sync_outbox").update({ status: "done", last_error: null, updated_at: now.toISOString() }).eq("id", item.id);
      out.outbox_done++;
    } catch (e) {
      const attempts = (item.attempts ?? 0) + 1;
      const dead = attempts >= MAX_ATTEMPTS;
      await admin.from("sync_outbox").update({
        attempts, last_error: (e as Error).message.slice(0, 500), status: dead ? "dead" : "pending",
        next_attempt_at: new Date(now.getTime() + backoffMs(attempts)).toISOString(), updated_at: now.toISOString(),
      }).eq("id", item.id);
      if (dead) out.outbox_dead++; else out.outbox_retry++;
    }
  }
  return out;
}

/** Re-queue a dead entry (from Settings → System health). */
export async function retryOutboxItem(admin: SupabaseClient, userId: string, id: string) {
  await admin.from("sync_outbox").update({ status: "pending", attempts: 0, next_attempt_at: new Date().toISOString() }).eq("id", id).eq("user_id", userId).eq("status", "dead");
}

/** Wrap a scheduled job so every run is recorded in job_runs (success, summary, or error). */
export async function recordJob<T extends object>(admin: SupabaseClient, job: string, run: () => Promise<T>): Promise<T> {
  const { data: row } = await admin.from("job_runs").insert({ job }).select("id").single();
  try {
    const summary = await run();
    if (row) await admin.from("job_runs").update({ finished_at: new Date().toISOString(), ok: true, summary }).eq("id", row.id);
    return summary;
  } catch (e) {
    if (row) await admin.from("job_runs").update({ finished_at: new Date().toISOString(), ok: false, error: (e as Error).message.slice(0, 1000) }).eq("id", row.id);
    throw e;
  }
}
