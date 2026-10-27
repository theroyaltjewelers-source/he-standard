import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayIn } from "@/lib/time";
import type { Profile } from "@/lib/types";
import type { ToolContext } from "./tools";

/** Authenticated context for coach API routes. The user id always comes from the session, never from the request body. */
export async function coachContext(): Promise<{ ctx: ToolContext; profile: Profile } | null> {
  const db = await createClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return null;
  const { data: profile } = await db.from("profiles").select("*").eq("id", auth.user.id).single<Profile>();
  if (!profile) return null;
  return {
    profile,
    ctx: { db, admin: createAdminClient(), userId: auth.user.id, tz: profile.timezone, today: todayIn(profile.timezone), aiConsent: profile.ai_analysis_consent },
  };
}
