"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { syncCommitmentReminders, syncTaskReminders } from "@/lib/reminders";
import { shiftDate, zonedToUtc } from "@/lib/time";
import type { Commitment, Task } from "@/lib/types";

export type ActionState = { error?: string; ok?: boolean } | undefined;

function refresh() {
  revalidatePath("/today");
  revalidatePath("/tasks");
  revalidatePath("/word");
  revalidatePath("/checkin/evening");
}

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v.trim() : "";
};

const taskSchema = z.object({
  title: z.string().min(1, "Give the task a name.").max(200),
  notes: z.string().max(4000),
  scheduled_for: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")),
  due_time: z.string().regex(/^\d{2}:\d{2}$/).or(z.literal("")),
  priority: z.coerce.number().int().min(1).max(3),
  goal_id: z.uuid().or(z.literal("")),
  is_top_priority: z.boolean(),
});

export async function createTask(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, user, profile, today } = await requireUser();
  const parsed = taskSchema.safeParse({
    title: str(form, "title"), notes: str(form, "notes"), scheduled_for: str(form, "scheduled_for") || today,
    due_time: str(form, "due_time"), priority: str(form, "priority") || 2, goal_id: str(form, "goal_id"),
    is_top_priority: form.get("is_top_priority") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  if (d.is_top_priority) {
    const { count } = await supabase.from("tasks").select("id", { count: "exact", head: true })
      .eq("scheduled_for", d.scheduled_for).eq("is_top_priority", true).neq("status", "cancelled");
    if ((count ?? 0) >= 3) return { error: "You already have three priorities for that day. Three is the limit — choose which matters most." };
  }
  const due_at = d.due_time && d.scheduled_for ? zonedToUtc(d.scheduled_for, d.due_time, profile.timezone).toISOString() : null;
  const { data, error } = await supabase.from("tasks").insert({
    user_id: user.id, title: d.title, notes: d.notes || null, scheduled_for: d.scheduled_for || null,
    due_at, priority: d.priority, goal_id: d.goal_id || null, is_top_priority: d.is_top_priority,
  }).select("*").single<Task>();
  if (error) return { error: error.message };
  await syncTaskReminders(supabase, user.id, data, profile.timezone);
  refresh();
  return { ok: true };
}

export async function completeTask(form: FormData) {
  const { supabase, user, profile } = await requireUser();
  const id = str(form, "id");
  const evidence = str(form, "evidence");
  const { data } = await supabase.from("tasks").update({
    status: "done", completed_at: new Date().toISOString(),
    verification: evidence ? "evidence" : "self_reported", evidence: evidence || null, miss_reason: null,
  }).eq("id", id).select("*").single<Task>();
  if (data) await syncTaskReminders(supabase, user.id, data, profile.timezone);
  refresh();
}

/**
 * Checklist toggle used by the interactive checkbox. Returns only after the
 * database has confirmed the change, so the UI never shows a completion that
 * wasn't saved.
 */
export async function setTaskDone(id: string, done: boolean): Promise<{ ok?: true; error?: string }> {
  const { supabase, user, profile } = await requireUser();
  const patch = done
    ? { status: "done", completed_at: new Date().toISOString(), verification: "self_reported", miss_reason: null }
    : { status: "pending", completed_at: null, verification: "none", evidence: null, miss_reason: null };
  const { data, error } = await supabase.from("tasks").update(patch).eq("id", id).select("*").maybeSingle<Task>();
  if (error) return { error: error.message };
  if (!data) return { error: "That task no longer exists." };
  await syncTaskReminders(supabase, user.id, data, profile.timezone);
  refresh();
  return { ok: true };
}

export async function missTask(form: FormData) {
  const { supabase, user, profile } = await requireUser();
  const { data } = await supabase.from("tasks").update({
    status: "missed", miss_reason: str(form, "reason") || null, completed_at: null, verification: "none",
  }).eq("id", str(form, "id")).select("*").single<Task>();
  if (data) await syncTaskReminders(supabase, user.id, data, profile.timezone);
  refresh();
}

export async function reopenTask(form: FormData) {
  const { supabase, user, profile } = await requireUser();
  const { data } = await supabase.from("tasks").update({
    status: "pending", completed_at: null, verification: "none", evidence: null, miss_reason: null,
  }).eq("id", str(form, "id")).select("*").single<Task>();
  if (data) await syncTaskReminders(supabase, user.id, data, profile.timezone);
  refresh();
}

/** Move a task to another day. Counted, because repeated postponement is a pattern worth seeing. */
export async function postponeTask(form: FormData) {
  const { supabase, user, profile, today } = await requireUser();
  const id = str(form, "id");
  const to = str(form, "to") || shiftDate(today, 1);
  const { data: t } = await supabase.from("tasks").select("*").eq("id", id).single<Task>();
  if (!t) return;
  let due_at = t.due_at;
  if (t.due_at && t.scheduled_for) {
    const days = Math.round((Date.parse(to) - Date.parse(t.scheduled_for)) / 864e5);
    due_at = new Date(Date.parse(t.due_at) + days * 864e5).toISOString();
  }
  const { data } = await supabase.from("tasks").update({
    scheduled_for: to, due_at, postponed_count: t.postponed_count + 1, is_top_priority: false,
  }).eq("id", id).select("*").single<Task>();
  if (data) await syncTaskReminders(supabase, user.id, data, profile.timezone);
  refresh();
}

export async function toggleTopPriority(form: FormData) {
  const { supabase } = await requireUser();
  const id = str(form, "id");
  const { data: t } = await supabase.from("tasks").select("is_top_priority,scheduled_for").eq("id", id).single();
  if (!t) return;
  if (!t.is_top_priority) {
    const { count } = await supabase.from("tasks").select("id", { count: "exact", head: true })
      .eq("scheduled_for", t.scheduled_for).eq("is_top_priority", true).neq("status", "cancelled");
    if ((count ?? 0) >= 3) return;
  }
  await supabase.from("tasks").update({ is_top_priority: !t.is_top_priority }).eq("id", id);
  refresh();
}

export async function deleteTask(form: FormData) {
  const { supabase } = await requireUser();
  await supabase.from("tasks").delete().eq("id", str(form, "id"));
  refresh();
}

/* --------------------------- commitments --------------------------- */

const commitmentSchema = z.object({
  title: z.string().min(1, "Describe the commitment.").max(200),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Set the time it will be done by."),
  made_to: z.string().max(80),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function createCommitment(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, user, profile, today } = await requireUser();
  const parsed = commitmentSchema.safeParse({
    title: str(form, "title"), time: str(form, "time"), made_to: str(form, "made_to") || "self", date: str(form, "date") || today,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  const { data, error } = await supabase.from("commitments").insert({
    user_id: user.id, commitment_date: d.date, title: d.title, made_to: d.made_to,
    promised_by: zonedToUtc(d.date, d.time, profile.timezone).toISOString(), source: "manual",
  }).select("*").single<Commitment>();
  if (error) return { error: error.message };
  await syncCommitmentReminders(supabase, user.id, data, profile.timezone);
  refresh();
  return { ok: true };
}

const resolveSchema = z.object({
  id: z.uuid(),
  status: z.enum(["kept", "kept_late", "broken", "released", "open"]),
  evidence: z.string().max(2000),
  failure_context: z.string().max(2000),
});

export async function resolveCommitment(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, user, profile } = await requireUser();
  const parsed = resolveSchema.safeParse({
    id: str(form, "id"), status: str(form, "status"), evidence: str(form, "evidence"), failure_context: str(form, "failure_context"),
  });
  if (!parsed.success) return { error: "Choose what happened." };
  const d = parsed.data;
  if (d.status === "broken" && d.failure_context.split(/\s+/).filter(Boolean).length < 4) {
    return { error: "Say what happened immediately before — a sentence is enough." };
  }
  const kept = d.status === "kept" || d.status === "kept_late";
  const { data, error } = await supabase.from("commitments").update({
    status: d.status,
    resolved_at: d.status === "open" ? null : new Date().toISOString(),
    verification: kept ? (d.evidence ? "evidence" : "self_reported") : "none",
    evidence: kept ? d.evidence || null : null,
    failure_context: d.status === "broken" ? d.failure_context : null,
  }).eq("id", d.id).select("*").single<Commitment>();
  if (error) return { error: error.message };
  await syncCommitmentReminders(supabase, user.id, data, profile.timezone);
  refresh();
  return { ok: true };
}
