"use client";

import { useState, useTransition } from "react";
import { setNotificationPause } from "@/app/actions/preferences";
import { toast } from "@/components/ui/toast";

/** Temporary pause: takes effect immediately and ends on its own. */
export function PauseControl({ pausedUntil, tz }: { pausedUntil: string | null; tz: string }) {
  const [until, setUntil] = useState(pausedUntil);
  const [pending, start] = useTransition();
  const active = until && Date.parse(until) > new Date().getTime();
  const run = (h: number) => start(async () => {
    const r = await setNotificationPause(h);
    if (r.error) { toast({ text: r.error, tone: "error" }); return; }
    setUntil(r.until ?? null);
    toast({ text: r.until ? "Notifications paused" : "Notifications resumed" });
  });
  return (
    <div className="card space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="h-section">Pause notifications</p>
        {active && <span className="text-sm text-brass">Paused until {new Date(until!).toLocaleString("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit" })}</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        {active ? (
          <button className="btn btn-primary" disabled={pending} data-state={pending ? "loading" : undefined} onClick={() => run(0)}>Resume now</button>
        ) : (
          <>
            <button className="chip" disabled={pending} onClick={() => run(1)}>1 hour</button>
            <button className="chip" disabled={pending} onClick={() => run(3)}>3 hours</button>
            <button className="chip" disabled={pending} onClick={() => run(-1)}>Until tomorrow 7 AM</button>
          </>
        )}
      </div>
      <p className="text-sm text-ivory-faint">Reminders due during a pause are not sent later; they stay listed in your history.</p>
    </div>
  );
}
