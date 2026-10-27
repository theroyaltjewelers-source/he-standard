import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Question } from "@/lib/interview";
import { PRAYERS, PRAYER_LABEL } from "@/lib/prayer";

/**
 * Evening questions that depend on what actually happened today. They are
 * deterministic (the same day's records produce the same questions), so the
 * page and the server action always agree on which questions exist.
 * Every adaptive question is optional: they deepen the review, never gate it.
 */
export async function adaptiveEveningQuestions(db: SupabaseClient, today: string): Promise<Question[]> {
  const [{ data: cs }, { data: plan }, { data: prayers }, { data: impulses }, { data: focus }] = await Promise.all([
    db.from("commitments").select("title,status,made_to").eq("commitment_date", today),
    db.from("daily_plans").select("avoid_behavior").eq("plan_date", today).maybeSingle(),
    db.from("prayer_confirmations").select("prayer").eq("prayer_date", today),
    db.from("impulse_logs").select("kind,outcome").gte("created_at", `${today}T00:00:00Z`),
    db.from("focus_sessions").select("status,distractions").gte("started_at", `${today}T00:00:00Z`),
  ]);
  const qs: Question[] = [];
  const broken = (cs ?? []).filter((c) => c.status === "broken");
  const brokenToOthers = broken.filter((c) => c.made_to && c.made_to !== "self");
  if (brokenToOthers.length) {
    const who = brokenToOthers[0].made_to;
    qs.push({ key: "adapt_tell_other", text: `You missed something you promised ${who}. Have you told them, and what will you offer instead?`, required: false, minWords: 4 });
  }
  if (broken.length >= 2) {
    qs.push({ key: "adapt_pattern", text: `${broken.length} commitments slipped today. Was it the plan (too much, wrong time) or the follow-through?`, required: false, minWords: 4 });
  }
  if (plan?.avoid_behavior) {
    qs.push({ key: "adapt_avoid", text: `This morning you said you would avoid: “${plan.avoid_behavior.slice(0, 120)}”. How did that go?`, required: false, minWords: 3 });
  }
  const confirmed = new Set((prayers ?? []).map((p) => p.prayer));
  const unconfirmed = PRAYERS.filter((p) => !confirmed.has(p) && p !== "isha");
  if (confirmed.size > 0 && unconfirmed.length) {
    qs.push({ key: "adapt_prayer", text: `${unconfirmed.map((p) => PRAYER_LABEL[p]).join(", ")} ${unconfirmed.length > 1 ? "are" : "is"} not confirmed yet. If you prayed, confirm it on Faith; if not, what got in the way?`, required: false, minWords: 0 });
  }
  const acted = (impulses ?? []).filter((i) => i.outcome === "acted");
  if (acted.length) qs.push({ key: "adapt_impulse", text: "You logged an urge you acted on. What would have made the pause easier?", required: false, minWords: 3 });
  const distractions = (focus ?? []).reduce((n, f) => n + (Array.isArray(f.distractions) ? f.distractions.length : 0), 0);
  if (distractions >= 3) qs.push({ key: "adapt_focus", text: `Your focus sessions logged ${distractions} distractions. Which one could you remove tomorrow before you start?`, required: false, minWords: 3 });
  return qs;
}
