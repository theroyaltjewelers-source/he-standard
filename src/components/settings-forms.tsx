"use client";

import { useActionState } from "react";
import { updateSettings, type FormState } from "@/app/actions/profile";
import { deleteAccount, eraseAllData, addMemory, type DataState } from "@/app/actions/data";
import { ProfileFields } from "./profile-fields";
import type { Profile } from "@/lib/types";

export function SettingsForm({ profile }: { profile: Profile }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateSettings, undefined);
  return (
    <form action={action} className="space-y-8">
      <ProfileFields profile={profile} />
      {state?.error && <p role="alert" className="text-brass">{state.error}</p>}
      {state?.ok && <p role="status" className="text-emerald">Settings saved. Check-in reminders were rescheduled.</p>}
      <button className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : "Save settings"}</button>
    </form>
  );
}

export function EraseForm() {
  const [state, action, pending] = useActionState<DataState, FormData>(eraseAllData, undefined);
  return (
    <form action={action} className="space-y-3">
      <p className="text-sm text-ivory-dim">Erase every goal, task, commitment, appointment, reminder, journal entry, check-in and AI memory. Your account and settings stay. This cannot be undone — export first if you want a copy.</p>
      <div className="flex gap-2">
        <input name="confirm" className="field max-w-48" placeholder="Type ERASE" aria-label="Type ERASE to confirm" autoComplete="off" />
        <button className="btn btn-danger" disabled={pending}>Erase all records</button>
      </div>
      {state?.error && <p role="alert" className="text-sm text-brass">{state.error}</p>}
      {state?.ok && <p role="status" className="text-sm text-emerald">{state.ok}</p>}
    </form>
  );
}

export function DeleteAccountForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState<DataState, FormData>(deleteAccount, undefined);
  return (
    <form action={action} className="space-y-3">
      <p className="text-sm text-ivory-dim">Permanently delete your account and everything stored about you. This cannot be undone.</p>
      <div className="flex flex-wrap gap-2">
        <input name="confirm" className="field max-w-72" placeholder={email} aria-label="Type your email to confirm" autoComplete="off" />
        <button className="btn btn-danger" disabled={pending}>Delete account</button>
      </div>
      {state?.error && <p role="alert" className="text-sm text-brass">{state.error}</p>}
    </form>
  );
}

export function AddMemoryForm() {
  const [state, action, pending] = useActionState<DataState, FormData>(addMemory, undefined);
  return (
    <form action={action} className="space-y-3">
      <textarea name="content" className="field min-h-20" placeholder="Something true about you the coach should know, e.g. “Mornings before 10 are my best focus time.”" aria-label="New memory" />
      {state?.error && <p role="alert" className="text-sm text-brass">{state.error}</p>}
      {state?.ok && <p role="status" className="text-sm text-emerald">{state.ok}</p>}
      <button className="btn btn-quiet" disabled={pending}>Add as self-report</button>
    </form>
  );
}
