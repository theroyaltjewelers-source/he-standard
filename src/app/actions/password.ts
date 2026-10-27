"use server";

import { createClient } from "@/lib/supabase/server";

export type PwState = { error?: string; ok?: boolean } | undefined;

export async function changePassword(_: PwState, form: FormData): Promise<PwState> {
  const pw = String(form.get("password") ?? "");
  if (pw.length < 10) return { error: "Use at least 10 characters." };
  if (pw !== String(form.get("confirm") ?? "")) return { error: "The two passwords don't match." };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: pw });
  if (error) return { error: error.message };
  return { ok: true };
}
