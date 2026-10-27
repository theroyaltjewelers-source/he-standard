import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { pullChanges } from "@/lib/google";
import { buildEventReminderRows, insertRows } from "@/lib/reminders";
import type { CalendarEvent } from "@/lib/types";

export async function POST(req: Request) {
  const db = await createClient();
  const { data } = await db.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: p } = await db.from("profiles").select("timezone").eq("id", data.user.id).single();
  const admin = createAdminClient();
  try {
    const r = await pullChanges(admin, data.user.id, p?.timezone ?? "UTC");
    if (r.changedIds.length) {
      const { data: evs } = await admin.from("events").select("*").in("id", r.changedIds);
      for (const ev of (evs ?? []) as CalendarEvent[]) {
        await admin.from("reminders").delete().eq("entity_type", "event").eq("entity_id", ev.id).eq("status", "scheduled");
        await insertRows(admin, buildEventReminderRows(data.user.id, ev, p?.timezone ?? "UTC"));
      }
    }
    return NextResponse.redirect(new URL(`/settings/calendar?synced=${r.created + r.updated + r.deleted}`, req.url), { status: 303 });
  } catch (e) {
    return NextResponse.redirect(new URL(`/settings/calendar?error=${encodeURIComponent((e as Error).message.slice(0, 200))}`, req.url), { status: 303 });
  }
}
