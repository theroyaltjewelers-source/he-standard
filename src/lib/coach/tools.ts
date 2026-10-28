import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolve } from "./match";
import { dayBoundsUtc, dayOfWeek, formatInZone, localDateString, shiftDate, zonedToUtc } from "../time";
import { eventsBetween } from "../records";
import { prepPlan } from "../scheduling";
import { cancelFutureReminders, insertRows, prayerConfig, syncCommitmentReminders, syncEventReminders, syncTaskReminders, type PrayerSettingsRow } from "../reminders";
import { PRAYERS, PRAYER_LABEL, prayerTimesFor } from "../prayer";
import { deleteRemote, isConnected, pullChanges, pushEvent } from "../google";
import type { CalendarEvent, Commitment, Task } from "../types";

/**
 * THE COACH — tool registry.
 *
 * The model never touches the database directly. Each tool:
 *  - validates its input with a strict schema,
 *  - runs with the signed-in user's RLS-scoped client (userId is never taken from model input),
 *  - returns the ACTUAL result of the database operation,
 *  - declares whether it needs confirmation (destructive, calendar-changing, large or ambiguous),
 *  - returns undo data where reversal is feasible.
 */

export interface ToolContext {
  db: SupabaseClient;          // user-scoped (RLS)
  admin: SupabaseClient;       // service role — only for Google token access and audit writes
  userId: string;
  tz: string;
  today: string;
  aiConsent: boolean;
}

export interface ToolOutcome {
  ok: boolean;
  /** What the model and the UI see. Must reflect what actually happened. */
  result: Record<string, unknown>;
  summary: string;
  undo?: { tool: string; input: Record<string, unknown> } | null;
  entity?: { type: string; id: string };
}

export interface ToolDef<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  schema: S;
  kind: "read" | "write";
  /** Return a reason string when the user must confirm before execution. */
  confirm?: (input: z.infer<S>, ctx: ToolContext) => Promise<string | null> | string | null;
  /** One-line description of the pending action for confirmation cards. */
  describe?: (input: z.infer<S>, ctx: ToolContext) => Promise<string> | string;
  run: (input: z.infer<S>, ctx: ToolContext) => Promise<ToolOutcome>;
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Local date YYYY-MM-DD in the user's time zone");
const time = z.string().regex(/^\d{2}:\d{2}$/).describe("Local 24-hour time HH:mm");

const ok = (summary: string, result: Record<string, unknown>, extra: Partial<ToolOutcome> = {}): ToolOutcome => ({ ok: true, summary, result, ...extra });
const fail = (summary: string, result: Record<string, unknown> = {}): ToolOutcome => ({ ok: false, summary, result: { error: summary, ...result } });
const fmt = (iso: string | Date, tz: string, p = "EEE MMM d, h:mm a") => formatInZone(iso, tz, p);

function taskView(t: Task, tz: string) {
  return { id: t.id, title: t.title, status: t.status, date: t.scheduled_for, due: t.due_at ? fmt(t.due_at, tz) : null, top_priority: t.is_top_priority, postponed: t.postponed_count, verification: t.verification };
}
function commitmentView(c: Commitment, tz: string) {
  return { id: c.id, title: c.title, status: c.status, date: c.commitment_date, promised_by: c.promised_by ? fmt(c.promised_by, tz) : null, made_to: c.made_to };
}

async function findOpenItems(ctx: ToolContext, query: string) {
  const from = shiftDate(ctx.today, -7), to = shiftDate(ctx.today, 7);
  const [{ data: tasks }, { data: commitments }] = await Promise.all([
    ctx.db.from("tasks").select("*").eq("status", "pending").or(`scheduled_for.gte.${from},scheduled_for.is.null`).lte("scheduled_for", to),
    ctx.db.from("commitments").select("*").eq("status", "open").gte("commitment_date", from).lte("commitment_date", to),
  ]);
  const items = [
    ...((tasks ?? []) as Task[]).map((t) => ({ type: "task" as const, id: t.id, title: t.title, date: t.scheduled_for, raw: t })),
    ...((commitments ?? []) as Commitment[]).map((c) => ({ type: "commitment" as const, id: c.id, title: c.title, date: c.commitment_date, raw: c })),
  ];
  return resolve(query, items, (i) => i.title);
}

async function audit(ctx: ToolContext, action: string, entityType: string | null, entityId: string | null, detail: Record<string, unknown>) {
  await ctx.admin.from("audit_logs").insert({ user_id: ctx.userId, actor: "ai", action, entity_type: entityType, entity_id: entityId, detail });
}

/* ================================== tools ================================== */

const getToday: ToolDef = {
  name: "get_today",
  description: "Today's overview: commitments, tasks (including overdue), appointments, check-in status, next prayer. Use for 'what's on today', 'read my schedule', 'what haven't I done'.",
  schema: z.object({ date: date.optional() }),
  kind: "read",
  async run(input, ctx) {
    const d = (input as { date?: string }).date ?? ctx.today;
    const [{ data: cs }, { data: ts }, { data: od }, { data: ss }, events] = await Promise.all([
      ctx.db.from("commitments").select("*").eq("commitment_date", d).order("promised_by"),
      ctx.db.from("tasks").select("*").eq("scheduled_for", d).neq("status", "cancelled"),
      ctx.db.from("tasks").select("*").lt("scheduled_for", d).eq("status", "pending"),
      ctx.db.from("accountability_sessions").select("kind,status").eq("session_date", d),
      eventsBetween(ctx.db, d, d, ctx.tz),
    ]);
    return ok(`Overview for ${d}`, {
      date: d,
      commitments: ((cs ?? []) as Commitment[]).map((c) => commitmentView(c, ctx.tz)),
      tasks: ((ts ?? []) as Task[]).map((t) => taskView(t, ctx.tz)),
      overdue_tasks: ((od ?? []) as Task[]).map((t) => taskView(t, ctx.tz)),
      appointments: events.map((o) => {
        const p = prepPlan(o.start, o.event.prep_minutes, o.event.travel_minutes);
        return { id: o.event.id, title: o.event.title, starts: fmt(o.start, ctx.tz, "h:mm a"), location: o.event.location,
          leave_by: o.event.travel_minutes ? fmt(p.leaveBy, ctx.tz, "h:mm a") : null };
      }),
      checkins: ss ?? [],
    });
  },
};

const listTasks: ToolDef = {
  name: "list_tasks",
  description: "List tasks and commitments in a date range, filtered by status.",
  schema: z.object({ from: date, to: date, status: z.enum(["open", "done", "missed", "all"]).default("open") }),
  kind: "read",
  async run(input, ctx) {
    const i = input as { from: string; to: string; status: string };
    let tq = ctx.db.from("tasks").select("*").gte("scheduled_for", i.from).lte("scheduled_for", i.to);
    let cq = ctx.db.from("commitments").select("*").gte("commitment_date", i.from).lte("commitment_date", i.to);
    if (i.status === "open") { tq = tq.eq("status", "pending"); cq = cq.eq("status", "open"); }
    if (i.status === "done") { tq = tq.eq("status", "done"); cq = cq.in("status", ["kept", "kept_late"]); }
    if (i.status === "missed") { tq = tq.eq("status", "missed"); cq = cq.eq("status", "broken"); }
    const [{ data: ts }, { data: cs }] = await Promise.all([tq.limit(100), cq.limit(100)]);
    return ok(`${(ts ?? []).length} tasks, ${(cs ?? []).length} commitments`, {
      tasks: ((ts ?? []) as Task[]).map((t) => taskView(t, ctx.tz)),
      commitments: ((cs ?? []) as Commitment[]).map((c) => commitmentView(c, ctx.tz)),
    });
  },
};

const createTask: ToolDef = {
  name: "create_task",
  description: "Create a task on a day's checklist, optionally with a deadline time (which schedules reminders).",
  schema: z.object({
    title: z.string().min(1).max(200), date: date.optional(), due_time: time.optional(),
    priority: z.enum(["high", "normal", "low"]).default("normal"), top_priority: z.boolean().default(false),
  }),
  kind: "write",
  async run(input, ctx) {
    const i = input as { title: string; date?: string; due_time?: string; priority: string; top_priority: boolean };
    const d = i.date ?? ctx.today;
    if (i.top_priority) {
      const { count } = await ctx.db.from("tasks").select("id", { count: "exact", head: true }).eq("scheduled_for", d).eq("is_top_priority", true).neq("status", "cancelled");
      if ((count ?? 0) >= 3) return fail("That day already has three priorities. Ask which one this should replace.");
    }
    const { data, error } = await ctx.db.from("tasks").insert({
      user_id: ctx.userId, title: i.title, scheduled_for: d, priority: { high: 1, normal: 2, low: 3 }[i.priority] ?? 2,
      is_top_priority: i.top_priority, due_at: i.due_time ? zonedToUtc(d, i.due_time, ctx.tz).toISOString() : null,
    }).select("*").single<Task>();
    if (error) return fail(`Couldn't create the task: ${error.message}`);
    await syncTaskReminders(ctx.db, ctx.userId, data, ctx.tz);
    return ok(`Created task “${data.title}” for ${d}${i.due_time ? ` due ${i.due_time}` : ""}`, { task: taskView(data, ctx.tz) },
      { undo: { tool: "delete_task", input: { task_id: data.id } }, entity: { type: "task", id: data.id } });
  },
};

const updateTask: ToolDef = {
  name: "update_task",
  description: "Rename, reschedule or change the deadline of a task. Moving it to a later day counts as a postponement.",
  schema: z.object({ task_id: z.uuid(), title: z.string().min(1).max(200).optional(), date: date.optional(), due_time: time.nullable().optional() }),
  kind: "write",
  async run(input, ctx) {
    const i = input as { task_id: string; title?: string; date?: string; due_time?: string | null };
    const { data: before } = await ctx.db.from("tasks").select("*").eq("id", i.task_id).maybeSingle<Task>();
    if (!before) return fail("Task not found.");
    const d = i.date ?? before.scheduled_for ?? ctx.today;
    const patch: Partial<Task> = {};
    if (i.title) patch.title = i.title;
    if (i.date) patch.scheduled_for = i.date;
    if (i.due_time !== undefined) patch.due_at = i.due_time ? zonedToUtc(d, i.due_time, ctx.tz).toISOString() : null;
    else if (i.date && before.due_at && before.scheduled_for) patch.due_at = new Date(Date.parse(before.due_at) + (Date.parse(i.date) - Date.parse(before.scheduled_for))).toISOString();
    if (i.date && before.scheduled_for && i.date > before.scheduled_for) { patch.postponed_count = before.postponed_count + 1; patch.is_top_priority = false; }
    const { data, error } = await ctx.db.from("tasks").update(patch).eq("id", i.task_id).select("*").single<Task>();
    if (error) return fail(`Couldn't update the task: ${error.message}`);
    await syncTaskReminders(ctx.db, ctx.userId, data, ctx.tz);
    return ok(`Updated “${data.title}”${i.date ? ` → ${i.date}` : ""}`, { task: taskView(data, ctx.tz) }, {
      undo: { tool: "restore_task", input: { task_id: data.id, before: { title: before.title, scheduled_for: before.scheduled_for, due_at: before.due_at, postponed_count: before.postponed_count, is_top_priority: before.is_top_priority } } },
      entity: { type: "task", id: data.id },
    });
  },
};

const completeItem: ToolDef = {
  name: "complete_item",
  description: "Mark a task done or a commitment kept. Give item_id if known, otherwise a short description in `query` (e.g. 'workout'). If several items match, the result lists them — ask the user which one; never guess.",
  schema: z.object({ item_id: z.uuid().optional(), item_type: z.enum(["task", "commitment"]).optional(), query: z.string().max(200).optional(), evidence: z.string().max(1000).optional() }),
  kind: "write",
  async run(input, ctx) {
    const i = input as { item_id?: string; item_type?: "task" | "commitment"; query?: string; evidence?: string };
    let type = i.item_type, id = i.item_id;
    if (!id) {
      if (!i.query) return fail("Need either item_id or query.");
      const r = await findOpenItems(ctx, i.query);
      if (r.kind === "none") return fail(`No open task or commitment matches “${i.query}”.`, { matches: [] });
      if (r.kind === "many") return { ok: false, summary: "Several items match", result: { ambiguous: true, matches: r.items.map((m) => ({ type: m.type, id: m.id, title: m.title, date: m.date })) } };
      type = r.item.type; id = r.item.id;
    }
    const now = new Date().toISOString();
    if (type === "commitment") {
      const { data: c } = await ctx.db.from("commitments").select("*").eq("id", id!).maybeSingle<Commitment>();
      if (!c) return fail("Commitment not found.");
      const late = c.promised_by ? Date.parse(c.promised_by) < Date.now() : false;
      const { data, error } = await ctx.db.from("commitments").update({
        status: late ? "kept_late" : "kept", resolved_at: now, verification: i.evidence ? "evidence" : "self_reported", evidence: i.evidence ?? null,
      }).eq("id", id!).select("*").single<Commitment>();
      if (error) return fail(`Couldn't update: ${error.message}`);
      await syncCommitmentReminders(ctx.db, ctx.userId, data, ctx.tz);
      return ok(`Recorded “${data.title}” as ${late ? "kept late" : "kept"} (${i.evidence ? "with evidence" : "self-reported"})`, { commitment: commitmentView(data, ctx.tz), completed_at: now },
        { undo: { tool: "reopen_item", input: { item_type: "commitment", item_id: data.id } }, entity: { type: "commitment", id: data.id } });
    }
    const { data, error } = await ctx.db.from("tasks").update({
      status: "done", completed_at: now, verification: i.evidence ? "evidence" : "self_reported", evidence: i.evidence ?? null, miss_reason: null,
    }).eq("id", id!).eq("status", "pending").select("*").maybeSingle<Task>();
    if (error) return fail(`Couldn't update: ${error.message}`);
    if (!data) return fail("That task isn't open (it may already be done).");
    await syncTaskReminders(ctx.db, ctx.userId, data, ctx.tz);
    return ok(`Marked “${data.title}” done at ${fmt(now, ctx.tz, "h:mm a")} (${i.evidence ? "with evidence" : "self-reported"})`, { task: taskView(data, ctx.tz), completed_at: now },
      { undo: { tool: "reopen_item", input: { item_type: "task", item_id: data.id } }, entity: { type: "task", id: data.id } });
  },
};

const reopenItem: ToolDef = {
  name: "reopen_item",
  description: "Reopen a task or commitment (used for undo).",
  schema: z.object({ item_type: z.enum(["task", "commitment"]), item_id: z.uuid() }),
  kind: "write",
  async run(input, ctx) {
    const i = input as { item_type: "task" | "commitment"; item_id: string };
    if (i.item_type === "task") {
      const { data, error } = await ctx.db.from("tasks").update({ status: "pending", completed_at: null, verification: "none", evidence: null }).eq("id", i.item_id).select("*").single<Task>();
      if (error) return fail(error.message);
      await syncTaskReminders(ctx.db, ctx.userId, data, ctx.tz);
      return ok(`Reopened “${data.title}”`, { task: taskView(data, ctx.tz) });
    }
    const { data, error } = await ctx.db.from("commitments").update({ status: "open", resolved_at: null, verification: "none", evidence: null, failure_context: null }).eq("id", i.item_id).select("*").single<Commitment>();
    if (error) return fail(error.message);
    await syncCommitmentReminders(ctx.db, ctx.userId, data, ctx.tz);
    return ok(`Reopened “${data.title}”`, { commitment: commitmentView(data, ctx.tz) });
  },
};

const restoreTask: ToolDef = {
  name: "restore_task",
  description: "Restore a task's previous fields (used for undo).",
  schema: z.object({ task_id: z.uuid(), before: z.record(z.string(), z.unknown()) }),
  kind: "write",
  async run(input, ctx) {
    const i = input as { task_id: string; before: Record<string, unknown> };
    const allowed = ["title", "scheduled_for", "due_at", "postponed_count", "is_top_priority"];
    const patch = Object.fromEntries(Object.entries(i.before).filter(([k]) => allowed.includes(k)));
    const { data, error } = await ctx.db.from("tasks").update(patch).eq("id", i.task_id).select("*").single<Task>();
    if (error) return fail(error.message);
    await syncTaskReminders(ctx.db, ctx.userId, data, ctx.tz);
    return ok(`Restored “${data.title}”`, { task: taskView(data, ctx.tz) });
  },
};

const deleteTask: ToolDef = {
  name: "delete_task",
  description: "Permanently delete a task. Prefer marking it not done unless the user explicitly wants it gone.",
  schema: z.object({ task_id: z.uuid() }),
  kind: "write",
  confirm: () => "Deleting removes the task from your record.",
  async describe(input, ctx) {
    const { data } = await ctx.db.from("tasks").select("title").eq("id", (input as { task_id: string }).task_id).maybeSingle();
    return `Delete task “${data?.title ?? "?"}”`;
  },
  async run(input, ctx) {
    const { task_id } = input as { task_id: string };
    await cancelFutureReminders(ctx.db, "task", task_id);
    const { data, error } = await ctx.db.from("tasks").delete().eq("id", task_id).select("title").maybeSingle();
    if (error) return fail(error.message);
    if (!data) return fail("Task not found.");
    return ok(`Deleted task “${data.title}”`, { deleted: task_id });
  },
};

const createCommitment: ToolDef = {
  name: "create_commitment",
  description: "Record a commitment: something promised by a specific time (to self or someone). Schedules a heads-up and a due-time reminder.",
  schema: z.object({ title: z.string().min(1).max(200), by_time: time, date: date.optional(), made_to: z.string().max(80).optional(), expected_outcome: z.string().max(500).optional(), first_action: z.string().max(300).optional() }),
  kind: "write",
  async run(input, ctx) {
    const i = input as { title: string; by_time: string; date?: string; made_to?: string; expected_outcome?: string; first_action?: string };
    const d = i.date ?? ctx.today;
    const { data, error } = await ctx.db.from("commitments").insert({
      user_id: ctx.userId, title: i.title, commitment_date: d, promised_by: zonedToUtc(d, i.by_time, ctx.tz).toISOString(),
      made_to: i.made_to || "self", expected_outcome: i.expected_outcome ?? null, first_action: i.first_action ?? null, source: "manual",
    }).select("*").single<Commitment>();
    if (error) return fail(error.message);
    await syncCommitmentReminders(ctx.db, ctx.userId, data, ctx.tz);
    return ok(`Committed: “${data.title}” by ${fmt(data.promised_by!, ctx.tz)}`, { commitment: commitmentView(data, ctx.tz) },
      { undo: { tool: "delete_commitment", input: { commitment_id: data.id } }, entity: { type: "commitment", id: data.id } });
  },
};

const deleteCommitment: ToolDef = {
  name: "delete_commitment",
  description: "Delete a commitment created by mistake.",
  schema: z.object({ commitment_id: z.uuid() }),
  kind: "write",
  confirm: () => "Deleting removes the commitment from your record.",
  async run(input, ctx) {
    const { commitment_id } = input as { commitment_id: string };
    await cancelFutureReminders(ctx.db, "commitment", commitment_id);
    const { data } = await ctx.db.from("commitments").delete().eq("id", commitment_id).select("title").maybeSingle();
    return data ? ok(`Deleted commitment “${data.title}”`, { deleted: commitment_id }) : fail("Commitment not found.");
  },
};

const resolveCommitment: ToolDef = {
  name: "record_commitment_outcome",
  description: "Record that a commitment was NOT kept (with what happened right before) or released by agreement. Use complete_item for kept.",
  schema: z.object({ commitment_id: z.uuid(), outcome: z.enum(["broken", "released"]), what_happened_before: z.string().max(2000).optional() }),
  kind: "write",
  async run(input, ctx) {
    const i = input as { commitment_id: string; outcome: "broken" | "released"; what_happened_before?: string };
    if (i.outcome === "broken" && (!i.what_happened_before || i.what_happened_before.trim().split(/\s+/).length < 4))
      return fail("Ask the user what happened immediately before, then record it.");
    const { data, error } = await ctx.db.from("commitments").update({
      status: i.outcome, resolved_at: new Date().toISOString(), verification: "none", failure_context: i.outcome === "broken" ? i.what_happened_before : null,
    }).eq("id", i.commitment_id).select("*").single<Commitment>();
    if (error) return fail(error.message);
    await syncCommitmentReminders(ctx.db, ctx.userId, data, ctx.tz);
    return ok(`Recorded “${data.title}” as ${i.outcome === "broken" ? "not kept" : "released"}`, { commitment: commitmentView(data, ctx.tz) },
      { undo: { tool: "reopen_item", input: { item_type: "commitment", item_id: data.id } } });
  },
};

const listEvents: ToolDef = {
  name: "list_events",
  description: "Appointments in a date range (includes Google Calendar events once connected and synced).",
  schema: z.object({ from: date, to: date }),
  kind: "read",
  async run(input, ctx) {
    const i = input as { from: string; to: string };
    if (await isConnected(ctx.admin, ctx.userId)) { try { await pullChanges(ctx.admin, ctx.userId, ctx.tz); } catch { /* show local data */ } }
    const ev = await eventsBetween(ctx.db, i.from, i.to, ctx.tz);
    return ok(`${ev.length} appointments`, {
      appointments: ev.map((o) => ({ id: o.event.id, title: o.event.title, date: o.date, start: fmt(o.start, ctx.tz, "HH:mm"), end: o.end ? fmt(o.end, ctx.tz, "HH:mm") : null, location: o.event.location, all_day: o.event.all_day, source: o.event.external_source ?? "local" })),
    });
  },
};

async function busyBlocks(ctx: ToolContext, d: string) {
  const ev = await eventsBetween(ctx.db, d, d, ctx.tz);
  const blocks = ev.filter((o) => !o.event.all_day).map((o) => ({
    title: o.event.title, start: o.start, end: o.end ?? new Date(o.start.getTime() + 3600_000), kind: "appointment",
  }));
  const { data: ps } = await ctx.db.from("prayer_settings").select("*").maybeSingle<PrayerSettingsRow>();
  const cfg = ps ? prayerConfig(ps, ctx.tz) : null;
  if (cfg) {
    const t = prayerTimesFor(d, cfg);
    for (const p of PRAYERS) blocks.push({ title: PRAYER_LABEL[p], start: t[p], end: new Date(t[p].getTime() + 20 * 60_000), kind: "prayer" });
  }
  return blocks.sort((a, b) => +a.start - +b.start);
}

const checkAvailability: ToolDef = {
  name: "check_availability",
  description: "Busy blocks (appointments + prayer times as soft blocks) and free slots for a day, between 07:00 and 22:00 unless a window is given. Optionally check one proposed slot for conflicts.",
  schema: z.object({ date, window_start: time.optional(), window_end: time.optional(), proposed_start: time.optional(), duration_minutes: z.number().int().min(5).max(720).optional() }),
  kind: "read",
  async run(input, ctx) {
    const i = input as { date: string; window_start?: string; window_end?: string; proposed_start?: string; duration_minutes?: number };
    if (await isConnected(ctx.admin, ctx.userId)) { try { await pullChanges(ctx.admin, ctx.userId, ctx.tz); } catch { /* use local */ } }
    const blocks = await busyBlocks(ctx, i.date);
    const ws = zonedToUtc(i.date, i.window_start ?? "07:00", ctx.tz), we = zonedToUtc(i.date, i.window_end ?? "22:00", ctx.tz);
    const free: { start: string; end: string }[] = [];
    let cursor = ws;
    for (const b of blocks.filter((b) => b.end > ws && b.start < we)) {
      if (b.start > cursor) free.push({ start: fmt(cursor, ctx.tz, "HH:mm"), end: fmt(b.start, ctx.tz, "HH:mm") });
      if (b.end > cursor) cursor = b.end;
    }
    if (cursor < we) free.push({ start: fmt(cursor, ctx.tz, "HH:mm"), end: fmt(we, ctx.tz, "HH:mm") });
    let conflicts: { title: string; kind: string; start: string; end: string }[] | undefined;
    if (i.proposed_start) {
      const ps = zonedToUtc(i.date, i.proposed_start, ctx.tz), pe = new Date(ps.getTime() + (i.duration_minutes ?? 60) * 60_000);
      conflicts = blocks.filter((b) => b.start < pe && b.end > ps).map((b) => ({ title: b.title, kind: b.kind, start: fmt(b.start, ctx.tz, "HH:mm"), end: fmt(b.end, ctx.tz, "HH:mm") }));
    }
    return ok(`Availability for ${i.date}`, {
      date: i.date, weekday: formatInZone(zonedToUtc(i.date, "12:00", ctx.tz), ctx.tz, "EEEE"),
      busy: blocks.map((b) => ({ title: b.title, kind: b.kind, start: fmt(b.start, ctx.tz, "HH:mm"), end: fmt(b.end, ctx.tz, "HH:mm") })),
      free, ...(conflicts ? { conflicts } : {}),
    });
  },
};

const eventSchema = z.object({
  title: z.string().min(1).max(200), date, start_time: time, duration_minutes: z.number().int().min(5).max(720).default(60),
  location: z.string().max(300).optional(), prep_minutes: z.number().int().min(0).max(600).default(0),
  travel_minutes: z.number().int().min(0).max(600).default(0).describe("Only if the user stated it. Never estimate travel time."),
  importance: z.enum(["normal", "high"]).default("normal"), reminder_minutes_before: z.array(z.number().int().min(1).max(10080)).max(5).default([60]),
  recurrence: z.enum(["none", "daily", "weekly", "monthly"]).default("none"), recurrence_until: date.optional(), notes: z.string().max(2000).optional(),
  kind: z.enum(["appointment", "workout", "call", "deadline", "routine", "obligation", "focus_block"]).default("appointment").describe("Use workout for gym/runs/training."),
  accountability: z.enum(["off", "light", "standard", "strict"]).optional().describe("Check-in level. Defaults: workout/deadline standard, others light. Ask the user if unclear for important items."),
});

const createEvent: ToolDef<typeof eventSchema> = {
  name: "create_event",
  description: "Create an appointment (and add it to Google Calendar when connected). Always requires the user's confirmation. Check availability first and mention conflicts.",
  schema: eventSchema,
  kind: "write",
  async confirm(i, ctx) {
    const ps = zonedToUtc(i.date, i.start_time, ctx.tz), pe = new Date(ps.getTime() + i.duration_minutes * 60_000);
    const conflicts = (await busyBlocks(ctx, i.date)).filter((b) => b.kind === "appointment" && b.start < pe && b.end > ps);
    return conflicts.length ? `Overlaps ${conflicts.map((c) => `“${c.title}” ${fmt(c.start, ctx.tz, "h:mm a")}`).join(", ")}` : "Adds an appointment to your calendar";
  },
  describe(i, ctx) {
    const ps = zonedToUtc(i.date, i.start_time, ctx.tz);
    const p = prepPlan(ps, i.prep_minutes, i.travel_minutes);
    return `“${i.title}” ${fmt(ps, ctx.tz)}${i.duration_minutes ? ` for ${i.duration_minutes} min` : ""}${i.location ? ` at ${i.location}` : ""}${i.travel_minutes ? `, leave by ${fmt(p.leaveBy, ctx.tz, "h:mm a")}` : ""}${i.recurrence !== "none" ? `, repeats ${i.recurrence}` : ""}`;
  },
  async run(i, ctx) {
    const starts = zonedToUtc(i.date, i.start_time, ctx.tz);
    const { data, error } = await ctx.db.from("events").insert({
      user_id: ctx.userId, title: i.title, location: i.location ?? null, notes: i.notes ?? null, starts_at: starts.toISOString(),
      ends_at: new Date(starts.getTime() + i.duration_minutes * 60_000).toISOString(), importance: i.importance,
      prep_minutes: i.prep_minutes, travel_minutes: i.travel_minutes, reminder_offsets: i.reminder_minutes_before,
      recurrence: i.recurrence, recurrence_until: i.recurrence_until ?? null, plan_confirmed_at: new Date().toISOString(),
      kind: i.kind, accountability: i.accountability ?? (i.kind === "workout" || i.kind === "deadline" ? "standard" : "light"),
    }).select("*").single<CalendarEvent>();
    if (error) return fail(`Couldn't create the appointment: ${error.message}`);
    await syncEventReminders(ctx.db, ctx.userId, data, ctx.tz);
    let google: string = "not connected";
    if (await isConnected(ctx.admin, ctx.userId)) {
      try { await pushEvent(ctx.admin, ctx.userId, data, ctx.tz); google = "added to Google Calendar"; }
      catch (e) { google = `saved here, but Google Calendar failed: ${(e as Error).message}`; }
    }
    const { count } = await ctx.db.from("reminders").select("id", { count: "exact", head: true }).eq("entity_id", data.id).eq("status", "scheduled");
    return ok(`Created “${data.title}” ${fmt(starts, ctx.tz)}; ${count ?? 0} reminders scheduled; Google: ${google}`,
      { event: { id: data.id, title: data.title, starts: fmt(starts, ctx.tz) }, reminders_scheduled: count ?? 0, google },
      { undo: { tool: "delete_event", input: { event_id: data.id } }, entity: { type: "event", id: data.id } });
  },
};

const rescheduleEvent: ToolDef = {
  name: "reschedule_event",
  description: "Move or change an appointment. Requires confirmation. Updates Google Calendar when the event is synced.",
  schema: z.object({ event_id: z.uuid(), date: date.optional(), start_time: time.optional(), duration_minutes: z.number().int().min(5).max(720).optional(), title: z.string().max(200).optional(), location: z.string().max(300).optional() }),
  kind: "write",
  confirm: () => "Changes an appointment",
  async describe(input, ctx) {
    const i = input as { event_id: string; date?: string; start_time?: string };
    const { data } = await ctx.db.from("events").select("title,starts_at").eq("id", i.event_id).maybeSingle();
    return `Move “${data?.title ?? "?"}” from ${data ? fmt(data.starts_at, ctx.tz) : "?"}${i.date || i.start_time ? ` to ${i.date ?? ""} ${i.start_time ?? ""}` : ""}`;
  },
  async run(input, ctx) {
    const i = input as { event_id: string; date?: string; start_time?: string; duration_minutes?: number; title?: string; location?: string };
    const { data: ev } = await ctx.db.from("events").select("*").eq("id", i.event_id).maybeSingle<CalendarEvent>();
    if (!ev) return fail("Appointment not found.");
    const oldStart = new Date(ev.starts_at);
    const d = i.date ?? localDateString(oldStart, ctx.tz);
    const t = i.start_time ?? formatInZone(oldStart, ctx.tz, "HH:mm");
    const starts = zonedToUtc(d, t, ctx.tz);
    const dur = i.duration_minutes ?? (ev.ends_at ? (Date.parse(ev.ends_at) - oldStart.getTime()) / 60000 : 60);
    const { data, error } = await ctx.db.from("events").update({
      starts_at: starts.toISOString(), ends_at: new Date(starts.getTime() + dur * 60_000).toISOString(),
      ...(i.title ? { title: i.title } : {}), ...(i.location !== undefined ? { location: i.location } : {}),
      sync_status: ev.external_id ? "pending_push" : "local",
    }).eq("id", ev.id).select("*").single<CalendarEvent>();
    if (error) return fail(error.message);
    await syncEventReminders(ctx.db, ctx.userId, data, ctx.tz);
    let google = "not connected";
    if (await isConnected(ctx.admin, ctx.userId)) {
      try { await pushEvent(ctx.admin, ctx.userId, data, ctx.tz); google = "updated in Google Calendar"; }
      catch (e) { google = `Google update failed: ${(e as Error).message}`; }
    }
    return ok(`Moved “${data.title}” to ${fmt(starts, ctx.tz)}; Google: ${google}`, { event: { id: data.id, starts: fmt(starts, ctx.tz) }, google }, {
      undo: { tool: "reschedule_event", input: { event_id: ev.id, date: localDateString(oldStart, ctx.tz), start_time: formatInZone(oldStart, ctx.tz, "HH:mm"), duration_minutes: dur } },
      entity: { type: "event", id: ev.id },
    });
  },
};

const deleteEvent: ToolDef = {
  name: "delete_event",
  description: "Delete an appointment (also from Google Calendar if synced). Requires confirmation.",
  schema: z.object({ event_id: z.uuid() }),
  kind: "write",
  confirm: () => "Deletes an appointment",
  async describe(input, ctx) {
    const { data } = await ctx.db.from("events").select("title,starts_at").eq("id", (input as { event_id: string }).event_id).maybeSingle();
    return `Delete “${data?.title ?? "?"}”${data ? ` (${fmt(data.starts_at, ctx.tz)})` : ""}`;
  },
  async run(input, ctx) {
    const { event_id } = input as { event_id: string };
    const { data: ev } = await ctx.db.from("events").select("*").eq("id", event_id).maybeSingle<CalendarEvent>();
    if (!ev) return fail("Appointment not found.");
    if (ev.external_source === "google" && ev.external_id && (await isConnected(ctx.admin, ctx.userId))) {
      try { await deleteRemote(ctx.admin, ctx.userId, ev.external_id); } catch (e) { return fail(`Google Calendar refused the delete: ${(e as Error).message}. Nothing was deleted.`); }
    }
    await cancelFutureReminders(ctx.db, "event", ev.id);
    await ctx.db.from("events").delete().eq("id", ev.id);
    return ok(`Deleted “${ev.title}”`, { deleted: ev.id });
  },
};

const createReminder: ToolDef = {
  name: "create_reminder",
  description: "Set a one-off push reminder: either at a local date+time, or in N minutes from now.",
  schema: z.object({ text: z.string().min(1).max(200), date: date.optional(), time: time.optional(), in_minutes: z.number().int().min(1).max(60 * 24 * 30).optional(), hold_during_quiet_hours: z.boolean().default(false) }),
  kind: "write",
  async run(input, ctx) {
    const i = input as { text: string; date?: string; time?: string; in_minutes?: number; hold_during_quiet_hours: boolean };
    let at: Date;
    if (i.in_minutes) at = new Date(Date.now() + i.in_minutes * 60_000);
    else if (i.time) at = zonedToUtc(i.date ?? ctx.today, i.time, ctx.tz);
    else return fail("Need a time or a number of minutes.");
    if (at.getTime() < Date.now() + 30_000) return fail("That time has already passed. Ask for a time in the future.");
    const { data, error } = await ctx.db.from("reminders").insert({
      user_id: ctx.userId, entity_type: "custom", category: "commitments", title: i.text, body: null, url: "/today",
      send_at: at.toISOString(), respect_quiet_hours: i.hold_during_quiet_hours,
    }).select("id,send_at,status").single();
    if (error) return fail(`Couldn't save the reminder: ${error.message}`);
    return ok(`Reminder set for ${fmt(at, ctx.tz)}: “${i.text}”`, { reminder: { id: data.id, send_at: fmt(data.send_at, ctx.tz), status: data.status } },
      { undo: { tool: "cancel_reminder", input: { reminder_id: data.id } }, entity: { type: "reminder", id: data.id } });
  },
};

const cancelReminder: ToolDef = {
  name: "cancel_reminder",
  description: "Cancel a scheduled reminder.",
  schema: z.object({ reminder_id: z.uuid() }),
  kind: "write",
  async run(input, ctx) {
    const { data, error } = await ctx.db.from("reminders").update({ status: "cancelled" }).eq("id", (input as { reminder_id: string }).reminder_id).eq("status", "scheduled").select("title").maybeSingle();
    if (error) return fail(error.message);
    return data ? ok(`Cancelled reminder “${data.title}”`, { cancelled: true }) : fail("That reminder isn't scheduled anymore.");
  },
};

const createJournal: ToolDef = {
  name: "create_journal_entry",
  description: "Save a journal entry in the user's own words (dictated or typed). Never invent content; save what the user said.",
  schema: z.object({ body: z.string().min(1).max(20000), title: z.string().max(200).optional(), mood: z.number().int().min(1).max(5).optional(), energy: z.number().int().min(1).max(5).optional(), tags: z.array(z.enum(["stress", "business", "finances", "faith", "relationships", "habits"])).max(6).default([]) }),
  kind: "write",
  async run(input, ctx) {
    const i = input as { body: string; title?: string; mood?: number; energy?: number; tags: string[] };
    const { data, error } = await ctx.db.from("journal_entries").insert({
      user_id: ctx.userId, body: i.body, title: i.title ?? null, mood: i.mood ?? null, energy: i.energy ?? null, tags: i.tags, entry_date: ctx.today, input_method: "voice",
    }).select("id").single();
    if (error) return fail(error.message);
    return ok("Saved to your journal", { entry_id: data.id, link: `/journal/${data.id}` }, { entity: { type: "journal_entry", id: data.id } });
  },
};

const searchHistory: ToolDef = {
  name: "search_history",
  description: "Retrieve the user's own records to answer questions about the past ('what did I tell you about discipline?', 'what did I struggle with last week?'). Returns dated records with sources. Only answer from what is returned.",
  schema: z.object({ query: z.string().max(200).optional(), from: date, to: date, sources: z.array(z.enum(["journal", "checkins", "commitments", "tasks", "impulses", "memories"])).default(["journal", "checkins", "commitments", "tasks", "impulses", "memories"]) }),
  kind: "read",
  async run(input, ctx) {
    const i = input as { query?: string; from: string; to: string; sources: string[] };
    const out: Record<string, unknown> = { period: `${i.from} to ${i.to}` };
    const notes: string[] = [];
    const { start } = dayBoundsUtc(i.from, ctx.tz); const { end } = dayBoundsUtc(i.to, ctx.tz);
    if (i.sources.includes("journal")) {
      if (!ctx.aiConsent) notes.push("Journal not searched: AI analysis is off in Settings.");
      else {
        let q = ctx.db.from("journal_entries").select("id,entry_date,title,body,mood,tags").eq("ai_analysis_allowed", true).gte("entry_date", i.from).lte("entry_date", i.to).order("entry_date").limit(20);
        if (i.query) q = q.textSearch("search", i.query, { type: "websearch", config: "english" });
        const { data } = await q;
        out.journal = (data ?? []).map((e) => ({ id: e.id, date: e.entry_date, title: e.title, mood: e.mood, tags: e.tags, text: e.body.slice(0, 1200) }));
      }
    }
    if (i.sources.includes("checkins")) {
      if (!ctx.aiConsent) notes.push("Check-in answers not read: AI analysis is off.");
      else {
        const { data } = await ctx.db.from("accountability_answers").select("question,answer,follow_up_question,follow_up_answer,skipped,created_at,accountability_sessions(session_date,kind)").gte("created_at", start.toISOString()).lt("created_at", end.toISOString()).order("created_at").limit(80);
        out.checkin_answers = (data ?? []).filter((a) => !a.skipped).map((a) => ({ ...a, accountability_sessions: undefined, session: a.accountability_sessions }));
      }
    }
    if (i.sources.includes("commitments")) {
      const { data } = await ctx.db.from("commitments").select("title,commitment_date,status,failure_context,evidence").gte("commitment_date", i.from).lte("commitment_date", i.to).order("commitment_date");
      out.commitments = data ?? [];
    }
    if (i.sources.includes("tasks")) {
      const { data } = await ctx.db.from("tasks").select("title,scheduled_for,status,postponed_count,miss_reason").gte("scheduled_for", i.from).lte("scheduled_for", i.to).order("scheduled_for").limit(100);
      out.tasks = data ?? [];
    }
    if (i.sources.includes("impulses")) {
      const { data } = await ctx.db.from("impulse_logs").select("kind,feeling,trigger_note,outcome,created_at").gte("created_at", start.toISOString()).lt("created_at", end.toISOString()).order("created_at");
      out.impulses = data ?? [];
    }
    if (i.sources.includes("memories")) {
      const { data } = await ctx.db.from("ai_memory").select("content,category,evidence_status,created_at").eq("status", "active").eq("sensitive", false).limit(40);
      out.memories = data ?? [];
    }
    if (notes.length) out.notes = notes;
    return ok("Records retrieved", out);
  },
};

const getPatterns: ToolDef = {
  name: "get_patterns",
  description: "Measured behaviour patterns over a period: commitments kept vs broken, on-time rate, postponements, missed tasks by weekday and time of day, reported distraction, impulses, prayer confirmations, focus minutes. Use for 'where have I been inconsistent' and when tasks are being missed.",
  schema: z.object({ days: z.number().int().min(3).max(90).default(14) }),
  kind: "read",
  async run(input, ctx) {
    const days = (input as { days: number }).days;
    const from = shiftDate(ctx.today, -days + 1);
    const { start } = dayBoundsUtc(from, ctx.tz);
    const [{ data: cs }, { data: ts }, { data: im }, { data: pc }, { data: fs }] = await Promise.all([
      ctx.db.from("commitments").select("status,promised_by,resolved_at,commitment_date,failure_context,title").gte("commitment_date", from).lte("commitment_date", ctx.today),
      ctx.db.from("tasks").select("status,scheduled_for,due_at,postponed_count,title,miss_reason").gte("scheduled_for", from).lte("scheduled_for", ctx.today),
      ctx.db.from("impulse_logs").select("kind,outcome,created_at").gte("created_at", start.toISOString()),
      ctx.db.from("prayer_confirmations").select("prayer,prayer_date").gte("prayer_date", from),
      ctx.db.from("focus_sessions").select("status,started_at,ended_at,planned_minutes").gte("started_at", start.toISOString()),
    ]);
    const commitments = cs ?? [], tasks = ts ?? [];
    const resolved = commitments.filter((c) => c.status !== "open" && c.status !== "released");
    const weekday = (d: string) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dayOfWeek(d)];
    const missedByDay: Record<string, number> = {};
    for (const t of tasks.filter((t) => t.status === "missed" || (t.status === "pending" && t.scheduled_for! < ctx.today))) missedByDay[weekday(t.scheduled_for!)] = (missedByDay[weekday(t.scheduled_for!)] ?? 0) + 1;
    for (const c of commitments.filter((c) => c.status === "broken")) missedByDay[weekday(c.commitment_date)] = (missedByDay[weekday(c.commitment_date)] ?? 0) + 1;
    const brokenHours: Record<string, number> = {};
    for (const c of commitments.filter((c) => c.status === "broken" && c.promised_by)) {
      const h = Number(formatInZone(c.promised_by!, ctx.tz, "H"));
      const band = h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
      brokenHours[band] = (brokenHours[band] ?? 0) + 1;
    }
    const focusMin = (fs ?? []).filter((f) => f.status === "completed").reduce((s, f) => s + f.planned_minutes, 0);
    return ok(`Patterns over ${days} days`, {
      period: `${from} to ${ctx.today}`, sample: { commitments: commitments.length, tasks: tasks.length, impulses: (im ?? []).length },
      commitments: { kept: resolved.filter((c) => c.status === "kept").length, kept_late: resolved.filter((c) => c.status === "kept_late").length, broken: resolved.filter((c) => c.status === "broken").length, unresolved: commitments.filter((c) => c.status === "open").length,
        broken_examples: commitments.filter((c) => c.status === "broken").slice(-5).map((c) => ({ date: c.commitment_date, title: c.title, before: c.failure_context })) },
      tasks: { done: tasks.filter((t) => t.status === "done").length, missed: tasks.filter((t) => t.status === "missed").length, left_open_past_day: tasks.filter((t) => t.status === "pending" && t.scheduled_for! < ctx.today).length,
        postponed_2plus: tasks.filter((t) => t.postponed_count >= 2).map((t) => ({ title: t.title, times: t.postponed_count })) },
      misses_by_weekday: missedByDay, broken_commitments_by_time_of_day: brokenHours,
      impulses: Object.entries((im ?? []).reduce((a: Record<string, { total: number; resisted: number }>, x) => { a[x.kind] ??= { total: 0, resisted: 0 }; a[x.kind].total++; if (x.outcome === "resisted") a[x.kind].resisted++; return a; }, {})).map(([kind, v]) => ({ kind, ...v })),
      prayers_confirmed: (pc ?? []).length, prayers_possible: days * 5, focus_minutes_completed: focusMin,
      caution: "Counts only what was recorded. Days without records are not failures.",
    });
  },
};

const createGoal: ToolDef = {
  name: "create_goal",
  description: "Create a goal. Ask for a specific outcome and a measurable success criterion if the user hasn't given them.",
  schema: z.object({ title: z.string().min(1).max(200), desired_outcome: z.string().min(10).max(2000), success_criteria: z.string().min(5).max(2000), horizon: z.enum(["long_term", "monthly", "weekly"]).default("long_term"), area: z.enum(["business", "finance", "wellness", "communication", "spiritual", "attention", "character", "general"]).default("general"), target_date: date.optional(), recovery_plan: z.string().max(2000).optional() }),
  kind: "write",
  async run(input, ctx) {
    const i = input as Record<string, string>;
    const { data, error } = await ctx.db.from("goals").insert({ user_id: ctx.userId, ...i, target_date: i.target_date ?? null }).select("id,title").single();
    if (error) return fail(error.message);
    return ok(`Created goal “${data.title}”`, { goal_id: data.id, link: `/goals/${data.id}` }, { undo: { tool: "archive_goal", input: { goal_id: data.id } }, entity: { type: "goal", id: data.id } });
  },
};

const archiveGoal: ToolDef = {
  name: "archive_goal",
  description: "Mark a goal abandoned (used for undo).",
  schema: z.object({ goal_id: z.uuid() }),
  kind: "write",
  async run(input, ctx) {
    const { data } = await ctx.db.from("goals").update({ status: "abandoned" }).eq("id", (input as { goal_id: string }).goal_id).select("title").maybeSingle();
    return data ? ok(`Archived goal “${data.title}”`, {}) : fail("Goal not found.");
  },
};

const recordProgress: ToolDef = {
  name: "record_goal_progress",
  description: "Log progress on a goal (by goal_id or a short query naming it).",
  schema: z.object({ goal_id: z.uuid().optional(), query: z.string().max(200).optional(), note: z.string().min(3).max(2000), progress_pct: z.number().int().min(0).max(100).optional(), evidence: z.string().max(1000).optional() }),
  kind: "write",
  async run(input, ctx) {
    const i = input as { goal_id?: string; query?: string; note: string; progress_pct?: number; evidence?: string };
    let gid = i.goal_id;
    if (!gid) {
      const { data: goals } = await ctx.db.from("goals").select("id,title").eq("status", "active");
      const r = resolve(i.query ?? "", goals ?? [], (g) => g.title);
      if (r.kind === "none") return fail("No active goal matches.", { goals: goals ?? [] });
      if (r.kind === "many") return { ok: false, summary: "Several goals match", result: { ambiguous: true, matches: r.items } };
      gid = r.item.id;
    }
    const { data, error } = await ctx.db.from("goal_progress").insert({ user_id: ctx.userId, goal_id: gid, note: i.note, progress_pct: i.progress_pct ?? null, evidence: i.evidence ?? null }).select("id").single();
    if (error) return fail(error.message);
    return ok("Progress logged", { progress_id: data.id, goal_id: gid }, { entity: { type: "goal_progress", id: data.id } });
  },
};

const createHabit: ToolDef = {
  name: "create_habit",
  description: "Create a habit with a weekly target and optional rest days (0=Sunday).",
  schema: z.object({ title: z.string().min(1).max(160), target_per_week: z.number().int().min(1).max(7).default(7), rest_days: z.array(z.number().int().min(0).max(6)).max(6).default([]), area: z.enum(["business", "finance", "wellness", "communication", "spiritual", "attention", "character", "general"]).default("general") }),
  kind: "write",
  async run(input, ctx) {
    const i = input as { title: string; target_per_week: number; rest_days: number[]; area: string };
    const { data, error } = await ctx.db.from("habits").insert({ user_id: ctx.userId, ...i }).select("id,title").single();
    if (error) return fail(error.message);
    return ok(`Created habit “${data.title}”`, { habit_id: data.id }, { entity: { type: "habit", id: data.id } });
  },
};

const logHabit: ToolDef = {
  name: "log_habit",
  description: "Log a habit as done or rest for a day (by habit_id or query).",
  schema: z.object({ habit_id: z.uuid().optional(), query: z.string().max(200).optional(), status: z.enum(["done", "rest", "skipped"]).default("done"), date: date.optional() }),
  kind: "write",
  async run(input, ctx) {
    const i = input as { habit_id?: string; query?: string; status: string; date?: string };
    let hid = i.habit_id;
    if (!hid) {
      const { data: hs } = await ctx.db.from("habits").select("id,title").eq("active", true);
      const r = resolve(i.query ?? "", hs ?? [], (h) => h.title);
      if (r.kind === "none") return fail("No habit matches.", { habits: hs ?? [] });
      if (r.kind === "many") return { ok: false, summary: "Several habits match", result: { ambiguous: true, matches: r.items } };
      hid = r.item.id;
    }
    const { error } = await ctx.db.from("habit_logs").upsert({ user_id: ctx.userId, habit_id: hid, log_date: i.date ?? ctx.today, status: i.status }, { onConflict: "habit_id,log_date" });
    if (error) return fail(error.message);
    return ok(`Habit logged as ${i.status}`, { habit_id: hid, date: i.date ?? ctx.today });
  },
};

const getPrayerTimes: ToolDef = {
  name: "get_prayer_times",
  description: "Prayer times for a date at the user's saved location, with which prayers they've confirmed.",
  schema: z.object({ date: date.optional() }),
  kind: "read",
  async run(input, ctx) {
    const d = (input as { date?: string }).date ?? ctx.today;
    const { data: ps } = await ctx.db.from("prayer_settings").select("*").maybeSingle<PrayerSettingsRow>();
    const cfg = ps ? prayerConfig(ps, ctx.tz) : null;
    if (!cfg) return fail("No prayer location set yet. Ask the user to set it in Faith.");
    const t = prayerTimesFor(d, cfg);
    const { data: conf } = await ctx.db.from("prayer_confirmations").select("prayer,status").eq("prayer_date", d);
    return ok(`Prayer times ${d}`, {
      date: d, location: ps!.location_label, method: ps!.method,
      times: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, fmt(v, ctx.tz, "h:mm a")])),
      confirmed: conf ?? [], note: "Calculated times; local mosque timetables can differ.",
    });
  },
};

const confirmPrayer: ToolDef = {
  name: "confirm_prayer",
  description: "Record that the user prayed a prayer (only when they say so).",
  schema: z.object({ prayer: z.enum(PRAYERS), date: date.optional() }),
  kind: "write",
  async run(input, ctx) {
    const i = input as { prayer: (typeof PRAYERS)[number]; date?: string };
    const d = i.date ?? ctx.today;
    const { error } = await ctx.db.from("prayer_confirmations").upsert({ user_id: ctx.userId, prayer_date: d, prayer: i.prayer, status: "prayed", source: "coach" }, { onConflict: "user_id,prayer_date,prayer" });
    if (error) return fail(error.message);
    await ctx.db.from("reminders").update({ status: "cancelled" }).eq("entity_type", "prayer").like("dedupe_key", `prayer:${d}:${i.prayer}:%`).eq("status", "scheduled");
    return ok(`Recorded ${PRAYER_LABEL[i.prayer]} as prayed`, { prayer: i.prayer, date: d }, { undo: { tool: "unconfirm_prayer", input: { prayer: i.prayer, date: d } } });
  },
};

const unconfirmPrayer: ToolDef = {
  name: "unconfirm_prayer",
  description: "Remove a prayer confirmation (used for undo).",
  schema: z.object({ prayer: z.enum(PRAYERS), date }),
  kind: "write",
  async run(input, ctx) {
    const i = input as { prayer: string; date: string };
    await ctx.db.from("prayer_confirmations").delete().eq("prayer_date", i.date).eq("prayer", i.prayer);
    return ok("Prayer confirmation removed", {});
  },
};

const startFocus: ToolDef = {
  name: "start_focus_session",
  description: "Start a focus session of 25, 45, 60 or 90 minutes, optionally tied to a task.",
  schema: z.object({ minutes: z.union([z.literal(25), z.literal(45), z.literal(60), z.literal(90)]), intention: z.string().max(200).optional(), task_id: z.uuid().optional() }),
  kind: "write",
  async run(input, ctx) {
    const i = input as { minutes: number; intention?: string; task_id?: string };
    await ctx.db.from("focus_sessions").update({ status: "abandoned", ended_at: new Date().toISOString() }).eq("status", "active");
    const ends = new Date(Date.now() + i.minutes * 60_000);
    const { data, error } = await ctx.db.from("focus_sessions").insert({ user_id: ctx.userId, planned_minutes: i.minutes, intention: i.intention ?? null, task_id: i.task_id ?? null, ends_at: ends.toISOString() }).select("id").single();
    if (error) return fail(error.message);
    await insertRows(ctx.db, [{ user_id: ctx.userId, entity_type: "focus", entity_id: data.id, category: "habits", dedupe_key: `focus:${data.id}:end`, title: "Focus session complete", body: i.intention ?? "Record how it went.", url: "/rhythm", send_at: ends.toISOString(), respect_quiet_hours: false, actions: [] }]);
    return ok(`Focus session started until ${fmt(ends, ctx.tz, "h:mm a")}`, { session_id: data.id, ends: fmt(ends, ctx.tz, "h:mm a"), link: "/rhythm" });
  },
};

const logImpulse: ToolDef = {
  name: "log_impulse",
  description: "Log an urge the user is having (procrastination, scrolling, spending, eating, romantic preoccupation, anger). Ask the interruption questions one at a time first; log what they said. Never shame.",
  schema: z.object({ kind: z.enum(["procrastination", "social_media", "spending", "eating", "romantic_preoccupation", "anger", "other"]), feeling: z.string().max(500).optional(), trigger: z.string().max(500).optional(), seeking: z.string().max(500).optional(), consequence: z.string().max(500).optional(), alternative: z.string().max(500).optional(), outcome: z.enum(["resisted", "acted", "partly", "unsure"]).optional() }),
  kind: "write",
  async run(input, ctx) {
    const i = input as Record<string, string>;
    const { data, error } = await ctx.db.from("impulse_logs").insert({ user_id: ctx.userId, kind: i.kind, feeling: i.feeling ?? null, trigger_note: i.trigger ?? null, seeking: i.seeking ?? null, consequence: i.consequence ?? null, alternative: i.alternative ?? null, outcome: i.outcome ?? null, intervention: "reflection" }).select("id").single();
    if (error) return fail(error.message);
    return ok("Urge logged", { impulse_id: data.id });
  },
};

const proposeMemory: ToolDef = {
  name: "propose_memory",
  description: "Propose a long-term memory about the user for THEM to approve in Settings → Memory. Only for durable things the user clearly stated or that records show. Never for sensitive journal content. Never claims it is saved permanently.",
  schema: z.object({ content: z.string().min(5).max(500), category: z.enum(["preference", "long_term_goal", "routine", "observation", "difficulty", "accomplishment", "reflection", "hypothesis", "context"]), evidence_status: z.enum(["verified", "self_reported", "unverified"]), source_excerpt: z.string().max(500).optional() }),
  kind: "write",
  async run(input, ctx) {
    const i = input as { content: string; category: string; evidence_status: string; source_excerpt?: string };
    const kind = i.evidence_status === "verified" ? "verified_fact" : i.category === "hypothesis" || i.evidence_status === "unverified" ? "hypothesis" : "self_report";
    const { data, error } = await ctx.db.from("ai_memory").insert({ user_id: ctx.userId, kind, category: i.category, evidence_status: i.evidence_status, content: i.content, status: "proposed", source_type: "conversation" }).select("id").single();
    if (error) return fail(error.message);
    if (i.source_excerpt) await ctx.db.from("ai_memory_sources").insert({ user_id: ctx.userId, memory_id: data.id, source_type: "conversation", excerpt: i.source_excerpt });
    return ok("Proposed memory awaiting the user's approval", { memory_id: data.id, status: "proposed", review_link: "/settings/memory" });
  },
};

const planBlocks: ToolDef = {
  name: "create_time_blocks",
  description: "Create several appointments/time blocks at once (e.g. after planning a day). Requires one confirmation for the whole set. Check availability first.",
  schema: z.object({ blocks: z.array(z.object({ title: z.string().min(1).max(200), date, start_time: time, duration_minutes: z.number().int().min(5).max(480) })).min(1).max(10) }),
  kind: "write",
  confirm: (i) => `Adds ${(i as { blocks: unknown[] }).blocks.length} blocks to your calendar`,
  describe: (i) => (i as { blocks: { title: string; date: string; start_time: string; duration_minutes: number }[] }).blocks.map((b) => `${b.date} ${b.start_time} ${b.title} (${b.duration_minutes} min)`).join("; "),
  async run(input, ctx) {
    const created: string[] = [];
    for (const b of (input as { blocks: { title: string; date: string; start_time: string; duration_minutes: number }[] }).blocks) {
      const r = await createEvent.run({ ...b, prep_minutes: 0, travel_minutes: 0, importance: "normal", reminder_minutes_before: [10], recurrence: "none", kind: "focus_block", accountability: "light" }, ctx);
      if (!r.ok) return fail(`Created ${created.length}, then failed on “${b.title}”: ${r.summary}`, { created });
      created.push((r.result.event as { id: string }).id);
    }
    return ok(`Created ${created.length} time blocks`, { created }, { undo: { tool: "delete_events", input: { event_ids: created } } });
  },
};

const deleteEvents: ToolDef = {
  name: "delete_events",
  description: "Delete several appointments (used to undo a plan).",
  schema: z.object({ event_ids: z.array(z.uuid()).min(1).max(10) }),
  kind: "write",
  confirm: () => "Deletes several appointments",
  async run(input, ctx) {
    let n = 0;
    for (const id of (input as { event_ids: string[] }).event_ids) { const r = await deleteEvent.run({ event_id: id }, ctx); if (r.ok) n++; }
    return ok(`Deleted ${n} appointments`, { deleted: n });
  },
};

const checkinQuestions: ToolDef = {
  name: "get_checkin_questions",
  description: "Get the questions for a morning, midday or evening check-in so you can ask them conversationally, one at a time.",
  schema: z.object({ kind: z.enum(["morning", "midday", "evening"]) }),
  kind: "read",
  async run(input) {
    const { MORNING_QUESTIONS, MIDDAY_QUESTIONS, EVENING_QUESTIONS } = await import("../interview");
    const kind = (input as { kind: string }).kind;
    const qs = kind === "morning" ? MORNING_QUESTIONS : kind === "midday" ? MIDDAY_QUESTIONS : EVENING_QUESTIONS;
    return ok("Questions", { kind, questions: qs.map((q) => ({ key: q.key, text: q.text, required: q.required, skippable: true })), note: kind === "evening" ? "Before the questions, go through today's open commitments (get_today) and record each outcome." : undefined });
  },
};

const saveCheckin: ToolDef = {
  name: "save_checkin_answers",
  description: "Save answers from a conversational check-in. Pass the user's words. A question the user chose to skip is saved as skipped.",
  schema: z.object({ kind: z.enum(["morning", "midday", "evening"]), answers: z.array(z.object({ key: z.string().max(60), question: z.string().max(300), answer: z.string().max(4000), skipped: z.boolean().default(false), follow_up_question: z.string().max(300).optional(), follow_up_answer: z.string().max(4000).optional() })).min(1).max(15), complete: z.boolean().default(true) }),
  kind: "write",
  async run(input, ctx) {
    const i = input as { kind: string; complete: boolean; answers: { key: string; question: string; answer: string; skipped: boolean; follow_up_question?: string; follow_up_answer?: string }[] };
    const { data: s, error } = await ctx.db.from("accountability_sessions").upsert({ user_id: ctx.userId, session_date: ctx.today, kind: i.kind, status: i.complete ? "completed" : "in_progress", completed_at: i.complete ? new Date().toISOString() : null }, { onConflict: "user_id,session_date,kind" }).select("id").single();
    if (error) return fail(error.message);
    const { error: e2 } = await ctx.db.from("accountability_answers").upsert(i.answers.map((a) => ({
      user_id: ctx.userId, session_id: s.id, question_key: a.key, question: a.question, answer: a.skipped ? "" : a.answer, skipped: a.skipped,
      follow_up_question: a.follow_up_question ?? null, follow_up_answer: a.follow_up_answer ?? null, follow_up_source: a.follow_up_question ? "ai" : null,
    })), { onConflict: "session_id,question_key" });
    if (e2) return fail(e2.message);
    if (i.complete) await ctx.db.from("reminders").update({ status: "cancelled" }).eq("dedupe_key", `checkin:${i.kind}:${ctx.today}`).eq("status", "scheduled");
    return ok(`${i.kind} check-in ${i.complete ? "completed" : "saved"} (${i.answers.length} answers)`, { session_id: s.id });
  },
};

const getVerses: ToolDef = {
  name: "get_quran_verses",
  description: "Verified Quran verses from the app's library (Arabic, translation, reference, translator). The ONLY permitted source for quoting the Quran. Filter by theme.",
  schema: z.object({ theme: z.enum(["honesty", "patience", "discipline", "self_control", "gratitude", "responsibility", "speech", "promises", "prayer", "wealth", "time", "repentance", "reliance", "composure"]).optional(), limit: z.number().int().min(1).max(5).default(2) }),
  kind: "read",
  async run(input, ctx) {
    const i = input as { theme?: string; limit: number };
    let q = ctx.db.from("quran_verses").select("surah,ayah,surah_name,arabic,translation,translator,topics");
    if (i.theme) q = q.contains("topics", [i.theme]);
    const { data } = await q.limit(20);
    if (!data?.length) return fail("The verse library hasn't been imported yet, or nothing matches. Do not quote from memory.");
    const pick = data.sort(() => Math.random() - 0.5).slice(0, i.limit);
    return ok("Verses", { verses: pick.map((v) => ({ reference: `${v.surah}:${v.ayah}`, surah: v.surah_name, arabic: v.arabic, translation: v.translation, translator: v.translator })), rule: "Quote exactly as given with reference and translator. Label any commentary as your reflection, not a ruling." });
  },
};

/* ----------------------------- activity lifecycle ----------------------------- */

const recordActivity: ToolDef = {
  name: "record_activity",
  description: "Record what happened with a scheduled activity today or yesterday (e.g. 'I finished my workout', 'I started the call', 'skip gym today because my knee hurts', 'running 15 min late'). Matches by description; if several match, the result lists them — ask which. Skips need a reason from the user. Report exactly what the result says.",
  schema: z.object({ query: z.string().min(1).max(200), outcome: z.enum(["start", "complete", "late", "skip"]), reason: z.string().max(500).optional(), duration_minutes: z.number().int().min(1).max(600).optional(), minutes_late: z.number().int().min(5).max(180).optional() }),
  kind: "write",
  async run(input, ctx) {
    const i = input as { query: string; outcome: "start" | "complete" | "late" | "skip"; reason?: string; duration_minutes?: number; minutes_late?: number };
    if (i.outcome === "skip" && !i.reason?.trim()) return fail("Ask the user for a short reason before recording a skip.");
    const occs = await eventsBetween(ctx.db, shiftDate(ctx.today, -1), ctx.today, ctx.tz);
    const now = Date.now();
    const candidates = occs.filter((o) => !o.event.all_day && o.start.getTime() <= now + 2 * 3600_000);
    const r = resolve(i.query, candidates, (o) => o.event.title);
    if (r.kind === "none") return fail(`No scheduled activity today matches “${i.query}”.`, { scheduled_today: candidates.map((o) => ({ title: o.event.title, at: fmt(o.start, ctx.tz, "h:mm a") })) });
    let pickOcc = r.kind === "one" ? r.item : null;
    if (r.kind === "many") {
      const sameEvent = new Set(r.items.map((o) => o.event.id));
      if (sameEvent.size === 1) pickOcc = r.items.sort((a, b) => Math.abs(+a.start - now) - Math.abs(+b.start - now))[0];
      else return { ok: false, summary: "Several activities match", result: { ambiguous: true, matches: r.items.map((o) => ({ title: o.event.title, at: fmt(o.start, ctx.tz) })) } };
    }
    const o = pickOcc!;
    const { applyOccurrenceAction } = await import("../occurrences");
    const action = i.outcome === "complete" ? { type: "complete" as const, durationMinutes: i.duration_minutes } : i.outcome === "late" ? { type: "late" as const, minutes: i.minutes_late } : i.outcome === "skip" ? { type: "skip" as const, reason: i.reason! } : { type: "start" as const };
    try {
      const out = await applyOccurrenceAction(ctx.db, ctx.userId, o.event, o.start, action, "coach", ctx.tz);
      await audit(ctx, `activity.${i.outcome}`, "event", o.event.id, { occurrence: o.start.toISOString() });
      return ok(out.message, { activity: o.event.title, scheduled: fmt(o.start, ctx.tz), status: out.occurrence.status, duration_minutes: out.occurrence.duration_minutes },
        { undo: { tool: "reopen_activity", input: { event_id: o.event.id, start: o.start.toISOString() } }, entity: { type: "event", id: o.event.id } });
    } catch (e) {
      return fail((e as Error).message);
    }
  },
};

const reopenActivity: ToolDef = {
  name: "reopen_activity",
  description: "Undo a recorded activity outcome (internal).",
  schema: z.object({ event_id: z.uuid(), start: z.string() }),
  kind: "write",
  async run(input, ctx) {
    const i = input as { event_id: string; start: string };
    const { data: ev } = await ctx.db.from("events").select("*").eq("id", i.event_id).maybeSingle<CalendarEvent>();
    if (!ev) return fail("Activity not found.");
    const { applyOccurrenceAction } = await import("../occurrences");
    const out = await applyOccurrenceAction(ctx.db, ctx.userId, ev, new Date(i.start), { type: "reopen" }, "coach", ctx.tz);
    return ok(`Reopened ${ev.title}`, { status: out.occurrence.status });
  },
};

const getScores: ToolDef = {
  name: "get_scores",
  description: "The deterministic personal-development scores for a period (7d, 30d, 90d): overall, each domain, every metric with numerator/denominator, exclusions and evidence. Use to EXPLAIN scores. You cannot change or invent scores; say 'insufficient data' when the result does.",
  schema: z.object({ period: z.enum(["7d", "30d", "90d"]).default("30d") }),
  kind: "read",
  async run(input, ctx) {
    const i = input as { period: "7d" | "30d" | "90d" };
    const days = i.period === "7d" ? 7 : i.period === "90d" ? 90 : 30;
    const { data: prof } = await ctx.db.from("profiles").select("created_at").eq("id", ctx.userId).single();
    const { computeScores } = await import("../scoring");
    const { loadScoringInput } = await import("../scoring/load");
    const from = shiftDate(ctx.today, -(days - 1));
    const inputData = await loadScoringInput(ctx.db, { from, today: ctx.today, tz: ctx.tz, since: localDateString(new Date(prof?.created_at ?? Date.now()), ctx.tz) });
    const r = computeScores({ ...inputData, from, to: ctx.today });
    return ok("Scores", {
      policy: r.policyVersion, period: `${r.from} to ${r.to}`, overall: r.overall ?? "insufficient data", weight_covered: r.coverageWeight,
      excluded: r.excluded, domains: r.domains.map((d) => ({ domain: d.label, score: d.score ?? "insufficient data", weight: d.weight, metrics: d.metrics.map((m) => ({ metric: m.label, value: m.value === null ? "insufficient" : Math.round(m.value * 100), numerator: m.numerator, denominator: m.denominator, unknown_not_counted: m.unknown, excluded: m.excluded })) })),
      note: "Scores measure recorded behaviour only — not worth, intelligence or faith.",
    });
  },
};

export const TOOLS: ToolDef[] = [
  recordActivity, reopenActivity, getScores,
  getVerses,
  getToday, listTasks, createTask, updateTask, completeItem, reopenItem, restoreTask, deleteTask,
  createCommitment, deleteCommitment, resolveCommitment, listEvents, checkAvailability, createEvent,
  rescheduleEvent, deleteEvent, deleteEvents, planBlocks, createReminder, cancelReminder, createJournal,
  searchHistory, getPatterns, createGoal, archiveGoal, recordProgress, createHabit, logHabit,
  getPrayerTimes, confirmPrayer, unconfirmPrayer, startFocus, logImpulse, proposeMemory, checkinQuestions, saveCheckin,
];

/** Tools only used internally for undo; not offered to the model. */
const INTERNAL = new Set(["reopen_item", "restore_task", "archive_goal", "unconfirm_prayer", "delete_events", "reopen_activity"]);
export const MODEL_TOOLS = TOOLS.filter((t) => !INTERNAL.has(t.name));
export const toolByName = (n: string) => TOOLS.find((t) => t.name === n);

export function anthropicToolSpecs() {
  return MODEL_TOOLS.map((t) => {
    const schema = z.toJSONSchema(t.schema) as Record<string, unknown>;
    delete schema.$schema;
    return { name: t.name, description: t.description, input_schema: schema };
  });
}

export { audit as auditToolAction };
