"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({ children, pendingText, className = "btn btn-primary", ...rest }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" {...rest} className={className} disabled={pending || rest.disabled}>
      {pending ? pendingText ?? "Saving…" : children}
    </button>
  );
}
