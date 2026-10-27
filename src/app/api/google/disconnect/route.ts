import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decrypt } from "@/lib/crypto";

/** Revokes the Google grant and deletes stored tokens. Imported events stay unless the user deletes them. */
export async function POST(req: Request) {
  const db = await createClient();
  const { data } = await db.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  const { data: acct } = await admin.from("connected_accounts").select("*").eq("user_id", data.user.id).eq("provider", "google").maybeSingle();
  if (acct?.refresh_token_enc) {
    try { await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(decrypt(acct.refresh_token_enc))}`, { method: "POST" }); } catch { /* deleting locally regardless */ }
  }
  await admin.from("connected_accounts").delete().eq("user_id", data.user.id).eq("provider", "google");
  await admin.from("calendar_sync_state").delete().eq("user_id", data.user.id);
  await admin.from("audit_logs").insert({ user_id: data.user.id, actor: "user", action: "google.disconnected", detail: {} });
  return NextResponse.redirect(new URL("/settings/calendar?disconnected=1", req.url), { status: 303 });
}
