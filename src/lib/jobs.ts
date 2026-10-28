import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildCheckinRows, buildEventReminderRows, buildPrayerRows, insertRows, savePrayerSchedule, type PrayerSettingsRow, type Row } from "./reminders";
import { categorySetting } from "./reminder-policy";
import { importVerses, pickIndex } from "./quran";
import { isConnected, pullChanges } from "./google";
import { generateWeeklyReport } from "./weekly";
import { reconcileUser } from "./rollover";
import { dayOfWeek, formatInZone, shiftDate, todayIn, zonedToUtc } from "./time";
import type { CalendarEvent, UserPreferences } from "./types";

/**
 * The planner runs every 15 minutes (Supabase pg_cron → /api/cron/plan).
 * Everything it does is idempotent: reminders use dedupe keys, reports upsert
 * by week, and Google sync uses sync tokens.
 */
export async function planAllUsers(admin: SupabaseClient, now = new Date()) {
  const summary = { users: 0, reminders_considered: 0, google_synced: 0, reports: 0, occurrences: 0, awaiting_confirmation: 0, series_created: 0, days_finalized: 0, verses: null as null | object, retention: null as unknown, errors: [] as string[] };

  try {
    const { count } = await admin.from("quran_verses").select("id", { count: "exact", head: true });
    if ((count ?? 0) < 41) summary.verses = await importVerses(admin, 15);
  } catch (e) { summary.errors.push(`verses: ${(e as Error).message}`); }

  const { data: profiles, error } = await admin.from("profiles")
    .select("id,timezone,morning_checkin_time,evening_checkin_time,ai_analysis_consent,onboarding_completed_at,created_at")
    .not("onboarding_completed_at", "is", null);
  if (error) throw new Error(error.message);

  for (const p of profiles ?? []) {
    summary.users++;
    try {
      const [{ data: prefs }, { data: ps }] = await Promise.all([
        admin.from("user_preferences").select("*").eq("user_id", p.id).maybeSingle<UserPreferences>(),
        admin.from("prayer_settings").select("*").eq("user_id", p.id).maybeSingle<PrayerSettingsRow>(),
      ]);
      const tz = p.timezone;
      const today = todayIn(tz, now);
      const rows: Row[] = buildCheckinRows({ ...p, midday_checkin_time: prefs?.midday_checkin_time ?? null }, now);

      const { data: events } = await admin.from("events").select("*").eq("user_id", p.id).neq("recurrence", "none");
      for (const ev of (events ?? []) as CalendarEvent[]) rows.push(...buildEventReminderRows(p.id, ev, tz, now));

      if (ps) {
        rows.push(...buildPrayerRows(ps, tz, now));
        await savePrayerSchedule(admin, ps, tz, today);
      }

      // Daily verse (verbatim from the verified library)
      if (categorySetting(prefs?.categories, "quran").enabled) {
        const { data: verses } = await admin.from("quran_verses").select("surah,ayah,surah_name,translation,translator");
        if (verses?.length) {
          for (const day of [today, shiftDate(today, 1)]) {
            const v = verses[pickIndex(day, p.id, verses.length)];
            const at = zonedToUtc(day, "08:00", tz);
            if (at > now) rows.push({
              user_id: p.id, entity_type: "reflection", entity_id: null, category: "quran", dedupe_key: `quran:${day}`,
              title: `Quran ${v.surah}:${v.ayah}${v.surah_name ? ` · ${v.surah_name}` : ""}`, body: `${v.translation} (${v.translator})`,
              url: "/faith#verse", send_at: at.toISOString(), respect_quiet_hours: true, actions: [],
            });
          }
        }
      }

      // Bills due tomorrow
      const { data: bills } = await admin.from("financial_entries").select("id,description,amount,due_date").eq("user_id", p.id).eq("kind", "bill").eq("paid", false).gte("due_date", today).lte("due_date", shiftDate(today, 2));
      for (const b of bills ?? []) {
        const at = zonedToUtc(shiftDate(b.due_date, -1), "09:00", tz);
        if (at > now) rows.push({
          user_id: p.id, entity_type: "finance", entity_id: b.id, category: "finance", dedupe_key: `bill:${b.id}:${b.due_date}`,
          title: `Bill due tomorrow: ${b.description ?? "bill"}`, body: `$${Number(b.amount).toFixed(2)} due ${b.due_date}.`, url: "/money", send_at: at.toISOString(), respect_quiet_hours: true, actions: [],
        });
      }

      await insertRows(admin, rows);
      summary.reminders_considered += rows.length;

      // Daily rollover: recurring-task occurrences (with back-fill), activity
      // lifecycle records ("awaiting confirmation" when unanswered), and
      // stored daily scores. Runs server-side, so it happens with the app closed.
      try {
        const r = await reconcileUser(admin, p.id, tz, today, todayIn(tz, new Date(p.created_at ?? now)), now);
        summary.occurrences += r.occurrences;
        summary.awaiting_confirmation += r.awaiting;
        summary.series_created += r.series_created;
        summary.days_finalized += r.finalized.length;
      } catch (e) { summary.errors.push(`rollover ${p.id.slice(0, 8)}: ${(e as Error).message}`); }

      // Google Calendar pull
      if (await isConnected(admin, p.id)) {
        try {
          const r = await pullChanges(admin, p.id, tz);
          summary.google_synced++;
          if (r.changedIds.length) {
            const { data: changed } = await admin.from("events").select("*").in("id", r.changedIds);
            for (const ev of (changed ?? []) as CalendarEvent[]) {
              await admin.from("reminders").delete().eq("entity_type", "event").eq("entity_id", ev.id).eq("status", "scheduled");
              await insertRows(admin, buildEventReminderRows(p.id, ev, tz, now));
            }
          }
        } catch (e) {
          await admin.from("calendar_sync_state").update({ last_status: "error", last_error: (e as Error).message }).eq("user_id", p.id);
          summary.errors.push(`google ${p.id.slice(0, 8)}: ${(e as Error).message}`);
        }
      }

      // Weekly report: on the chosen day, from 18:00 local, once per week
      const reportDay = prefs?.weekly_report_day ?? 0;
      if (dayOfWeek(today) === reportDay && Number(formatInZone(now, tz, "H")) >= 18) {
        const weekStart = shiftDate(today, -6);
        const { data: existing } = await admin.from("weekly_reports").select("id").eq("user_id", p.id).eq("week_start", weekStart).maybeSingle();
        if (!existing) {
          await generateWeeklyReport(admin, p.id, weekStart, tz, p.ai_analysis_consent);
          summary.reports++;
          await insertRows(admin, [{
            user_id: p.id, entity_type: "weekly_report", entity_id: null, category: "weekly_review", dedupe_key: `weekly:${weekStart}`,
            title: "Your weekly report is ready", body: "Where your actions matched your values — and where they didn't.", url: "/progress", send_at: new Date(now.getTime() + 60_000).toISOString(), respect_quiet_hours: true, actions: [],
          }]);
        }
      }
    } catch (e) {
      summary.errors.push(`${p.id.slice(0, 8)}: ${(e as Error).message}`);
    }
  }

  try {
    const base = (await admin.rpc("apply_retention")).data as Record<string, number> | null;
    const v3 = (await admin.rpc("apply_retention_v3")).data as number | null;
    const v4 = (await admin.rpc("apply_retention_v4")).data as Record<string, number> | null;
    summary.retention = { ...(base ?? {}), action_log: v3 ?? 0, ...(v4 ?? {}) };
  } catch (e) { summary.errors.push(`retention: ${(e as Error).message}`); }
  return summary;
}
