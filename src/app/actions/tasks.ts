"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { syncCommitmentReminders, syncTaskReminders } from "@/lib/reminders";
import { shiftDate, zonedToUtc } from "@/lib/time";
import { generateSeries } from "@/lib/rollover";
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
  repeat: z.enum(["none", "daily", "weekdays", "weekly", "monthly"]),
});

export async function createTask(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, user, profile, today } = await requireUser();
  const parsed = taskSchema.safeParse({
    title: str(form, "title"), notes: str(form, "notes"), scheduled_for: str(form, "scheduled_for") || today,
    due_time: str(form, "due_time"), priority: str(form, "priority") || 2, goal_id: str(form, "goal_id"),
    is_top_priority: form.get("is_top_priority") === "on",
    repeat: str(form, "repeat") || "none",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  if (d.repeat !== "none") {
    // A repeating task is a series; each day gets its own record (history never resets).
    const startsOn = d.scheduled_for || today;
    const { data: series, error: sErr } = await supabase.from("task_series").insert({
      user_id: user.id, title: d.title, notes: d.notes || null, goal_id: d.goal_id || null, recurrence: d.repeat,
      weekdays: d.repeat === "weekly" ? [new Date(`${startsOn}T12:00:00Z`).getUTCDay()] : [],
      due_time: d.due_time || null, timezone: profile.timezone, starts_on: startsOn, priority: d.priority, is_top_priority: d.is_top_priority,
    }).select("id").single();
    if (sErr) return { error: sErr.message };
    await generateSeries(supabase, user.id, today, profile.timezone, series.id);
    refresh();
    return { ok: true };
  }
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
  const { supabase, user, profile, today } = await requireUser();
  const id = str(form, "id");
  const evidence = str(form, "evidence");
  const { data: before } = await supabase.from("tasks").select("scheduled_for").eq("id", id).maybeSingle();
  const { data } = await supabase.from("tasks").update({
    status: "done", completed_at: new Date().toISOString(),
    verification: evidence ? "evidence" : "self_reported", evidence: evidence || null, miss_reason: null,
    confirmed_at: new Date().toISOString(), retrospective: !!before?.scheduled_for && before.scheduled_for < today,
  }).eq("id", id).select("*").single<Task>();
  if (data) await syncTaskReminders(supabase, user.id, data, profile.timezone);
  refresh();
}

/**
 * Checklist toggle used by the interactive checkbox. Returns only after the
 * database has confirmed the change, so the UI never shows a completion that
 * wasn't saved.
 */
export async function setTaskDone(id: string, done: boolean): Promise<{ ok?: true; error?: string; retrospective?: boolean }> {
  const { supabase, user, profile, today } = await requireUser();
  const { data: before } = await supabase.from("tasks").select("scheduled_for").eq("id", id).maybeSingle();
  const retrospective = done && !!before?.scheduled_for && before.scheduled_for < today;
  const patch = done
    ? { status: "done", completed_at: new Date().toISOString(), verification: "self_reported", miss_reason: null, confirmed_at: new Date().toISOString(), retrospective }
    : { status: "pending", completed_at: null, verification: "none", evidence: null, miss_reason: null, confirmed_at: null, retrospective: false };
  const { data, error } = await supabase.from("tasks").update(patch).eq("id", id).select("*").maybeSingle<Task>();
  if (error) return { error: error.message };
  if (!data) return { error: "That task no longer exists." };
  await syncTaskReminders(supabase, user.id, data, profile.timezone);
  refresh();
  return { ok: true, retrospective };
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
    original_scheduled_for: t.original_scheduled_for ?? t.scheduled_for, original_due_at: t.original_due_at ?? t.due_at,
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

/** Pause, resume or end a repeating task. Past occurrences are never touched. */
export async function setSeriesActive(form: FormData) {
  const { supabase, user, profile, today } = await requireUser();
  const id = str(form, "id");
  const active = str(form, "active") === "true";
  await supabase.from("task_series").update({ active, ...(active ? { last_generated_on: null } : {}) }).eq("id", id);
  if (!active) {
    // Remove only future, untouched occurrences; today's and earlier stay as recorded.
    const { data: future } = await supabase.from("tasks").select("id").eq("series_id", id).gt("scheduled_for", today).eq("status", "pending");
    for (const t of future ?? []) await supabase.from("reminders").delete().eq("entity_type", "task").eq("entity_id", t.id).eq("status", "scheduled");
    if (future?.length) await supabase.from("tasks").delete().in("id", future.map((t) => t.id));
  } else {
    await generateSeries(supabase, user.id, today, profile.timezone, id);
  }
  refresh();
}

export interface TaskDetail {
  task: Task;
  goal: string | null;
  series: { recurrence: string; due_time: string | null } | null;
  reminders: { send_at: string; title: string; status: string }[];
  history: { at: string; op: string; actor: string; changes: { field: string; from: unknown; to: unknown }[] }[];
  seriesHistory: { date: string; status: string; retrospective: boolean }[];
}

/** Everything the task detail panel shows, read under RLS. */
export async function getTaskDetail(id: string): Promise<TaskDetail | { error: string }> {
  const { supabase } = await requireUser();
  const { data: task } = await supabase.from("tasks").select("*").eq("id", id).maybeSingle<Task>();
  if (!task) return { error: "That task no longer exists." };
  const [{ data: goal }, { data: series }, { data: rem }, { data: rev }, { data: siblings }] = await Promise.all([
    task.goal_id ? supabase.from("goals").select("title").eq("id", task.goal_id).maybeSingle() : Promise.resolve({ data: null }),
    task.series_id ? supabase.from("task_series").select("recurrence,due_time").eq("id", task.series_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("reminders").select("send_at,title,status").eq("entity_type", "task").eq("entity_id", id).order("send_at").limit(20),
    supabase.from("record_revisions").select("created_at,op,actor,before,after").eq("record_id", id).order("created_at", { ascending: false }).limit(30),
    task.series_id ? supabase.from("tasks").select("occurrence_date,status,retrospective").eq("series_id", task.series_id).order("occurrence_date", { ascending: false }).limit(14) : Promise.resolve({ data: [] }),
  ]);
  const HIDE = new Set(["id", "user_id", "created_at", "updated_at", "series_id", "occurrence_date", "confirmed_at"]);
  return {
    task,
    goal: (goal as { title: string } | null)?.title ?? null,
    series: (series as TaskDetail["series"]) ?? null,
    reminders: (rem ?? []) as TaskDetail["reminders"],
    history: (rev ?? []).map((r) => ({
      at: r.created_at, op: r.op, actor: r.actor === "system" ? "System" : "You",
      changes: Object.keys({ ...(r.before ?? {}), ...(r.after ?? {}) }).filter((k) => !HIDE.has(k)).map((k) => ({ field: k, from: r.before?.[k] ?? null, to: r.after?.[k] ?? null })),
    })),
    seriesHistory: ((siblings ?? []) as { occurrence_date: string; status: string; retrospective: boolean }[]).map((x) => ({ date: x.occurrence_date, status: x.status, retrospective: x.retrospective })),
  };
}

export async function startTask(id: string): Promise<{ ok?: true; error?: string }> {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("tasks").update({ started_at: new Date().toISOString() }).eq("id", id).is("started_at", null);
  if (error) return { error: error.message };
  refresh();
  return { ok: true };
}

export async function saveTaskNotes(id: string, notes: string): Promise<{ ok?: true; error?: string }> {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("tasks").update({ notes: notes.slice(0, 4000) || null }).eq("id", id);
  if (error) return { error: error.message };
  refresh();
  return { ok: true };
}
