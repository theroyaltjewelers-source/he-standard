"use client";

import { useEffect, useState } from "react";

/** Current local time in the user's zone; ticks on the minute (not every frame). */
export function LiveClock({ timeZone }: { timeZone: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const tick = () => { const d = new Date(); setNow(d); t = setTimeout(tick, 60_000 - (d.getSeconds() * 1000 + d.getMilliseconds()) + 50); };
    t = setTimeout(tick, 0);
    return () => clearTimeout(t);
  }, []);
  if (!now) return <span className="tabular">&nbsp;</span>;
  return <time className="tabular" dateTime={now.toISOString()}>{now.toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" })}</time>;
}

/** Live countdown to an instant, minute precision. */
export function CountdownTo({ target }: { target: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 15_000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, []);
  if (now === null) return <span className="tabular">&nbsp;</span>;
  const mins = Math.max(0, Math.ceil((Date.parse(target) - now) / 60000));
  const h = Math.floor(mins / 60), m = mins % 60;
  return <span className="tabular" aria-live="off">{mins === 0 ? "now" : h ? `in ${h} h ${m} min` : `in ${m} min`}</span>;
}
