import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const TABLES = [
  "goals", "goal_progress", "habits", "habit_logs", "tasks", "commitments", "events", "reminders",
  "notifications", "journal_entries", "daily_plans", "accountability_sessions", "accountability_answers",
  "ai_memory", "ai_memory_sources", "ai_observations", "weekly_reports", "goal_milestones",
  "user_preferences", "prayer_settings", "prayer_confirmations", "spiritual_logs", "verse_reflections",
  "focus_sessions", "impulse_logs", "financial_entries", "ai_conversations", "ai_messages", "ai_tool_executions",
  "audit_logs", "calendar_sync_state", "activity_occurrences", "workout_logs", "notification_action_log",
  "task_series", "workout_exercises", "workout_sets", "body_metrics", "food_entries", "daily_scores", "record_revisions",
] as const;

/** Full export of everything stored about the signed-in user, as JSON. */
export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const out: Record<string, unknown> = {
    exported_at: new Date().toISOString(),
    account: { id: auth.user.id, email: auth.user.email, created_at: auth.user.created_at },
  };
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", auth.user.id).single();
  out.profile = profile;
  for (const t of TABLES) {
    const rows: unknown[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from(t).select("*").range(from, from + 999);
      if (error) return NextResponse.json({ error: `${t}: ${error.message}` }, { status: 500 });
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    out[t] = rows;
  }
  // Push keys are device secrets, not personal content.
  const { data: devices } = await supabase.from("push_subscriptions").select("id,device_label,created_at,last_success_at");
  out.devices = devices;

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(out, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="the-standard-export-${stamp}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
