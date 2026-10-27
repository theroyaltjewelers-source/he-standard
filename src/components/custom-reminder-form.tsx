"use client";

import { useActionState } from "react";
import { createCustomReminder, type ReminderState } from "@/app/actions/reminders";

export function CustomReminderForm({ today }: { today: string }) {
  const [state, action, pending] = useActionState<ReminderState, FormData>(createCustomReminder, undefined);
  return (
    <form action={action} className="space-y-3 rounded-[14px] border border-line p-4">
      <input name="title" className="field" placeholder="Remind me to…" maxLength={200} required aria-label="Reminder text" />
      <div className="grid grid-cols-2 gap-3">
        <input type="date" name="date" defaultValue={today} className="field" aria-label="Date" required />
        <input type="time" name="time" className="field" aria-label="Time" required />
      </div>
      <label className="flex items-center gap-2 text-sm text-ivory-dim"><input type="checkbox" name="respect_quiet" className="size-4 accent-emerald" /> Hold during quiet hours</label>
      {state?.error && <p role="alert" className="text-sm text-brass">{state.error}</p>}
      {state?.ok && <p role="status" className="text-sm text-emerald">Scheduled.</p>}
      <button className="btn btn-quiet" disabled={pending}>Schedule reminder</button>
    </form>
  );
}
