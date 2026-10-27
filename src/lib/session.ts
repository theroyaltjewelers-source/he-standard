import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";
import { todayIn } from "@/lib/time";

/** Signed-in user + profile for the current request. Redirects when signed out or not yet onboarded. */
export const requireUser = cache(async (opts: { allowIncomplete?: boolean } = {}) => {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", auth.user.id).single<Profile>();
  if (!profile) redirect("/login?error=profile");
  if (!profile.onboarding_completed_at && !opts.allowIncomplete) redirect("/onboarding");
  const today = todayIn(profile.timezone);
  return { supabase, user: auth.user, profile, today };
});
