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
    user_id: user.id, kind: "self_report", content, source_type: "user", user_edited: true,
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
  await supabase.from("ai_memory").update({ status }).eq("id", s(form, "id"));
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
  "ai_memory", "ai_observations", "weekly_reviews",
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
