"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { GOAL_AREAS } from "@/lib/types";

export type GoalState = { error?: string; ok?: boolean } | undefined;
const s = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");

const goalSchema = z.object({
  id: z.uuid().or(z.literal("")),
  title: z.string().min(1, "Name the goal.").max(200),
  horizon: z.enum(["long_term", "monthly", "weekly"]),
  area: z.enum(GOAL_AREAS.map((a) => a.key) as [string, ...string[]]),
  desired_outcome: z.string().min(10, "Describe the specific outcome in a sentence."),
  success_criteria: z.string().min(5, "How will you measure success? Be specific — a number, a date, a deliverable."),
  target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")),
  obstacles: z.string().max(4000),
  recovery_plan: z.string().max(4000),
  parent_goal_id: z.uuid().or(z.literal("")),
});

export async function saveGoal(_: GoalState, form: FormData): Promise<GoalState> {
  const { supabase, user } = await requireUser();
  const parsed = goalSchema.safeParse(Object.fromEntries(
    ["id", "title", "horizon", "area", "desired_outcome", "success_criteria", "target_date", "obstacles", "recovery_plan", "parent_goal_id"]
      .map((k) => [k, s(form, k)]),
  ));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { id, ...d } = parsed.data;
  const row = { ...d, user_id: user.id, target_date: d.target_date || null, obstacles: d.obstacles || null, recovery_plan: d.recovery_plan || null, parent_goal_id: d.parent_goal_id || null };
  const { data, error } = id
    ? await supabase.from("goals").update(row).eq("id", id).select("id").single()
    : await supabase.from("goals").insert(row).select("id").single();
  if (error) return { error: error.message };
  revalidatePath("/goals");
  revalidatePath("/progress");
  revalidatePath("/rhythm");
  revalidatePath("/today");
  redirect(`/goals/${data.id}`);
}

export async function setGoalStatus(form: FormData) {
  const { supabase } = await requireUser();
  const status = s(form, "status");
  if (!["active", "paused", "achieved", "abandoned"].includes(status)) return;
  await supabase.from("goals").update({ status }).eq("id", s(form, "id"));
  revalidatePath("/goals");
  revalidatePath("/progress");
  revalidatePath("/rhythm");
  revalidatePath(`/goals/${s(form, "id")}`);
}

export async function deleteGoal(form: FormData) {
  const { supabase } = await requireUser();
  await supabase.from("goals").delete().eq("id", s(form, "id"));
  revalidatePath("/goals");
  revalidatePath("/progress");
  revalidatePath("/rhythm");
  redirect("/goals");
}

export async function addProgress(_: GoalState, form: FormData): Promise<GoalState> {
  const { supabase, user } = await requireUser();
  const note = s(form, "note");
  if (note.length < 5) return { error: "Describe what changed." };
  const pctRaw = s(form, "progress_pct");
  const pct = pctRaw === "" ? null : Math.max(0, Math.min(100, Number(pctRaw)));
  const { error } = await supabase.from("goal_progress").insert({
    user_id: user.id, goal_id: s(form, "goal_id"), note, evidence: s(form, "evidence") || null, progress_pct: pct,
  });
  if (error) return { error: error.message };
  revalidatePath(`/goals/${s(form, "goal_id")}`);
  revalidatePath("/today");
  return { ok: true };
}

/* ------------------------------ habits ------------------------------ */

export async function createHabit(_: GoalState, form: FormData): Promise<GoalState> {
  const { supabase, user } = await requireUser();
  const title = s(form, "title");
  if (!title) return { error: "Name the habit." };
  const target = Math.max(1, Math.min(7, Number(s(form, "target_per_week") || 7)));
  const rest = form.getAll("rest_days").map(Number).filter((n) => n >= 0 && n <= 6);
  const { error } = await supabase.from("habits").insert({
    user_id: user.id, title, area: s(form, "area") || "general", target_per_week: target, rest_days: rest,
    goal_id: s(form, "goal_id") || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/goals");
  revalidatePath("/progress");
  revalidatePath("/rhythm");
  revalidatePath("/today");
  return { ok: true };
}

export async function logHabit(form: FormData) {
  const { supabase, user, today } = await requireUser();
  const habit_id = s(form, "habit_id");
  const date = s(form, "date") || today;
  const status = s(form, "status");
  if (status === "clear") {
    await supabase.from("habit_logs").delete().eq("habit_id", habit_id).eq("log_date", date);
  } else if (["done", "skipped", "rest"].includes(status)) {
    await supabase.from("habit_logs").upsert({ user_id: user.id, habit_id, log_date: date, status }, { onConflict: "habit_id,log_date" });
  }
  revalidatePath("/today");
  revalidatePath("/goals");
  revalidatePath("/progress");
  revalidatePath("/rhythm");
}

export async function archiveHabit(form: FormData) {
  const { supabase } = await requireUser();
  await supabase.from("habits").update({ active: s(form, "active") === "true" }).eq("id", s(form, "id"));
  revalidatePath("/goals");
  revalidatePath("/progress");
  revalidatePath("/rhythm");
  revalidatePath("/today");
}
