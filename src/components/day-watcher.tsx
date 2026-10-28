"use client";

import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { todayIn } from "@/lib/time";
import { msUntilNextLocalMidnight } from "@/lib/series";
import { switchTimezone } from "@/app/actions/profile";

const noop = () => () => {};

/**
 * Keeps an open app on the right day. At local midnight (in the user's
 * configured zone — 23- and 25-hour days included), when the device wakes,
 * regains focus or comes back online, it re-renders from the server if the
 * date changed. The server is the source of truth for every record, so this
 * only refreshes what is shown; nothing is reset.
 *
 * Also notices when the device is in a different time zone (travel) and
 * offers to switch — never silently.
 */
export function DayWatcher({ timeZone, today }: { timeZone: string; today: string }) {
  const router = useRouter();
  useEffect(() => {
    const check = () => { if (todayIn(timeZone) !== today) router.refresh(); };
    const t = setTimeout(check, msUntilNextLocalMidnight(new Date(), today, timeZone) + 1500);
    const i = setInterval(check, 60_000);
    const onVis = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", check);
    window.addEventListener("online", check);
    return () => { clearTimeout(t); clearInterval(i); document.removeEventListener("visibilitychange", onVis); window.removeEventListener("focus", check); window.removeEventListener("online", check); };
  }, [timeZone, today, router]);

  const deviceZone = useSyncExternalStore(noop, () => Intl.DateTimeFormat().resolvedOptions().timeZone, () => timeZone);
  const key = `tz-dismissed:${timeZone}->${deviceZone}`;
  const dismissedStored = useSyncExternalStore(noop, () => { try { return localStorage.getItem(key) === "1"; } catch { return false; } }, () => true);
  const [dismissed, setDismissed] = useState(false);
  const [pending, start] = useTransition();
  if (deviceZone === timeZone || dismissed || dismissedStored) return null;
  return (
    <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-line-strong bg-surface px-4 py-3 text-sm">
      <span>Your device is set to <b>{deviceZone.replace(/_/g, " ")}</b>; your days are tracked in <b>{timeZone.replace(/_/g, " ")}</b>.</span>
      <span className="flex gap-2">
        <button className="chip" disabled={pending} onClick={() => start(async () => { await switchTimezone(deviceZone); router.refresh(); })}>Use {deviceZone.split("/").pop()?.replace(/_/g, " ")}</button>
        <button className="chip" onClick={() => { try { localStorage.setItem(key, "1"); } catch { /* private mode */ } setDismissed(true); }}>Keep {timeZone.split("/").pop()?.replace(/_/g, " ")}</button>
      </span>
    </div>
  );
}
