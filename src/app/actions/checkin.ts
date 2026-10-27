"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { checkAnswer, EVENING_QUESTIONS, MIDDAY_QUESTIONS, MORNING_QUESTIONS, wordCount, type Question } from "@/lib/interview";
import { adaptiveEveningQuestions } from "@/lib/adaptive";
import { aiFollowUpQuestion } from "@/lib/ai";
import { syncCommitmentReminders } from "@/lib/reminders";
import { eventsBetween } from "@/lib/records";
import { prayerConfig, type PrayerSettingsRow } from "@/lib/reminders";
import { PRAYERS, PRAYER_LABEL, prayerTimesFor } from "@/lib/prayer";
import { formatInZone, zonedToUtc } from "@/lib/time";
import type { Commitment } from "@/lib/types";

export interface CheckinState {
  error?: string;
  followUps?: Record<string, { text: string; source: "rule" | "ai" }>;
  conflicts?: string[];
  values?: Record<string, string>;
  attempt?: number;
}

const s = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");

function echo(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  form.forEach((v, k) => { if (typeof v === "string" && !k.startsWith("$")) out[k] = v; });
  return out;
}

type Accepted = { q: Question; answer: string; skipped: boolean; fuq: string | null; fua: string | null; source: "rule" | "ai" | null };

/**
 * Validates answers. Any question can be skipped (recorded as skipped — honest,
 * not penalised). A required answer that is empty, too short or vague gets a
 * respectful follow-up; the answer to that follow-up then satisfies it.
 */
async function reviewAnswers(form: FormData, questions: Question[], aiAllowed: boolean, context: string) {
  const followUps: NonNullable<CheckinState["followUps"]> = {};
  const accepted: Accepted[] = [];
  let aiCalls = 0;
  for (const q of questions) {
    if (form.get(`skip_${q.key}`) === "on") { accepted.push({ q, answer: "", skipped: true, fuq: null, fua: null, source: null }); continue; }
    const answer = s(form, q.key);
    const askedFu = s(form, `fuq_${q.key}`);
    const fuAnswer = s(form, `fu_${q.key}`);
    const askedSource = (s(form, `fus_${q.key}`) || "rule") as "rule" | "ai";
    const check = checkAnswer(q, answer);
    const withFu = askedFu && fuAnswer;
    if (check.ok) { accepted.push({ q, answer, skipped: false, fuq: withFu ? askedFu : null, fua: withFu ? fuAnswer : null, source: withFu ? askedSource : null }); continue; }
    if (check.reason !== "empty" && askedFu && wordCount(fuAnswer) >= 3) { accepted.push({ q, answer, skipped: false, fuq: askedFu, fua: fuAnswer, source: askedSource }); continue; }
    if (check.reason === "empty") { followUps[q.key] = { text: "This one needs an answer — or tick Skip if you'd rather not answer today.", source: "rule" }; continue; }
    if (askedFu) { followUps[q.key] = { text: askedFu, source: askedSource }; continue; }
    let text = check.followUp!;
    let source: "rule" | "ai" = "rule";
    if (aiAllowed && check.reason === "vague" && aiCalls < 3) {
      aiCalls++;
      const ai = await aiFollowUpQuestion({ question: q.text, answer, context });
      if (ai) { text = ai; source = "ai"; }
    }
    followUps[q.key] = { text, source };
  }
  return { followUps, accepted };
}

type DB = Awaited<ReturnType<typeof requireUser>>["supabase"];

async function saveAnswers(db: DB, userId: string, sessionId: string, accepted: Accepted[]) {
  const rows = accepted.map((a) => ({
    user_id: userId, session_id: sessionId, question_key: a.q.key, question: a.q.text, answer: a.answer, skipped: a.skipped,
    follow_up_question: a.fuq, follow_up_answer: a.fua, follow_up_source: a.source,
  }));
  if (rows.length) {
    const { error } = await db.from("accountability_answers").upsert(rows, { onConflict: "session_id,question_key" });
    if (error) throw new Error(error.message);
  }
}

async function upsertSession(db: DB, userId: string, date: string, kind: "morning" | "midday" | "evening") {
  const { data, error } = await db.from("accountability_sessions")
    .upsert({ user_id: userId, session_date: date, kind, status: "completed", completed_at: new Date().toISOString() }, { onConflict: "user_id,session_date,kind" })
    .select("id").single();
  if (error) throw new Error(error.message);
  await db.from("reminders").update({ status: "cancelled" }).eq("entity_type", "checkin").eq("dedupe_key", `checkin:${kind}:${date}`).eq("status", "scheduled");
  return data.id as string;
}

/* ------------------------------- MORNING ------------------------------- */

interface Priority { title: string; time: string; to: string; outcome: string; effort: number | null; obstacle: string; first: string }

export async function saveMorning(prev: CheckinState, form: FormData): Promise<CheckinState> {
  const { supabase, user, profile, today } = await requireUser();
  const values = echo(form);
  const attempt = (prev?.attempt ?? 0) + 1;
  const tz = profile.timezone;

  const priorities: Priority[] = [];
  for (const i of [1, 2, 3]) {
    const title = s(form, `c${i}_title`);
    const time = s(form, `c${i}_time`);
    if (!title && !time) continue;
    if (!title) return { error: `Priority ${i} has a time but no description.`, values, attempt };
    if (!/^\d{2}:\d{2}$/.test(time)) return { error: `Set the time you will complete “${title}”.`, values, attempt };
    const outcome = s(form, `c${i}_outcome`), obstacle = s(form, `c${i}_obstacle`), first = s(form, `c${i}_first`);
    if (!outcome) return { error: `What outcome will show “${title}” is done?`, values, attempt };
    if (!first) return { error: `What is the first action for “${title}”? Something you could start in two minutes.`, values, attempt };
    const effort = s(form, `c${i}_effort`) ? Math.max(5, Math.min(600, Number(s(form, `c${i}_effort`)))) : null;
    priorities.push({ title, time, to: s(form, `c${i}_to`) || "self", outcome, effort, obstacle, first });
  }
  if (!priorities.length) return { error: "Name at least one priority for today, with the time it will be done.", values, attempt };

  // Conflicts with the existing schedule (appointments and prayer times).
  if (form.get("ack_conflicts") !== "on") {
    const events = await eventsBetween(supabase, today, today, tz);
    const { data: ps } = await supabase.from("prayer_settings").select("*").maybeSingle<PrayerSettingsRow>();
    const cfg = ps ? prayerConfig(ps, tz) : null;
    const prayers = cfg ? PRAYERS.map((p) => ({ title: PRAYER_LABEL[p], start: prayerTimesFor(today, cfg)[p] })) : [];
    const conflicts: string[] = [];
    for (const p of priorities) {
      const end = zonedToUtc(today, p.time, tz);
      const start = new Date(end.getTime() - (p.effort ?? 30) * 60_000);
      if (end.getTime() < Date.now()) conflicts.push(`“${p.title}” is due at ${p.time}, which has already passed.`);
      for (const o of events.filter((o) => !o.event.all_day)) {
        const oe = o.end ?? new Date(o.start.getTime() + 3600_000);
        if (o.start < end && oe > start) conflicts.push(`“${p.title}” (${formatInZone(start, tz, "h:mm")}–${p.time}) overlaps “${o.event.title}” at ${formatInZone(o.start, tz, "h:mm a")}.`);
      }
      for (const pr of prayers) if (pr.start >= start && pr.start < end) conflicts.push(`“${p.title}” spans ${pr.title} at ${formatInZone(pr.start, tz, "h:mm a")} — leave room for it.`);
    }
    const totalEffort = priorities.reduce((a, p) => a + (p.effort ?? 0), 0);
    if (totalEffort > 10 * 60) conflicts.push(`These priorities add up to ${Math.round(totalEffort / 60)} hours of effort. Is that realistic today?`);
    if (conflicts.length) return { error: "Your plan conflicts with your schedule. Adjust it, or tick the box to keep it as is.", conflicts, values, attempt };
  }

  const { followUps, accepted } = await reviewAnswers(form, MORNING_QUESTIONS, profile.ai_analysis_consent, `Today's priorities: ${priorities.map((c) => c.title).join("; ")}`);
  if (Object.keys(followUps).length) return { error: "A few answers need more detail.", followUps, values, attempt };

  const sessionId = await upsertSession(supabase, user.id, today, "morning");
  await saveAnswers(supabase, user.id, sessionId, accepted);
  const answer = (k: string) => { const a = accepted.find((x) => x.q.key === k); return a && !a.skipped ? [a.answer, a.fua].filter(Boolean).join(" — ") : null; };
  await supabase.from("daily_plans").upsert({
    user_id: user.id, plan_date: today, intention: s(form, "intention") || null,
    avoid_behavior: answer("avoid_behavior"), character_plan: answer("character_plan"), spiritual_intention: answer("spiritual_intention"),
  }, { onConflict: "user_id,plan_date" });

  // Re-running the morning check-in replaces today's still-open morning commitments.
  const { data: oldOpen } = await supabase.from("commitments").select("id").eq("commitment_date", today).eq("source", "morning_interview").eq("status", "open");
  for (const o of oldOpen ?? []) await supabase.from("reminders").delete().eq("entity_type", "commitment").eq("entity_id", o.id).eq("status", "scheduled");
  if (oldOpen?.length) await supabase.from("commitments").delete().in("id", oldOpen.map((o) => o.id));

  const { data: created, error } = await supabase.from("commitments").insert(priorities.map((c) => ({
    user_id: user.id, commitment_date: today, title: c.title, made_to: c.to, source: "morning_interview",
    promised_by: zonedToUtc(today, c.time, tz).toISOString(), expected_outcome: c.outcome, effort_minutes: c.effort,
    obstacles: c.obstacle || null, first_action: c.first, contingency: answer("contingency"),
  }))).select("*");
  if (error) return { error: error.message, values, attempt };
  for (const c of (created ?? []) as Commitment[]) await syncCommitmentReminders(supabase, user.id, c, tz);

  revalidatePath("/today");
  revalidatePath("/checkin");
  redirect("/today?checkin=morning");
}

/* ------------------------------- MIDDAY ------------------------------- */

export async function saveMidday(prev: CheckinState, form: FormData): Promise<CheckinState> {
  const { supabase, user, profile, today } = await requireUser();
  const values = echo(form);
  const attempt = (prev?.attempt ?? 0) + 1;
  const { followUps, accepted } = await reviewAnswers(form, MIDDAY_QUESTIONS, profile.ai_analysis_consent, "Midday check-in");
  if (Object.keys(followUps).length) return { error: "A few answers need more detail.", followUps, values, attempt };
  const sessionId = await upsertSession(supabase, user.id, today, "midday");
  await saveAnswers(supabase, user.id, sessionId, accepted);
  revalidatePath("/today");
  redirect("/today?checkin=midday");
}

/* ------------------------------- EVENING ------------------------------- */

export async function saveEvening(prev: CheckinState, form: FormData): Promise<CheckinState> {
  const { supabase, user, profile, today } = await requireUser();
  const values = echo(form);
  const attempt = (prev?.attempt ?? 0) + 1;

  const { count: openCount } = await supabase.from("commitments").select("id", { count: "exact", head: true }).eq("commitment_date", today).eq("status", "open");
  if ((openCount ?? 0) > 0) return { error: `Record each of today's commitments first — ${openCount} still open above.`, values, attempt };

  const adaptive = await adaptiveEveningQuestions(supabase, today);
  const questions = [...adaptive, ...EVENING_QUESTIONS];
  const { followUps, accepted } = await reviewAnswers(form, questions, profile.ai_analysis_consent, "Evening accountability review");
  if (Object.keys(followUps).length) return { error: "A few answers need more detail.", followUps, values, attempt };

  const sessionId = await upsertSession(supabase, user.id, today, "evening");
  await saveAnswers(supabase, user.id, sessionId, accepted);
  revalidatePath("/today");
  revalidatePath("/checkin");
  redirect("/today?checkin=evening");
}
