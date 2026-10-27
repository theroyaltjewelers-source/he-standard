"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { IMPULSE_KINDS, type FocusSession } from "@/lib/types";

const s = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");
const refresh = () => { revalidatePath("/rhythm"); revalidatePath("/today"); };

/* ------------------------------- focus ------------------------------- */

export async function startFocus(form: FormData) {
  const { supabase, user } = await requireUser();
  const minutes = z.coerce.number().int().min(5).max(240).catch(25).parse(s(form, "minutes"));
  // Only one active session at a time: an unfinished one is closed as abandoned.
  await supabase.from("focus_sessions").update({ status: "abandoned", ended_at: new Date().toISOString() }).eq("status", "active");
  const started = new Date();
  await supabase.from("focus_sessions").insert({
    user_id: user.id, planned_minutes: minutes, intention: s(form, "intention") || null, task_id: s(form, "task_id") || null,
    started_at: started.toISOString(), ends_at: new Date(started.getTime() + minutes * 60_000).toISOString(),
  });
  refresh();
}

export async function logDistraction(form: FormData) {
  const { supabase } = await requireUser();
  const id = s(form, "id");
  const { data } = await supabase.from("focus_sessions").select("distractions").eq("id", id).single<Pick<FocusSession, "distractions">>();
  if (!data) return;
  const note = s(form, "note").slice(0, 200) || "Distracted";
  await supabase.from("focus_sessions").update({ distractions: [...(data.distractions ?? []), { at: new Date().toISOString(), note }] }).eq("id", id);
  refresh();
}

export async function endFocus(form: FormData) {
  const { supabase } = await requireUser();
  const status = s(form, "status") === "abandoned" ? "abandoned" : "completed";
  await supabase.from("focus_sessions").update({ status, ended_at: new Date().toISOString(), note: s(form, "note") || null }).eq("id", s(form, "id"));
  refresh();
}

/* ------------------------------ impulses ----------------------------- */

const impulseSchema = z.object({
  kind: z.enum(IMPULSE_KINDS.map((k) => k.key) as [string, ...string[]]),
  feeling: z.string().max(300), trigger_note: z.string().max(500), seeking: z.string().max(500),
  consequence: z.string().max(500), alternative: z.string().max(500),
  intervention: z.enum(["pause", "breathing", "alternative_task", "reflection", "none"]),
});

export type ImpulseState = { error?: string; id?: string } | undefined;

/** Record the urge and the interruption the user chose. The outcome is recorded later, honestly. */
export async function logImpulse(_: ImpulseState, form: FormData): Promise<ImpulseState> {
  const { supabase, user } = await requireUser();
  const parsed = impulseSchema.safeParse({
    kind: s(form, "kind"), feeling: s(form, "feeling"), trigger_note: s(form, "trigger_note"), seeking: s(form, "seeking"),
    consequence: s(form, "consequence"), alternative: s(form, "alternative"), intervention: s(form, "intervention") || "pause",
  });
  if (!parsed.success) return { error: "Choose what the urge is." };
  const d = parsed.data;
  const { data, error } = await supabase.from("impulse_logs").insert({
    user_id: user.id, ...d,
    feeling: d.feeling || null, trigger_note: d.trigger_note || null, seeking: d.seeking || null, consequence: d.consequence || null, alternative: d.alternative || null,
  }).select("id").single();
  if (error) return { error: error.message };
  refresh();
  return { id: data.id };
}

export async function resolveImpulse(form: FormData) {
  const { supabase } = await requireUser();
  const outcome = z.enum(["resisted", "acted", "partly", "unsure"]).parse(s(form, "outcome"));
  await supabase.from("impulse_logs").update({ outcome, resolved_at: new Date().toISOString() }).eq("id", s(form, "id"));
  refresh();
}
