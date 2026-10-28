"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";

const s = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
export type DataState = { error?: string; ok?: string } | undefined;

/* ----------------------------- AI memory ----------------------------- */

export async function addMemory(_: DataState, form: FormData): Promise<DataState> {
  const { supabase, user } = await requireUser();
  const content = s(form, "content");
  if (content.length < 3) return { error: "Write the fact you want the coach to know." };
  const { error } = await supabase.from("ai_memory").insert({
    user_id: user.id, kind: "self_report", evidence_status: "self_reported", content, source_type: "user", user_edited: true,
  });
  if (error) return { error: error.message };
  revalidatePath("/settings/memory");
  return { ok: "Saved." };
}

export async function updateMemory(form: FormData) {
  const { supabase } = await requireUser();
  const content = s(form, "content");
  if (content.length < 3) return;
  await supabase.from("ai_memory").update({ content, user_edited: true }).eq("id", s(form, "id"));
  revalidatePath("/settings/memory");
}

export async function setMemoryStatus(form: FormData) {
  const { supabase } = await requireUser();
  const status = s(form, "status");
  if (!["active", "rejected", "archived"].includes(status)) return;
  const { data } = await supabase.from("ai_memory").update({ status }).eq("id", s(form, "id")).select("id,user_id,status").maybeSingle();
  if (data) await createAdminClient().from("audit_logs").insert({ user_id: data.user_id, actor: "user", action: `memory.${status === "active" ? "approved" : status}`, entity_type: "ai_memory", entity_id: data.id });
  revalidatePath("/settings/memory");
}

export async function deleteMemory(form: FormData) {
  const { supabase } = await requireUser();
  await supabase.from("ai_memory").delete().eq("id", s(form, "id"));
  revalidatePath("/settings/memory");
}

export async function deleteAllMemory(form: FormData) {
  const { supabase, user } = await requireUser();
  if (s(form, "confirm") !== "DELETE") return;
  await supabase.from("ai_memory").delete().eq("user_id", user.id);
  await supabase.from("ai_observations").delete().eq("user_id", user.id);
  revalidatePath("/settings/memory");
}

/* --------------------------- erase & delete --------------------------- */

const CONTENT_TABLES = [
  "notifications", "reminders", "accountability_answers", "accountability_sessions", "daily_plans",
  "journal_entries", "commitments", "habit_logs", "habits", "tasks", "goal_progress", "goals", "events",
  "ai_memory_sources", "ai_memory", "ai_observations", "weekly_reports",
  "goal_milestones", "prayer_confirmations", "prayer_schedules", "spiritual_logs", "verse_reflections",
  "focus_sessions", "impulse_logs", "financial_entries", "ai_tool_executions", "ai_messages", "ai_conversations",
  "calendar_sync_state", "audit_logs", "workout_sets", "workout_exercises", "workout_logs", "activity_occurrences", "notification_action_log",
  "body_metrics", "food_entries", "task_series", "daily_scores", "sync_outbox",
  "record_revisions", // last: erasing the records above writes revisions that must go too
] as const;

/** Removes every record but keeps the account and settings. */
export async function eraseAllData(_: DataState, form: FormData): Promise<DataState> {
  const { supabase, user } = await requireUser();
  if (s(form, "confirm") !== "ERASE") return { error: "Type ERASE to confirm." };
  for (const t of CONTENT_TABLES) {
    const { error } = await supabase.from(t).delete().eq("user_id", user.id);
    if (error) return { error: `Stopped at ${t}: ${error.message}. Nothing after it was erased; try again.` };
  }
  revalidatePath("/", "layout");
  return { ok: "All records erased. Your account and settings remain." };
}

/** Deletes the auth account; every table cascades from auth.users. */
export async function deleteAccount(_: DataState, form: FormData): Promise<DataState> {
  const { supabase, user } = await requireUser({ allowIncomplete: true });
  if (s(form, "confirm") !== user.email) return { error: "Type your email address exactly to confirm." };
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return { error: `Account not deleted: ${error.message}` };
  await supabase.auth.signOut();
  redirect("/login?deleted=1");
}
