import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  // Stop this device receiving the account's notifications once signed out.
  const form = await request.formData().catch(() => null);
  const endpoint = form?.get("endpoint");
  if (typeof endpoint === "string" && endpoint.startsWith("https://")) {
    await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  }
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
