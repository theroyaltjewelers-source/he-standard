import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generationWindow, seriesDates, seriesDueAt, addDays, type SeriesLike } from "./series";
import { syncTaskReminders } from "./reminders";
import { sweepOccurrences } from "./occurrences";
import { integritySeries } from "./records";
import { computeScores, POLICY_V1 } from "./scoring";
import { loadScoringInput } from "./scoring/load";
import { pickInsight } from "./insights";
import { dayBoundsUtc } from "./time";
import type { Task } from "./types";

/**
 * Daily rollover and reconciliation. Runs server-side from the planner every
 * 15 minutes (so it happens even when the app is closed overnight) and again
 * when the app opens after inactivity. Everything is idempotent.
 *
 *   1. Recurring tasks: create each missing occurrence (one row per day),
 *      back-filling days missed while idle.
 *   2. Activity lifecycle: create records for occurrences since the last
 *      reconciliation; unanswered ones become "awaiting confirmation".
 *   3. Scores: finalise yesterday's score (stored with its policy version)
 *      and keep today's provisional snapshot current.
 */

interface SeriesRow extends SeriesLike { id: string; user_id: string; title: string; notes: string | null; goal_id: string | null; priority: number; is_top_priority: boolean; last_generated_on: string | null; active: boolean }

export async function generateSeries(db: SupabaseClient, userId: string, today: string, tz: string, onlySeriesId?: string) {
  let q = db.from("task_series").select("*").eq("user_id", userId).eq("active", true);
  if (onlySeriesId) q = q.eq("id", onlySeriesId);
  const { data: series } = await q;
  let created = 0;
  for (const s of (series ?? []) as SeriesRow[]) {
    const w = generationWindow({ lastGenerated: s.last_generated_on, startsOn: s.starts_on, today });
    if (!w) continue;
    const dates = seriesDates(s, w.from, w.to);
    if (dates.length) {
      const rows = dates.map((d) => ({
        user_id: userId, series_id: s.id, occurrence_date: d, scheduled_for: d, title: s.title, notes: s.notes, goal_id: s.goal_id,
        priority: s.priority, is_top_priority: s.is_top_priority, due_at: seriesDueAt(s, d)?.toISOString() ?? null,
      }));
      const { data: inserted, error } = await db.from("tasks").upsert(rows, { onConflict: "series_id,occurrence_date", ignoreDuplicates: true }).select("*");
      if (error) throw new Error(`Could not create recurring tasks: ${error.message}`);
      created += inserted?.length ?? 0;
      for (const t of (inserted ?? []) as Task[]) if (t.scheduled_for && t.scheduled_for >= today) await syncTaskReminders(db, userId, t, tz);
    }
    await db.from("task_series").update({ last_generated_on: w.to }).eq("id", s.id);
  }
  return created;
}

/** Store a day's score with the policy version used. Final snapshots are never overwritten. */
export async function snapshotDay(db: SupabaseClient, userId: string, date: string, tz: string, today: string, since: string, final: boolean) {
  const { data: existing } = await db.from("daily_scores").select("final").eq("user_id", userId).eq("score_date", date).eq("policy_version", POLICY_V1.version).maybeSingle();
  if (existing?.final) return false;
  const [integrity] = await integritySeries(db, date, date, today, userId);
  const input = await loadScoringInput(db, { from: addDays(date, -34), today: date, tz, since, userId });
  const report = computeScores({ ...input, now: final ? dayBoundsUtc(date, tz).end : new Date(), from: addDays(date, -6), to: date });
  const insight = pickInsight({ ...input, now: final ? dayBoundsUtc(date, tz).end : new Date() }, report, null);
  const { error } = await db.from("daily_scores").upsert({
    user_id: userId, score_date: date, policy_version: POLICY_V1.version, final,
    integrity: integrity.result,
    evolution: { overall: report.overall, coverage: report.coverageWeight, window: `${report.from}..${report.to}`, domains: Object.fromEntries(report.domains.map((d) => [d.key, d.score])), excluded: report.excluded.map((e) => e.key) },
    insight: insight ? { title: insight.title, recommendation: insight.recommendation, evidence: insight.evidence } : null,
    computed_at: new Date().toISOString(),
  }, { onConflict: "user_id,score_date,policy_version" });
  if (error) throw new Error(`Could not store the daily score: ${error.message}`);
  return true;
}

export async function reconcileUser(db: SupabaseClient, userId: string, tz: string, today: string, since: string, now = new Date()) {
  const { data: prefs } = await db.from("user_preferences").select("last_reconciled_on").eq("user_id", userId).maybeSingle();
  const last = prefs?.last_reconciled_on as string | null | undefined;
  const summary = { series_created: 0, occurrences: 0, awaiting: 0, finalized: [] as string[] };
  summary.series_created = await generateSeries(db, userId, today, tz);
  const sw = await sweepOccurrences(db, userId, tz, now, last ? dayBoundsUtc(last, tz).start : undefined);
  summary.occurrences = sw.considered;
  summary.awaiting = sw.awaiting;
  // Finalise every ended day since the last reconciliation (max 7 back), then today's provisional score.
  const firstPending = last && last < today ? last : addDays(today, -1);
  for (let d = [firstPending, addDays(today, -7), since].sort().pop()!; d < today; d = addDays(d, 1)) {
    if (await snapshotDay(db, userId, d, tz, today, since, true)) summary.finalized.push(d);
  }
  await snapshotDay(db, userId, today, tz, today, since, false);
  await db.from("user_preferences").update({ last_reconciled_on: today }).eq("user_id", userId);
  return summary;
}
