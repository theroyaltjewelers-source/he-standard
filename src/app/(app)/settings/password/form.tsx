"use client";

import { useActionState } from "react";
import { changePassword, type PwState } from "@/app/actions/password";

export function PasswordForm() {
  const [state, action, pending] = useActionState<PwState, FormData>(changePassword, undefined);
  return (
    <form action={action} className="max-w-sm space-y-4">
      <div><label className="label" htmlFor="pw">New password</label><input id="pw" type="password" name="password" minLength={10} autoComplete="new-password" required className="field" /></div>
      <div><label className="label" htmlFor="pw2">Repeat it</label><input id="pw2" type="password" name="confirm" minLength={10} autoComplete="new-password" required className="field" /></div>
      {state?.error && <p role="alert" className="text-sm text-brass">{state.error}</p>}
      {state?.ok && <p role="status" className="text-sm text-emerald">Password changed.</p>}
      <button className="btn btn-primary" disabled={pending} data-state={pending ? "loading" : undefined}>Change password</button>
    </form>
  );
}
