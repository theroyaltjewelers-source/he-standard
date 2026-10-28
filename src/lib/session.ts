import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";
import { todayIn } from "@/lib/time";

const VERIFIED_USER = "x-standard-user";
const VERIFIED_EMAIL = "x-standard-email";

/**
 * Identity for this request. The proxy verifies the session on every request
 * and forwards the user id in a header it controls (client copies are
 * stripped), so pages don't pay a second auth round trip. Data access still
 * goes through RLS with the user's JWT. Falls back to a full check if the
 * header is absent (e.g. a route outside the proxy matcher).
 */
const session = cache(async () => {
  const supabase = await createClient();
  const h = await headers();
  let id = h.get(VERIFIED_USER);
  let email = h.get(VERIFIED_EMAIL) ?? undefined;
  if (!id) {
    const { data: auth } = await supabase.auth.getUser();
    id = auth.user?.id ?? null;
    email = auth.user?.email;
  }
  if (!id) return null;
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", id).single<Profile>();
  return { supabase, user: { id, email }, profile };
});

/** Signed-in user + profile for the current request. Redirects when signed out or not yet onboarded. */
export async function requireUser(opts: { allowIncomplete?: boolean } = {}) {
  const s = await session();
  if (!s) redirect("/login");
  if (!s.profile) redirect("/login?error=profile");
  if (!s.profile.onboarding_completed_at && !opts.allowIncomplete) redirect("/onboarding");
  return { supabase: s.supabase, user: s.user, profile: s.profile, today: todayIn(s.profile.timezone) };
}
