import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/api/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { planAllUsers } from "@/lib/jobs";
import { processOutbox, recordJob } from "@/lib/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(req: Request) {
  if (!(await isAuthorizedCron(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const admin = createAdminClient();
    const summary = await recordJob(admin, "plan", async () => ({ ...(await planAllUsers(admin)), ...(await processOutbox(admin)) }));
    return NextResponse.json({ ok: true, at: new Date().toISOString(), ...summary });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
export const GET = handle;
export const POST = handle;
