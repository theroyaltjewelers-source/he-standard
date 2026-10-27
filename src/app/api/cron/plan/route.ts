import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/api/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { planAllUsers } from "@/lib/reminders";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(req: Request) {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const summary = await planAllUsers(createAdminClient());
    return NextResponse.json({ ok: true, at: new Date().toISOString(), ...summary });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
export const GET = handle;
export const POST = handle;
