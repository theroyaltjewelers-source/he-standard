import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// The verse library only grows (the importer adds verses; none are removed), so
// its size is cached per server instance for 10 minutes to avoid an extra
// sequential query on every Today load.
let cached: { n: number; at: number } | null = null;
export async function verseTotal(db: SupabaseClient): Promise<number> {
  if (cached && Date.now() - cached.at < 600_000) return cached.n;
  const { count } = await db.from("quran_verses").select("id", { count: "exact", head: true });
  cached = { n: count ?? 0, at: Date.now() };
  return cached.n;
}
