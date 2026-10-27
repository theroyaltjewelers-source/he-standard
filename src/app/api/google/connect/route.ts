import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { authUrl, googleConfigured } from "@/lib/google";

export async function GET(req: Request) {
  const db = await createClient();
  const { data } = await db.auth.getUser();
  if (!data.user) return NextResponse.redirect(new URL("/login", req.url));
  if (!googleConfigured()) return NextResponse.redirect(new URL("/settings/calendar?error=not_configured", req.url));
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(authUrl(state));
  res.cookies.set("g_oauth_state", state, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/google", maxAge: 600 });
  return res;
}
