import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { exchangeCode, pullChanges } from "@/lib/google";
import { buildEventReminderRows, insertRows } from "@/lib/reminders";
import type { CalendarEvent } from "@/lib/types";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const back = (q: string) => NextResponse.redirect(new URL(`/settings/calendar?${q}`, url.origin));
  const db = await createClient();
  const { data } = await db.auth.getUser();
  if (!data.user) return NextResponse.redirect(new URL("/login", url.origin));
  const state = url.searchParams.get("state");
  const expected = req.cookies.get("g_oauth_state")?.value;
  if (!state || !expected || state !== expected) return back("error=state");
  if (url.searchParams.get("error")) return back(`error=${encodeURIComponent(url.searchParams.get("error")!)}`);
  const code = url.searchParams.get("code");
  if (!code) return back("error=no_code");
  const admin = createAdminClient();
  try {
    await exchangeCode(admin, data.user.id, code);
    const { data: p } = await db.from("profiles").select("timezone").eq("id", data.user.id).single();
    const r = await pullChanges(admin, data.user.id, p?.timezone ?? "UTC");
    if (r.changedIds.length) {
      const { data: evs } = await admin.from("events").select("*").in("id", r.changedIds);
      for (const ev of (evs ?? []) as CalendarEvent[]) await insertRows(admin, buildEventReminderRows(data.user.id, ev, p?.timezone ?? "UTC"));
    }
    await admin.from("audit_logs").insert({ user_id: data.user.id, actor: "user", action: "google.connected", detail: { imported: r.created } });
    const res = back(`connected=1&imported=${r.created}`);
    res.cookies.delete({ name: "g_oauth_state", path: "/api/google" });
    return res;
  } catch (e) {
    return back(`error=${encodeURIComponent((e as Error).message.slice(0, 200))}`);
  }
}
