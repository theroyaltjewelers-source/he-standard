"use client";

import { useActionState, useState } from "react";
import { savePreferences, type PrefState } from "@/app/actions/preferences";
import { CATEGORIES, INTENSITY_LABEL, categorySetting, type Intensity } from "@/lib/reminder-policy";
import type { UserPreferences } from "@/lib/types";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function PreferencesForm({ prefs }: { prefs: UserPreferences | null }) {
  const [state, action, pending] = useActionState<PrefState, FormData>(savePreferences, undefined);
  const [intensity, setIntensity] = useState<Intensity>(prefs?.reminder_intensity ?? "balanced");
  const [theme, setTheme] = useState(prefs?.theme ?? "dark");
  const [midday, setMidday] = useState(prefs ? prefs.midday_checkin_time !== null : true);
  return (
    <form action={action} className="space-y-10">
      <fieldset className="space-y-3">
        <legend className="h-section mb-2">Appearance</legend>
        <div className="flex gap-2" role="radiogroup" aria-label="Theme">
          {(["dark", "light", "system"] as const).map((t) => (
            <label key={t} className="chip cursor-pointer capitalize has-checked:border-emerald has-checked:bg-emerald-deep has-checked:text-ivory">
              <input type="radio" name="theme" value={t} checked={theme === t} onChange={() => { setTheme(t); document.documentElement.dataset.theme = t; }} className="sr-only" />{t === "system" ? "Match device" : t}
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2"><input type="checkbox" name="haptics" defaultChecked={prefs?.haptics ?? true} className="accent-[var(--color-emerald)]" /> Haptic feedback on supported phones</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="voice_replies" defaultChecked={prefs?.voice_replies ?? false} className="accent-[var(--color-emerald)]" /> The Coach reads its replies aloud</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="sounds" defaultChecked={prefs?.sounds ?? false} className="accent-[var(--color-emerald)]" /> Sounds</label>
        <p className="text-sm text-ivory-faint">Motion follows your device&apos;s Reduce Motion setting.</p>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="h-section mb-2">Rhythm of the day</legend>
        <label className="flex items-center gap-2"><input type="checkbox" name="midday_enabled" checked={midday} onChange={(e) => setMidday(e.target.checked)} className="accent-[var(--color-emerald)]" /> Midday check-in</label>
        {midday && <input type="time" name="midday_checkin_time" defaultValue={prefs?.midday_checkin_time?.slice(0, 5) ?? "13:00"} className="field max-w-40" aria-label="Midday check-in time" />}
        <label className="block text-sm text-ivory-dim">Weekly report day
          <select name="weekly_report_day" defaultValue={prefs?.weekly_report_day ?? 0} className="field mt-1 max-w-56">{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>
        </label>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="h-section mb-2">Reminder intensity</legend>
        <p className="text-sm text-ivory-faint">How hard the app follows up on things you haven&apos;t marked done. After three unanswered reminders it stops and offers to adjust the plan instead.</p>
        <div className="space-y-2">
          {(Object.keys(INTENSITY_LABEL) as Intensity[]).map((k) => (
            <label key={k} className={`flex cursor-pointer gap-3 rounded-[12px] border p-3 ${intensity === k ? "border-emerald" : "border-line"}`}>
              <input type="radio" name="reminder_intensity" value={k} checked={intensity === k} onChange={() => setIntensity(k)} className="mt-1 accent-[var(--color-emerald)]" />
              <span><span className="block">{INTENSITY_LABEL[k].label}</span><span className="block text-sm text-ivory-dim">{INTENSITY_LABEL[k].desc}</span></span>
            </label>
          ))}
        </div>
        {intensity === "custom" && (
          <label className="block text-sm text-ivory-dim">Follow up after (minutes, comma-separated)
            <input name="custom_follow_up_minutes" defaultValue={(prefs?.custom_follow_up_minutes ?? [30]).join(", ")} className="field mt-1" placeholder="20, 60, 180" />
          </label>
        )}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="h-section mb-2">Notification categories</legend>
        <p className="mb-2 text-sm text-ivory-faint">&ldquo;Quiet hours&rdquo; lets a category through during the quiet hours set above.</p>
        <div className="divide-y divide-line">
          {CATEGORIES.map((c) => {
            const set = categorySetting(prefs?.categories, c.key);
            return (
              <div key={c.key} className="flex items-center justify-between gap-3 py-3">
                <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                  <input type="checkbox" name={`cat_${c.key}`} defaultChecked={set.enabled} className="mt-1 accent-[var(--color-emerald)]" />
                  <span><span className="block">{c.label}</span><span className="block text-sm text-ivory-faint">{c.desc}</span></span>
                </label>
                <label className="flex shrink-0 items-center gap-1.5 text-sm text-ivory-dim">
                  <input type="checkbox" name={`quiet_${c.key}`} defaultChecked={set.quiet_override} className="accent-[var(--color-emerald)]" /> Quiet hours
                </label>
              </div>
            );
          })}
        </div>
      </fieldset>

      {state?.error && <p role="alert" className="text-brass">{state.error}</p>}
      {state?.ok && <p role="status" className="text-emerald">Preferences saved.</p>}
      <button className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : "Save preferences"}</button>
    </form>
  );
}
