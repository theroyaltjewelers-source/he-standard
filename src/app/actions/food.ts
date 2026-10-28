"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { validateFood, type FieldErrors, type FoodInput } from "@/lib/food";

export type FoodEntryRow = {
  id: string; description: string; eaten_at: string; local_date: string; timezone: string;
  meal: string | null; portion: string | null; notes: string | null; created_at: string; updated_at: string;
};
export type FoodResult =
  | { ok: true; entry: FoodEntryRow; movedFrom?: string }
  | { ok: false; error: string; fieldErrors?: FieldErrors };

const COLS = "id,description,eaten_at,local_date,timezone,meal,portion,notes,created_at,updated_at";
const uuid = z.uuid();
const SAVE_FAILED = "Couldn't save your entry. Your details are still here—try again.";

function refresh() { revalidatePath("/food"); revalidatePath("/today"); }

/**
 * Create or update a food entry. Ownership comes from the session (never from
 * the client); RLS enforces it again in the database. `requestId` makes a
 * repeated submit (double tap, retry after a dropped connection) return the
 * same entry instead of creating a duplicate.
 */
export async function saveFoodEntry(input: FoodInput & { id?: string | null; requestId?: string | null }): Promise<FoodResult> {
  const { supabase, user, profile } = await requireUser();
  const v = validateFood(input, profile.timezone);
  if (!v.ok) return { ok: false, error: "Check the highlighted fields.", fieldErrors: v.errors };
  const row = { ...v.values, timezone: profile.timezone };

  if (input.id) {
    if (!uuid.safeParse(input.id).success) return { ok: false, error: "That entry couldn't be found." };
    const { data: before } = await supabase.from("food_entries").select("local_date").eq("id", input.id).eq("user_id", user.id).maybeSingle();
    if (!before) return { ok: false, error: "That entry couldn't be found. It may have been deleted." };
    const { data, error } = await supabase.from("food_entries").update(row).eq("id", input.id).eq("user_id", user.id).select(COLS).single<FoodEntryRow>();
    if (error || !data) return { ok: false, error: SAVE_FAILED };
    refresh();
    return { ok: true, entry: data, movedFrom: before.local_date !== data.local_date ? before.local_date : undefined };
  }

  const requestId = input.requestId && /^[\w-]{8,64}$/.test(input.requestId) ? input.requestId : null;
  const { data, error } = await supabase.from("food_entries")
    .upsert({ ...row, user_id: user.id, client_request_id: requestId }, { onConflict: "user_id,client_request_id", ignoreDuplicates: true })
    .select(COLS);
  let entry = (data?.[0] ?? null) as FoodEntryRow | null;
  if (!entry && requestId && !error) {
    // Duplicate submit: return the entry the first request created.
    const { data: existing } = await supabase.from("food_entries").select(COLS).eq("user_id", user.id).eq("client_request_id", requestId).maybeSingle<FoodEntryRow>();
    entry = existing;
  }
  if (error || !entry) return { ok: false, error: SAVE_FAILED };
  refresh();
  return { ok: true, entry };
}

export async function deleteFoodEntry(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, user } = await requireUser();
  if (!uuid.safeParse(id).success) return { ok: false, error: "That entry couldn't be found." };
  const { data, error } = await supabase.from("food_entries").delete().eq("id", id).eq("user_id", user.id).select("id");
  if (error) return { ok: false, error: "Couldn't delete the entry. Try again." };
  if (!data?.length) return { ok: false, error: "That entry couldn't be found. It may already be deleted." };
  refresh();
  return { ok: true };
}
