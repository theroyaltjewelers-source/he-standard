"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type AuthState = { error?: string; message?: string } | undefined;

const creds = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(10, "Use at least 10 characters for your password."),
});

async function origin() {
  const h = await headers();
  return process.env.NEXT_PUBLIC_APP_URL || `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
}

function safeNext(v: FormDataEntryValue | null) {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : "/today";
}

export async function signIn(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = creds.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return {
      error: error.message.toLowerCase().includes("confirm")
        ? "Confirm your email first — check your inbox for the link."
        : "That email and password don't match an account.",
    };
  }
  redirect(safeNext(form.get("next")));
}

export async function signUp(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = creds.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    ...parsed.data,
    options: { emailRedirectTo: `${await origin()}/auth/callback?next=/onboarding` },
  });
  if (error) return { error: error.message };
  if (data.session) redirect("/onboarding");
  return { message: "Check your email to confirm your account, then sign in." };
}

export async function sendMagicLink(_: AuthState, form: FormData): Promise<AuthState> {
  const email = z.email().safeParse(form.get("email"));
  if (!email.success) return { error: "Enter a valid email address." };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: email.data,
    options: { emailRedirectTo: `${await origin()}/auth/callback?next=/today`, shouldCreateUser: false },
  });
  if (error) return { error: "Couldn't send a sign-in link. Check the address or try again in a minute." };
  return { message: "Sign-in link sent. It expires in one hour." };
}

export async function sendPasswordReset(_: AuthState, form: FormData): Promise<AuthState> {
  const email = z.email().safeParse(form.get("email"));
  if (!email.success) return { error: "Enter your email address above first." };
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${await origin()}/auth/callback?next=/settings/password`,
  });
  // Same message whether or not the account exists.
  return { message: "If that email has an account, a reset link is on its way." };
}

export async function authenticate(prev: AuthState, form: FormData): Promise<AuthState> {
  return form.get("mode") === "signup" ? signUp(prev, form) : signIn(prev, form);
}
