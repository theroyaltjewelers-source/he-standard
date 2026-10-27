"use client";

import { useActionState } from "react";
import { reflectDeeper, type ReflectState } from "@/app/actions/journal";

export function ReflectDeeperButton({ id, label }: { id: string; label: string }) {
  const [state, action, pending] = useActionState<ReflectState, FormData>(reflectDeeper, undefined);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button className="btn btn-quiet" disabled={pending}>{pending ? "Reading your entry…" : label}</button>
      {state?.error && <p role="alert" className="mt-2 text-sm text-brass">{state.error}</p>}
    </form>
  );
}
