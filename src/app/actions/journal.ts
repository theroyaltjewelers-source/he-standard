"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import Anthropic from "@anthropic-ai/sdk";
import { JOURNAL_TAGS, type JournalEntry } from "@/lib/types";
import { GUIDED_MODES } from "@/lib/reflection";
import { env } from "@/lib/env";

export type JournalState = { error?: string } | undefined;
const s = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");

const schema = z.object({
  id: z.uuid().or(z.literal("")),
  title: z.string().max(200),
  body: z.string().min(1, "Write something first.").max(50000),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mood: z.coerce.number().int().min(1).max(5).nullable(),
  energy: z.coerce.number().int().min(1).max(5).nullable(),
  tags: z.array(z.enum(JOURNAL_TAGS)),
  input_method: z.enum(["typed", "voice"]),
  ai_analysis_allowed: z.boolean(),
  guided_mode: z.enum(GUIDED_MODES.map((m) => m.key) as [string, ...string[]]),
});

export async function saveJournal(_: JournalState, form: FormData): Promise<JournalState> {
  const { supabase, user, today } = await requireUser();
  const parsed = schema.safeParse({
    id: s(form, "id"), title: s(form, "title"), body: s(form, "body"), entry_date: s(form, "entry_date") || today,
    mood: s(form, "mood") || null, energy: s(form, "energy") || null, tags: form.getAll("tags"),
    input_method: s(form, "input_method") === "voice" ? "voice" : "typed",
    ai_analysis_allowed: form.get("ai_excluded") !== "on",
    guided_mode: s(form, "guided_mode") || "free",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { id, ...d } = parsed.data;
  const row = { ...d, title: d.title || null, user_id: user.id };
  const { data, error } = id
    ? await supabase.from("journal_entries").update(row).eq("id", id).select("id").single()
    : await supabase.from("journal_entries").insert(row).select("id").single();
  if (error) return { error: error.message };
  revalidatePath("/journal");
  revalidatePath("/today");
  redirect(`/journal/${data.id}`);
}

export async function deleteJournal(form: FormData) {
  const { supabase } = await requireUser();
  await supabase.from("journal_entries").delete().eq("id", s(form, "id"));
  revalidatePath("/journal");
  redirect("/journal");
}

export type ReflectState = { error?: string; ok?: boolean } | undefined;

/**
 * Reflect Deeper: Claude reads one entry (only with account consent and the
 * entry's own permission) and responds with a short observation and a few
 * questions. Stored separately from the entry and always labelled.
 */
export async function reflectDeeper(_: ReflectState, form: FormData): Promise<ReflectState> {
  const { supabase, user, profile } = await requireUser();
  if (!profile.ai_analysis_consent) return { error: "AI analysis is off for your account. Turn it on in Settings to use this." };
  const key = env.anthropicKey();
  if (!key) return { error: "The AI service isn't configured yet (ANTHROPIC_API_KEY)." };
  const { data: e } = await supabase.from("journal_entries").select("*").eq("id", s(form, "id")).single<JournalEntry>();
  if (!e) return { error: "Entry not found." };
  if (!e.ai_analysis_allowed) return { error: "This entry is excluded from AI analysis." };
  try {
    const client = new Anthropic({ apiKey: key, timeout: 40_000, maxRetries: 1 });
    const res = await client.messages.create({
      model: env.anthropicModel(), max_tokens: 700,
      system: [
        "You help a person reflect on one private journal entry inside an accountability app.",
        "Respond ONLY with JSON: {\"reflection\": string (<= 110 words), \"questions\": [3 short open questions]}.",
        "The reflection names what you notice in what they wrote — patterns, tensions between intention and action, what seems to matter to them — using their own words where possible.",
        "Rules: no diagnosis, no personality labels, no moralising, no religious rulings, no flattery. Be warm, plain and specific.",
        "If the entry mentions self-harm or crisis, gently encourage reaching out to someone they trust or a local crisis line, and do not ask probing questions.",
      ].join(" "),
      messages: [{ role: "user", content: `Date: ${e.entry_date}\nMode: ${e.guided_mode ?? "free"}\nMood: ${e.mood ?? "?"}/5, energy: ${e.energy ?? "?"}/5\n\n${e.title ? e.title + "\n" : ""}${e.body.slice(0, 12000)}` }],
    });
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    const reflection = String(j.reflection ?? "").trim();
    if (!reflection) return { error: "No reflection came back. Try again." };
    await supabase.from("journal_reflections").insert({ user_id: user.id, entry_id: e.id, reflection, questions: (j.questions ?? []).map(String).slice(0, 4), model: env.anthropicModel() });
  } catch (err) {
    return { error: `Couldn't reflect right now: ${(err as Error).message.slice(0, 120)}` };
  }
  revalidatePath(`/journal/${e.id}`);
  return { ok: true };
}

export async function deleteReflection(form: FormData) {
  const { supabase } = await requireUser();
  await supabase.from("journal_reflections").delete().eq("id", s(form, "id"));
  revalidatePath(`/journal/${s(form, "entry_id")}`);
}
