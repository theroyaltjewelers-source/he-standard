"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { haptic } from "@/lib/haptics";

/**
 * Form submit button with loading, success and error states. Success is shown
 * only when the action's returned state says it succeeded.
 */
export function SubmitButton({ children, pendingText, successText, className = "btn btn-primary", result, ...rest }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { pendingText?: string; successText?: string; result?: { ok?: unknown; error?: string } | null }) {
  const { pending } = useFormStatus();
  const [flash, setFlash] = useState<null | "success" | "error">(null);
  const last = useRef(result);
  useEffect(() => {
    if (result === last.current) return;
    last.current = result;
    if (!result) return;
    const s = result.error ? "error" : result.ok ? "success" : null;
    if (!s) return;
    if (s === "success") haptic(10);
    const t1 = setTimeout(() => setFlash(s), 0);
    const t2 = setTimeout(() => setFlash(null), 1600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [result]);
  const state = pending ? "loading" : flash ?? undefined;
  return (
    <button type="submit" {...rest} className={className} data-state={state} disabled={pending || rest.disabled} aria-busy={pending}>
      {pending ? pendingText ?? "Saving…" : flash === "success" ? (
        <><svg className="check-draw" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden><path d="M5 12.5l4 4 10-10" /></svg>{successText ?? "Saved"}</>
      ) : flash === "error" ? "Try again" : children}
    </button>
  );
}
