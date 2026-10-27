import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt, encrypt } from "./crypto";
import { env } from "./env";
import type { CalendarEvent } from "./types";
import { localDateString, shiftDate, zonedToUtc } from "./time";

/**
 * Google Calendar integration.
 *  - OAuth 2.0 with offline access; minimum scope: calendar.events (+ openid email to label the account).
 *  - Tokens are encrypted before storage (lib/crypto.ts) and refreshed on demand.
 *  - Pull: incremental sync with syncToken (full resync on 410 Gone).
 *  - Push: our event UUID (hex) is used as the Google event id, so inserts are idempotent.
 *  - Conflicts: last writer wins by modification time; every conflict is written to the audit log.
 * All calls take a service-role client and an explicit userId supplied by authenticated server code.
 */

export const GOOGLE_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.events"];
const API = "https://www.googleapis.com/calendar/v3";

export const googleConfigured = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
export const redirectUri = () => `${env.appUrl()}/api/google/callback`;

export function authUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, ...body }),
  });
  const json = (await res.json()) as TokenResponse;
  if (!res.ok || json.error) throw Object.assign(new Error(json.error_description || json.error || `token HTTP ${res.status}`), { code: json.error });
  return json;
}

export async function exchangeCode(admin: SupabaseClient, userId: string, code: string) {
  const t = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri() });
  let email: string | null = null;
  if (t.id_token) {
    try {
      email = JSON.parse(Buffer.from(t.id_token.split(".")[1], "base64url").toString()).email ?? null;
    } catch { /* label only */ }
  }
  const scopes = t.scope.split(" ");
  if (!scopes.includes("https://www.googleapis.com/auth/calendar.events")) {
    throw new Error("Calendar access wasn't granted. Connect again and allow access to calendar events.");
  }
  const { error } = await admin.from("connected_accounts").upsert({
    user_id: userId, provider: "google", account_email: email, scopes,
    access_token_enc: encrypt(t.access_token),
    ...(t.refresh_token ? { refresh_token_enc: encrypt(t.refresh_token) } : {}),
    expires_at: new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString(),
    status: "active", last_error: null,
  }, { onConflict: "user_id,provider" });
  if (error) throw new Error(error.message);
  await admin.from("calendar_sync_state").upsert({ user_id: userId, provider: "google", calendar_id: "primary", sync_token: null }, { onConflict: "user_id,provider,calendar_id" });
}

export class GoogleNotConnected extends Error {}

async function accessToken(admin: SupabaseClient, userId: string): Promise<string> {
  const { data: acct } = await admin.from("connected_accounts").select("*").eq("user_id", userId).eq("provider", "google").maybeSingle();
  if (!acct || acct.status === "revoked") throw new GoogleNotConnected("Google Calendar is not connected.");
  if (acct.access_token_enc && acct.expires_at && Date.parse(acct.expires_at) > Date.now() + 30_000) return decrypt(acct.access_token_enc);
  if (!acct.refresh_token_enc) throw new GoogleNotConnected("Google Calendar needs to be reconnected.");
  try {
    const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: decrypt(acct.refresh_token_enc) });
    await admin.from("connected_accounts").update({
      access_token_enc: encrypt(t.access_token), expires_at: new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString(), status: "active", last_error: null,
    }).eq("id", acct.id);
    return t.access_token;
  } catch (e) {
    const code = (e as { code?: string }).code;
    await admin.from("connected_accounts").update({ status: code === "invalid_grant" ? "revoked" : "error", last_error: (e as Error).message }).eq("id", acct.id);
    if (code === "invalid_grant") throw new GoogleNotConnected("Google access was revoked. Reconnect Google Calendar in Settings.");
    throw e;
  }
}

/** Calendar API request with retry on rate limits and transient errors. */
async function gapi<T>(admin: SupabaseClient, userId: string, path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const token = await accessToken(admin, userId);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    const body = (text ? JSON.parse(text) : {}) as T & { error?: { message?: string; errors?: { reason?: string }[] } };
    const reason = body.error?.errors?.[0]?.reason;
    const retryable = res.status === 429 || res.status >= 500 || (res.status === 403 && (reason === "rateLimitExceeded" || reason === "userRateLimitExceeded"));
    if (retryable && attempt < 3) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt + Math.random() * 250));
      continue;
    }
    if (res.status === 401) throw new GoogleNotConnected("Google rejected the stored credentials. Reconnect Google Calendar.");
    return { status: res.status, body };
  }
}

interface GEvent {
  id: string;
  status: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string };
  updated: string;
  etag: string;
  recurringEventId?: string;
}

export const googleEventId = (uuid: string) => uuid.replace(/-/g, "").toLowerCase();

function toGoogle(ev: CalendarEvent, tz: string) {
  const startDate = localDateString(new Date(ev.starts_at), tz);
  const body: Record<string, unknown> = {
    summary: ev.title,
    location: ev.location ?? undefined,
    description: [ev.notes, "— Added by The Standard"].filter(Boolean).join("\n\n"),
    start: ev.all_day ? { date: startDate } : { dateTime: ev.starts_at, timeZone: tz },
    end: ev.all_day ? { date: shiftDate(startDate, 1) } : { dateTime: ev.ends_at ?? new Date(Date.parse(ev.starts_at) + 3600_000).toISOString(), timeZone: tz },
  };
  if (ev.recurrence !== "none") {
    const until = ev.recurrence_until ? `;UNTIL=${ev.recurrence_until.replace(/-/g, "")}T235959Z` : "";
    body.recurrence = [`RRULE:FREQ=${ev.recurrence.toUpperCase()}${until}`];
  }
  return body;
}

/** Create or update the Google copy of a local event. Idempotent. */
export async function pushEvent(admin: SupabaseClient, userId: string, ev: CalendarEvent, tz: string) {
  const id = ev.external_source === "google" && ev.external_id ? ev.external_id : googleEventId(ev.id);
  const body = toGoogle(ev, tz);
  let r = await gapi<GEvent>(admin, userId, `/calendars/primary/events/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) });
  if (r.status === 404) {
    r = await gapi<GEvent>(admin, userId, `/calendars/primary/events`, { method: "POST", body: JSON.stringify({ ...body, id }) });
    if (r.status === 409) r = await gapi<GEvent>(admin, userId, `/calendars/primary/events/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) });
  }
  if (r.status >= 300) {
    const msg = (r.body as unknown as { error?: { message?: string } }).error?.message ?? `HTTP ${r.status}`;
    await admin.from("events").update({ sync_status: "error", sync_error: msg }).eq("id", ev.id);
    throw new Error(`Google Calendar: ${msg}`);
  }
  await admin.from("events").update({
    external_source: "google", external_id: r.body.id, external_etag: r.body.etag,
    external_updated_at: r.body.updated, sync_status: "synced", sync_error: null,
  }).eq("id", ev.id);
  return r.body;
}

export async function deleteRemote(admin: SupabaseClient, userId: string, externalId: string) {
  const r = await gapi(admin, userId, `/calendars/primary/events/${encodeURIComponent(externalId)}`, { method: "DELETE" });
  if (r.status >= 300 && r.status !== 404 && r.status !== 410) throw new Error(`Google Calendar delete failed: HTTP ${r.status}`);
}

/** Map a Google event to local columns. */
function fromGoogle(g: GEvent, tz: string) {
  const allDay = !!g.start?.date;
  const starts = allDay ? zonedToUtc(g.start!.date!, "00:00", tz) : new Date(g.start!.dateTime!);
  const ends = allDay ? null : g.end?.dateTime ? new Date(g.end.dateTime) : null;
  return {
    title: (g.summary || "(no title)").slice(0, 200),
    location: g.location ?? null,
    notes: g.description?.replace(/\n*— Added by The Standard$/, "") || null,
    starts_at: starts.toISOString(),
    ends_at: ends && ends >= starts ? ends.toISOString() : null,
    all_day: allDay,
  };
}

export interface SyncResult { created: number; updated: number; deleted: number; conflicts: number; full: boolean }

/**
 * Incremental pull from Google. Returns ids of local events whose reminders must be regenerated.
 */
export async function pullChanges(admin: SupabaseClient, userId: string, tz: string): Promise<SyncResult & { changedIds: string[] }> {
  const { data: state } = await admin.from("calendar_sync_state").select("*").eq("user_id", userId).eq("provider", "google").eq("calendar_id", "primary").maybeSingle();
  let syncToken: string | null = state?.sync_token ?? null;
  const res: SyncResult & { changedIds: string[] } = { created: 0, updated: 0, deleted: 0, conflicts: 0, full: !syncToken, changedIds: [] };

  const { data: masters } = await admin.from("events").select("external_id").eq("user_id", userId).neq("recurrence", "none").not("external_id", "is", null);
  const localRecurring = new Set((masters ?? []).map((m) => m.external_id));

  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;
  for (let page = 0; page < 20; page++) {
    const q = new URLSearchParams({ singleEvents: "true", showDeleted: "true", maxResults: "250" });
    if (syncToken) q.set("syncToken", syncToken);
    else {
      q.set("timeMin", new Date(Date.now() - 30 * 864e5).toISOString());
      q.set("timeMax", new Date(Date.now() + 180 * 864e5).toISOString());
    }
    if (pageToken) q.set("pageToken", pageToken);
    const r = await gapi<{ items?: GEvent[]; nextPageToken?: string; nextSyncToken?: string }>(admin, userId, `/calendars/primary/events?${q}`);
    if (r.status === 410) {
      // Sync token expired: start a full sync.
      syncToken = null;
      pageToken = undefined;
      res.full = true;
      continue;
    }
    if (r.status >= 300) throw new Error(`Google Calendar list failed: HTTP ${r.status}`);

    for (const g of r.body.items ?? []) {
      if (g.recurringEventId && localRecurring.has(g.recurringEventId)) continue; // instance of a series we own
      const { data: local } = await admin.from("events").select("*").eq("user_id", userId).eq("external_source", "google").eq("external_id", g.id).maybeSingle();
      if (g.status === "cancelled") {
        if (local) {
          await admin.from("reminders").delete().eq("entity_type", "event").eq("entity_id", local.id).eq("status", "scheduled");
          await admin.from("events").delete().eq("id", local.id);
          res.deleted++;
          await audit(admin, userId, "calendar.deleted_from_google", local.id, { title: local.title });
        }
        continue;
      }
      if (!g.start) continue;
      const mapped = fromGoogle(g, tz);
      if (!local) {
        const { data: ins, error } = await admin.from("events").insert({
          user_id: userId, ...mapped, external_source: "google", external_id: g.id, external_etag: g.etag,
          external_updated_at: g.updated, sync_status: "synced", reminder_offsets: [30],
        }).select("id").single();
        if (!error && ins) { res.created++; res.changedIds.push(ins.id); }
        continue;
      }
      if (local.external_etag === g.etag) continue;
      // Conflict check: local edit after the last sync that hasn't been pushed yet.
      const localChanged = local.sync_status === "pending_push" && Date.parse(local.updated_at) > Date.parse(local.external_updated_at ?? "1970-01-01");
      if (localChanged && Date.parse(local.updated_at) > Date.parse(g.updated)) {
        res.conflicts++;
        await audit(admin, userId, "calendar.conflict_kept_local", local.id, { google_updated: g.updated, local_updated: local.updated_at });
        continue; // local wins; it will be pushed
      }
      if (localChanged) {
        res.conflicts++;
        await audit(admin, userId, "calendar.conflict_kept_google", local.id, { google_updated: g.updated, local_updated: local.updated_at });
      }
      await admin.from("events").update({ ...mapped, external_etag: g.etag, external_updated_at: g.updated, sync_status: "synced", sync_error: null }).eq("id", local.id);
      res.updated++;
      res.changedIds.push(local.id);
    }
    pageToken = r.body.nextPageToken;
    nextSyncToken = r.body.nextSyncToken ?? nextSyncToken;
    if (!pageToken) break;
  }
  await admin.from("calendar_sync_state").upsert({
    user_id: userId, provider: "google", calendar_id: "primary", sync_token: nextSyncToken ?? syncToken,
    last_synced_at: new Date().toISOString(), last_status: "ok", last_error: null,
  }, { onConflict: "user_id,provider,calendar_id" });
  return res;
}

async function audit(admin: SupabaseClient, userId: string, action: string, entityId: string, detail: Record<string, unknown>) {
  await admin.from("audit_logs").insert({ user_id: userId, actor: "system", action, entity_type: "event", entity_id: entityId, detail });
}

export async function isConnected(admin: SupabaseClient, userId: string) {
  const { data } = await admin.from("connected_accounts").select("status").eq("user_id", userId).eq("provider", "google").maybeSingle();
  return data?.status === "active";
}
