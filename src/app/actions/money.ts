"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/session";

const s = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).trim() : "");

const schema = z.object({
  kind: z.enum(["income", "expense", "bill", "debt_payment", "savings"]),
  scope: z.enum(["personal", "business"]),
  amount: z.coerce.number().min(0, "Amount can't be negative.").max(10_000_000),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.string().max(60),
  description: z.string().max(300),
  discretionary: z.boolean(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")),
  reflection: z.string().max(500),
});

export type MoneyState = { error?: string; ok?: boolean } | undefined;

/** Manual entries only. The app never asks for bank credentials. */
export async function addEntry(_: MoneyState, form: FormData): Promise<MoneyState> {
  const { supabase, user, today } = await requireUser();
  const parsed = schema.safeParse({
    kind: s(form, "kind"), scope: s(form, "scope") || "personal", amount: s(form, "amount"), entry_date: s(form, "entry_date") || today,
    category: s(form, "category"), description: s(form, "description"), discretionary: form.get("discretionary") === "on",
    due_date: s(form, "due_date"), reflection: s(form, "reflection"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (!s(form, "amount")) return { error: "Enter an amount." };
  const d = parsed.data;
  const { error } = await supabase.from("financial_entries").insert({
    user_id: user.id, ...d, category: d.category || null, description: d.description || null, reflection: d.reflection || null,
    due_date: d.kind === "bill" ? d.due_date || d.entry_date : null, paid: d.kind === "bill" ? false : null,
    discretionary: d.kind === "expense" ? d.discretionary : false,
  });
  if (error) return { error: error.message };
  revalidatePath("/money");
  return { ok: true };
}

export async function markBillPaid(form: FormData) {
  const { supabase } = await requireUser();
  await supabase.from("financial_entries").update({ paid: s(form, "paid") !== "false" }).eq("id", s(form, "id"));
  revalidatePath("/money");
}

export async function deleteEntry(form: FormData) {
  const { supabase } = await requireUser();
  await supabase.from("financial_entries").delete().eq("id", s(form, "id"));
  revalidatePath("/money");
}
