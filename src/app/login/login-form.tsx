"use client";

import { useActionState, useState } from "react";
import { authenticate, sendMagicLink, sendPasswordReset, type AuthState } from "./actions";

type Mode = "signin" | "signup";

export function LoginForm({ next }: { next: string }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [state, action, pending] = useActionState<AuthState, FormData>(authenticate, undefined);
  const [linkState, linkAction, linkPending] = useActionState<AuthState, FormData>(sendMagicLink, undefined);
  const [resetState, resetAction, resetPending] = useActionState<AuthState, FormData>(sendPasswordReset, undefined);
  const notice = state ?? linkState ?? resetState;

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="mode" value={mode} />
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required className="field" />
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          minLength={10}
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          className="field"
        />
        {mode === "signup" && <p className="mt-2 text-sm text-ivory-faint">At least 10 characters.</p>}
      </div>

      {notice?.error && <p role="alert" className="text-sm text-brass">{notice.error}</p>}
      {notice?.message && <p role="status" className="text-sm text-emerald">{notice.message}</p>}

      <button type="submit" className="btn btn-primary w-full" disabled={pending} data-state={pending ? "loading" : undefined}>
        {pending ? "One moment…" : mode === "signin" ? "Sign in" : "Create account"}
      </button>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 text-sm">
        <button
          type="button"
          className="text-ivory-dim underline-offset-4 hover:underline"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
        >
          {mode === "signin" ? "Create an account" : "I already have an account"}
        </button>
        {mode === "signin" && (
          <span className="flex gap-4">
            <button formAction={linkAction} formNoValidate disabled={linkPending} className="text-ivory-dim underline-offset-4 hover:underline">
              Email me a link
            </button>
            <button formAction={resetAction} formNoValidate disabled={resetPending} className="text-ivory-dim underline-offset-4 hover:underline">
              Reset password
            </button>
          </span>
        )}
      </div>
    </form>
  );
}
