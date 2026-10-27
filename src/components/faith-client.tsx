"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { savePrayerSettings, searchCity, setPrayerLocation, type LocState, type SettingsState } from "@/app/actions/faith";
import { METHODS, PRAYERS, PRAYER_LABEL } from "@/lib/prayer";

export function Countdown({ target, label }: { target: string; label: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 30_000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, []);
  if (now === null) return <span className="text-ivory-dim">&nbsp;</span>;
  const mins = Math.max(0, Math.round((Date.parse(target) - now) / 60000));
  const h = Math.floor(mins / 60), m = mins % 60;
  return <span aria-label={`${label} in ${h} hours ${m} minutes`}>{h > 0 ? `${h} hr ${m} min` : `${m} min`}</span>;
}

export function LocationControl({ hasLocation, autoLocation, label }: { hasLocation: boolean; autoLocation: boolean; label: string | null }) {
  const [msg, setMsg] = useState<LocState>(undefined);
  const [pending, start] = useTransition();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Awaited<ReturnType<typeof searchCity>>>([]);
  const checked = useRef(false);

  // Silent re-check when the user has already granted location and opted into automatic updates.
  useEffect(() => {
    if (checked.current || !autoLocation || !hasLocation || !("geolocation" in navigator) || !navigator.permissions) return;
    checked.current = true;
    navigator.permissions.query({ name: "geolocation" as PermissionName }).then((p) => {
      if (p.state !== "granted") return;
      navigator.geolocation.getCurrentPosition(async (pos) => {
        const r = await setPrayerLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, source: "device", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, onlyIfMoved: true });
        if (r?.moved) setMsg(r);
      }, () => {}, { maximumAge: 15 * 60_000, timeout: 10_000 });
    }).catch(() => {});
  }, [autoLocation, hasLocation]);

  function useDevice() {
    if (!("geolocation" in navigator)) return setMsg({ error: "This browser can't share location. Search for your city instead." });
    setMsg({ ok: "Asking for your location…" });
    navigator.geolocation.getCurrentPosition(
      (pos) => start(async () => setMsg(await setPrayerLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, source: "device", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }))),
      (err) => setMsg({ error: err.code === 1 ? "Location permission was declined. Search for your city instead." : "Couldn't get your location. Try again or search for your city." }),
      { enableHighAccuracy: false, timeout: 15_000 },
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-ivory-dim">
        Location is used only to calculate prayer times. {label ? <>Currently: <span className="text-ivory">{label}</span>.</> : "Not set yet."}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={useDevice} disabled={pending} className="btn btn-quiet">Use my current location</button>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); start(async () => setResults(await searchCity(q))); }} className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} className="field" placeholder="Or search a city" aria-label="City" />
        <button className="btn btn-quiet shrink-0" disabled={pending || q.trim().length < 2}>Search</button>
      </form>
      {results.length > 0 && (
        <ul className="divide-y divide-line rounded-[12px] border border-line">
          {results.map((r) => (
            <li key={`${r.latitude},${r.longitude}`}>
              <button type="button" className="w-full px-4 py-3 text-left hover:bg-surface" onClick={() => start(async () => {
                setResults([]);
                setMsg(await setPrayerLocation({ latitude: r.latitude, longitude: r.longitude, label: `${r.name}${r.detail ? `, ${r.detail}` : ""}`, source: "manual", timeZone: r.timezone }));
              })}>
                {r.name} <span className="text-ivory-faint">{r.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {msg?.error && <p role="alert" className="text-sm text-brass">{msg.error}</p>}
      {msg?.ok && <p role="status" className="text-sm text-emerald">{msg.ok}</p>}
    </div>
  );
}

interface S {
  method: string; madhab: string; high_latitude_rule: string; offsets: Record<string, number>; remind_before_minutes: number;
  follow_up_minutes: number; reminders_enabled: boolean; pre_next_reminder: boolean; notify_during_quiet: boolean; auto_location: boolean; mosque_note: string | null;
}

export function PrayerSettingsForm({ s }: { s: S }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(savePrayerSettings, undefined);
  return (
    <form action={action} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm text-ivory-dim">Calculation method
          <select name="method" defaultValue={s.method} className="field mt-1">{METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select>
        </label>
        <label className="text-sm text-ivory-dim">Asr
          <select name="madhab" defaultValue={s.madhab} className="field mt-1"><option value="shafi">Standard (Shafi&apos;i, Maliki, Hanbali)</option><option value="hanafi">Hanafi</option></select>
        </label>
        <label className="text-sm text-ivory-dim sm:col-span-2">High-latitude adjustment
          <select name="high_latitude_rule" defaultValue={s.high_latitude_rule} className="field mt-1">
            <option value="recommended">Automatic (recommended for location)</option><option value="MiddleOfTheNight">Middle of the night</option>
            <option value="SeventhOfTheNight">One-seventh of the night</option><option value="TwilightAngle">Twilight angle</option>
          </select>
        </label>
      </div>
      <fieldset>
        <legend className="label">Adjust to match your mosque (minutes, −30 to +30)</legend>
        <div className="grid grid-cols-5 gap-2">
          {PRAYERS.map((p) => (
            <label key={p} className="text-center text-xs text-ivory-faint">{PRAYER_LABEL[p]}
              <input type="number" name={`offset_${p}`} min={-30} max={30} defaultValue={s.offsets[p] ?? 0} className="field mt-1 px-2 text-center" />
            </label>
          ))}
        </div>
        <input name="mosque_note" defaultValue={s.mosque_note ?? ""} className="field mt-3" placeholder="Mosque or note (optional)" maxLength={200} aria-label="Mosque note" />
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="label">Reminders</legend>
        <label className="flex items-center gap-3"><input type="checkbox" name="reminders_enabled" defaultChecked={s.reminders_enabled} className="size-5 accent-emerald" /> Notify me at each prayer time</label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm text-ivory-dim">Minutes before
            <select name="remind_before_minutes" defaultValue={String(s.remind_before_minutes)} className="field mt-1">{[0, 5, 10, 15, 20, 30].map((m) => <option key={m} value={m}>{m === 0 ? "At the time" : `${m} min before`}</option>)}</select>
          </label>
          <label className="text-sm text-ivory-dim">Follow up if unconfirmed
            <select name="follow_up_minutes" defaultValue={String(s.follow_up_minutes)} className="field mt-1">{[0, 15, 20, 30, 45, 60, 90].map((m) => <option key={m} value={m}>{m === 0 ? "No follow-up" : `After ${m} min`}</option>)}</select>
          </label>
        </div>
        <label className="flex items-center gap-3"><input type="checkbox" name="pre_next_reminder" defaultChecked={s.pre_next_reminder} className="size-5 accent-emerald" /> One more reminder before the prayer time ends, if still unconfirmed</label>
        <label className="flex items-center gap-3"><input type="checkbox" name="notify_during_quiet" defaultChecked={s.notify_during_quiet} className="size-5 accent-emerald" /> Allow prayer notifications during quiet hours (e.g. Fajr)</label>
        <label className="flex items-center gap-3"><input type="checkbox" name="auto_location" defaultChecked={s.auto_location} className="size-5 accent-emerald" /> Update location automatically when I travel (if I&apos;ve allowed location)</label>
      </fieldset>
      {state?.error && <p role="alert" className="text-sm text-brass">{state.error}</p>}
      {state?.ok && <p role="status" className="text-sm text-emerald">Saved. Prayer times and reminders were recalculated.</p>}
      <button className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : "Save prayer settings"}</button>
    </form>
  );
}
