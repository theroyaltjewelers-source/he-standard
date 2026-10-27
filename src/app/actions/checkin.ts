"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { checkAnswer, EVENING_QUESTIONS, MORNING_QUESTIONS, wordCount, type Question } from "@/lib/interview";
import { aiFollowUpQuestion } from "@/lib/ai";
import { syncCommitmentReminders } from "@/lib/reminders";
import { zonedToUtc } from "@/lib/time";
import type { Commitment } from "@/lib/types";

export interface CheckinState {
  error?: string;
  /** Follow-up questions to show, keyed by question key. */
  followUps?: Record<string, { text: string; source: "rule" | "ai" }>;
  /** Echo of submitted values so nothing typed is lost. */
  values?: Record<string, string>;
  attempt?: number;
}

const s = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");

function echo(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  form.forEach((v, k) => {
    if (typeof v === "string" && !k.startsWith("$")) out[k] = v;
  });
  return out;
}

/**
 * Validates answers. A required answer that is empty, too short or vague
 * produces a follow-up question; the user's answer to that follow-up then
 * satisfies it. The follow-up question and answer are stored together.
 */
async function reviewAnswers(form: FormData, questions: Question[], aiAllowed: boolean, context: string) {
  const followUps: NonNullable<CheckinState["followUps"]> = {};
  const accepted: { q: Question; answer: string; fuq: string | null; fua: string | null; source: "rule" | "ai" | null }[] = [];
  let aiCalls = 0;

  for (const q of questions) {
    const answer = s(form, q.key);
    const askedFu = s(form, `fuq_${q.key}`);
    const fuAnswer = s(form, `fu_${q.key}`);
    const askedSource = (s(form, `fus_${q.key}`) || "rule") as "rule" | "ai";
    const check = checkAnswer(q, answer);

    if (check.ok) {
      accepted.push({ q, answer, fuq: askedFu && fuAnswer ? askedFu : null, fua: askedFu && fuAnswer ? fuAnswer : null, source: askedFu && fuAnswer ? askedSource : null });
      continue;
    }
    if (check.reason !== "empty" && askedFu && wordCount(fuAnswer) >= 3) {
      accepted.push({ q, answer, fuq: askedFu, fua: fuAnswer, source: askedSource });
      continue;
    }
    if (check.reason === "empty") {
      followUps[q.key] = { text: check.followUp!, source: "rule" };
      continue;
    }
    // Keep the same follow-up if one was already asked, so the question doesn't shift under the user.
    if (askedFu) {
      followUps[q.key] = { text: askedFu, source: askedSource };
      continue;
    }
    let text = check.followUp!;
    let source: "rule" | "ai" = "rule";
    if (aiAllowed && check.reason === "vague" && aiCalls < 3) {
      aiCalls++;
      const ai = await aiFollowUpQuestion({ question: q.text, answer, context });
      if (ai) {
        text = ai;
        source = "ai";
      }
    }
    followUps[q.key] = { text, source };
  }
  return { followUps, accepted };
}

async function saveAnswers(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  userId: string,
  sessionId: string,
  accepted: Awaited<ReturnType<typeof reviewAnswers>>["accepted"],
) {
  const rows = accepted
    .filter((a) => a.answer || a.fua)
    .map((a) => ({
      user_id: userId, session_id: sessionId, question_key: a.q.key, question: a.q.text, answer: a.answer,
      follow_up_question: a.fuq, follow_up_answer: a.fua, follow_up_source: a.source,
    }));
  if (rows.length) {
    const { error } = await supabase.from("accountability_answers").upsert(rows, { onConflict: "session_id,question_key" });
    if (error) throw new Error(error.message);
  }
}

async function upsertSession(supabase: Awaited<ReturnType<typeof requireUser>>["supabase"], userId: string, date: string, kind: "morning" | "evening") {
  const { data, error } = await supabase
    .from("accountability_sessions")
    .upsert({ user_id: userId, session_date: date, kind, status: "completed", completed_at: new Date().toISOString() }, { onConflict: "user_id,session_date,kind" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

/* ------------------------------- MORNING ------------------------------- */

export async function saveMorning(prev: CheckinState, form: FormData): Promise<CheckinState> {
  const { supabase, user, profile, today } = await requireUser();
  const values = echo(form);
  const attempt = (prev?.attempt ?? 0) + 1;

  const commitments: { title: string; time: string; to: string }[] = [];
  for (const i of [1, 2, 3]) {
    const title = s(form, `c${i}_title`);
    const time = s(form, `c${i}_time`);
    if (!title && !time) continue;
    if (!title) return { error: `Commitment ${i} has a time but no description.`, values, attempt };
    if (!/^\d{2}:\d{2}$/.test(time)) return { error: `Set the time you will complete “${title}”.`, values, attempt };
    commitments.push({ title, time, to: s(form, `c${i}_to`) || "self" });
  }
  if (!commitments.length) return { error: "Name at least one commitment for today, with the time it will be done.", values, attempt };

  const aiAllowed = profile.ai_analysis_consent;
  const { followUps, accepted } = await reviewAnswers(form, MORNING_QUESTIONS, aiAllowed, `Today's commitments: ${commitments.map((c) => c.title).join("; ")}`);
  if (Object.keys(followUps).length) {
    return { error: "A few answers need more detail.", followUps, values, attempt };
  }

  const sessionId = await upsertSession(supabase, user.id, today, "morning");
  await saveAnswers(supabase, user.id, sessionId, accepted);

  const answer = (k: string) => {
    const a = accepted.find((x) => x.q.key === k);
    return a ? [a.answer, a.fua].filter(Boolean).join(" — ") : null;
  };
  await supabase.from("daily_plans").upsert({
    user_id: user.id, plan_date: today, intention: s(form, "intention") || null,
    avoid_behavior: answer("avoid_behavior"), character_plan: answer("character_plan"), spiritual_intention: answer("spiritual_intention"),
  }, { onConflict: "user_id,plan_date" });

  // Re-running the morning check-in replaces today's still-open morning commitments.
  const { data: oldOpen } = await supabase.from("commitments").select("id")
    .eq("commitment_date", today).eq("source", "morning_interview").eq("status", "open");
  for (const o of oldOpen ?? []) {
    await supabase.from("reminders").delete().eq("entity_type", "commitment").eq("entity_id", o.id).eq("status", "scheduled");
  }
  if (oldOpen?.length) await supabase.from("commitments").delete().in("id", oldOpen.map((o) => o.id));

  const { data: created, error } = await supabase.from("commitments").insert(
    commitments.map((c) => ({
      user_id: user.id, commitment_date: today, title: c.title, made_to: c.to, source: "morning_interview",
      promised_by: zonedToUtc(today, c.time, profile.timezone).toISOString(),
      obstacles: answer("obstacles"), contingency: answer("contingency"),
    })),
  ).select("*");
  if (error) return { error: error.message, values, attempt };
  for (const c of (created ?? []) as Commitment[]) await syncCommitmentReminders(supabase, user.id, c, profile.timezone);

  await supabase.from("reminders").update({ status: "cancelled" })
    .eq("entity_type", "checkin").eq("dedupe_key", `checkin:morning:${today}`).eq("status", "scheduled");

  revalidatePath("/today");
  revalidatePath("/checkin");
  redirect("/today?checkin=morning");
}

/* ------------------------------- EVENING ------------------------------- */

export async function saveEvening(prev: CheckinState, form: FormData): Promise<CheckinState> {
  const { supabase, user, profile, today } = await requireUser();
  const values = echo(form);
  const attempt = (prev?.attempt ?? 0) + 1;

  const { count: openCount } = await supabase.from("commitments").select("id", { count: "exact", head: true })
    .eq("commitment_date", today).eq("status", "open");
  if ((openCount ?? 0) > 0) {
    return { error: `Resolve each of today's commitments first — ${openCount} still open above.`, values, attempt };
  }

  const { followUps, accepted } = await reviewAnswers(form, EVENING_QUESTIONS, profile.ai_analysis_consent, "Evening accountability review");
  if (Object.keys(followUps).length) {
    return { error: "A few answers need more detail.", followUps, values, attempt };
  }

  const sessionId = await upsertSession(supabase, user.id, today, "evening");
  await saveAnswers(supabase, user.id, sessionId, accepted);
  // The evening review answers its own reminder.
  await supabase.from("reminders").update({ status: "cancelled" })
    .eq("entity_type", "checkin").eq("dedupe_key", `checkin:evening:${today}`).eq("status", "scheduled");

  revalidatePath("/today");
  revalidatePath("/checkin");
  redirect("/today?checkin=evening");
}
