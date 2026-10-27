"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { generateWeeklyReport } from "@/lib/weekly";
import { shiftDate, weekStart } from "@/lib/time";

/** Generate (or regenerate) the report for the current week so far, or for last week. */
export async function generateReportNow(form: FormData) {
  const { supabase, user, profile, today } = await requireUser();
  const which = form.get("week") === "last" ? shiftDate(weekStart(today), -7) : weekStart(today);
  await generateWeeklyReport(supabase, user.id, which, profile.timezone, profile.ai_analysis_consent);
  await supabase.from("audit_logs").insert({ user_id: user.id, actor: "user", action: "weekly_report.generated", detail: { week_start: which } }).then(() => null, () => null);
  revalidatePath("/progress");
}
