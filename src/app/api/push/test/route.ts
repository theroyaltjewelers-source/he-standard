import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushToUser } from "@/lib/push";

/** Sends a test notification immediately and reports exactly what the push service said. */
export async function POST() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const r = await sendPushToUser(createAdminClient(), auth.user.id, {
      title: "Test notification",
      body: "If you can read this, reminders reach this device.",
      url: "/reminders",
    });
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
