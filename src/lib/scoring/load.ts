import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { localDateString, shiftDate } from "../time";
import type { ScoringInput } from "./index";

/**
 * Loads every record the scoring engine reads for [from, today] (RLS limits it
 * to the signed-in user). Timestamps are converted to the user's local dates.
 */
export async function loadScoringInput(db: SupabaseClient, opts: { from: string; today: string; tz: string; since: string }): Promise<Omit<ScoringInput, "from" | "to">> {
  const { from, today, tz } = opts;
  const fromTs = new Date(`${shiftDate(from, -1)}T00:00:00Z`).toISOString();
  const all = async <T>(q: () => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) => {
    const { data, error } = await q();
    if (error) throw new Error(error.message);
    return data ?? [];
  };
  const [cs, ts, occ, fs, im, hs, hl, ss, je, wl, prefs] = await Promise.all([
    all(() => db.from("commitments").select("commitment_date,status,made_to,promised_by,original_promised_by,resolved_at,verification,reschedule_count,source").gte("commitment_date", from).lte("commitment_date", today)),
    all(() => db.from("tasks").select("scheduled_for,status,verification,due_at,original_due_at,original_scheduled_for,completed_at,postponed_count").gte("scheduled_for", from).lte("scheduled_for", today)),
    all(() => db.from("activity_occurrences").select("occurrence_start,kind,status,evidence").gte("occurrence_start", fromTs)),
    all(() => db.from("focus_sessions").select("started_at,ended_at,ends_at,status,planned_minutes,distractions").gte("started_at", fromTs)),
    all(() => db.from("impulse_logs").select("created_at,outcome").gte("created_at", fromTs)),
    all(() => db.from("habits").select("id,area,target_per_week,created_at,active")),
    all(() => db.from("habit_logs").select("habit_id,log_date,status").gte("log_date", from).lte("log_date", today)),
    all(() => db.from("accountability_sessions").select("id,session_date,kind,status").gte("session_date", from).lte("session_date", today)),
    all(() => db.from("journal_entries").select("entry_date").gte("entry_date", from).lte("entry_date", today)),
    all(() => db.from("workout_logs").select("performed_on,workout_type").gte("performed_on", from).lte("performed_on", today)),
    db.from("user_preferences").select("workout_target_per_week").maybeSingle(),
  ]);
  const sessionIds = ss.filter((s) => s.kind === "evening").map((s) => s.id as string);
  const answers = sessionIds.length
    ? await all(() => db.from("accountability_answers").select("session_id,question_key,skipped").in("session_id", sessionIds).eq("question_key", "honest_communication"))
    : [];
  const sessionDate = new Map(ss.map((s) => [s.id as string, s.session_date as string]));
  const ld = (iso: string) => localDateString(new Date(iso), tz);

  return {
    today, now: new Date(), since: opts.since,
    commitments: cs.map((c) => ({ date: c.commitment_date, status: c.status, made_to: c.made_to, promised_by: c.promised_by, original_promised_by: c.original_promised_by, resolved_at: c.resolved_at, verification: c.verification, reschedule_count: c.reschedule_count, source: c.source })),
    tasks: ts.map((t) => ({ date: t.scheduled_for, status: t.status, verification: t.verification, due_at: t.due_at, original_due_at: t.original_due_at, original_scheduled_for: t.original_scheduled_for, completed_at: t.completed_at, postponed_count: t.postponed_count })),
    occurrences: occ.map((o) => ({ date: ld(o.occurrence_start), kind: o.kind, status: o.status, evidence: o.evidence, start: o.occurrence_start })),
    focus: fs.map((f) => ({
      date: ld(f.started_at), status: f.status, planned_minutes: f.planned_minutes,
      minutes: Math.max(0, Math.round(((f.ended_at ? Date.parse(f.ended_at) : Date.parse(f.ends_at)) - Date.parse(f.started_at)) / 60000)),
      distractions: Array.isArray(f.distractions) ? f.distractions.length : 0,
    })),
    impulses: im.map((x) => ({ date: ld(x.created_at), outcome: x.outcome })),
    habits: hs.map((h) => ({ id: h.id, area: h.area, target_per_week: h.target_per_week, created: ld(h.created_at), active: h.active })),
    habitLogs: hl.map((l) => ({ habit_id: l.habit_id, date: l.log_date, status: l.status })),
    checkins: ss.map((s) => ({ date: s.session_date, kind: s.kind, status: s.status })),
    answers: answers.map((a) => ({ date: sessionDate.get(a.session_id) ?? "", key: a.question_key, skipped: !!a.skipped })),
    journalDates: [...new Set(je.map((j) => j.entry_date as string))],
    workouts: wl.map((w) => ({ date: w.performed_on, type: w.workout_type })),
    workoutTargetPerWeek: prefs.data?.workout_target_per_week ?? null,
  };
}
