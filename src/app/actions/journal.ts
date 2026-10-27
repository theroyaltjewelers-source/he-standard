"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { JOURNAL_TAGS } from "@/lib/types";

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
});

export async function saveJournal(_: JournalState, form: FormData): Promise<JournalState> {
  const { supabase, user, today } = await requireUser();
  const parsed = schema.safeParse({
    id: s(form, "id"), title: s(form, "title"), body: s(form, "body"), entry_date: s(form, "entry_date") || today,
    mood: s(form, "mood") || null, energy: s(form, "energy") || null, tags: form.getAll("tags"),
    input_method: s(form, "input_method") === "voice" ? "voice" : "typed",
    ai_analysis_allowed: form.get("ai_excluded") !== "on",
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
