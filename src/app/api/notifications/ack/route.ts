import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Called by the service worker when a notification is shown or tapped. */
export async function POST(req: Request) {
  const { id, event } = (await req.json().catch(() => ({}))) as { id?: string; event?: string };
  if (!id || (event !== "displayed" && event !== "clicked")) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const supabase = await createClient();
  const { error } = await supabase.rpc("ack_notification", { p_id: id, p_event: event });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
