"use client";

import { useState, useSyncExternalStore } from "react";
import { CHALLENGES, FOCUS_AREAS, type Profile } from "@/lib/types";

const ZONES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles",
  "America/Anchorage", "Pacific/Honolulu", "Europe/London", "Europe/Paris", "Africa/Cairo", "Africa/Lagos",
  "Asia/Riyadh", "Asia/Dubai", "Asia/Karachi", "Asia/Kolkata", "Asia/Dhaka", "Asia/Jakarta", "Asia/Kuala_Lumpur",
  "Europe/Istanbul", "Australia/Sydney",
];

export function TimezoneField({ value }: { value?: string }) {
  const detected = useSyncExternalStore(
    () => () => {},
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    () => null,
  );
  const [chosen, setTz] = useState<string | null>(null);
  const tz = chosen ?? value ?? detected ?? "America/New_York";
  const options = ZONES.includes(tz) ? ZONES : [tz, ...ZONES];
  return (
    <select name="timezone" className="field" value={tz} onChange={(e) => setTz(e.target.value)}>
      {options.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
    </select>
  );
}

function ChipGroup({ name, items, selected }: { name: string; items: { key: string; label: string }[]; selected: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((i) => (
        <label key={i.key} className="chip cursor-pointer has-checked:border-emerald has-checked:bg-emerald-deep has-checked:text-ivory has-focus-visible:outline-2 has-focus-visible:outline-emerald">
          <input type="checkbox" name={name} value={i.key} defaultChecked={selected.includes(i.key)} className="sr-only" />
          {i.label}
        </label>
      ))}
    </div>
  );
}

export function ProfileFields({ profile, showAll = true }: { profile: Profile; showAll?: boolean }) {
  return (
    <div className="space-y-9">
      <section className="space-y-4">
        <div>
          <label className="label" htmlFor="display_name">What should the app call you?</label>
          <input id="display_name" name="display_name" className="field" defaultValue={profile.display_name ?? ""} maxLength={60} />
        </div>
        <div>
          <label className="label">Time zone</label>
          <TimezoneField value={profile.onboarding_completed_at ? profile.timezone : undefined} />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="h-section">Daily check-ins</h2>
        <p className="text-sm text-ivory-dim">You&apos;ll get a notification at these times to set and review your commitments.</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="m">Morning</label>
            <input id="m" type="time" name="morning_checkin_time" className="field" defaultValue={profile.morning_checkin_time.slice(0, 5)} required />
          </div>
          <div>
            <label className="label" htmlFor="e">Evening</label>
            <input id="e" type="time" name="evening_checkin_time" className="field" defaultValue={profile.evening_checkin_time.slice(0, 5)} required />
          </div>
        </div>
        <div>
          <p className="label">Quiet hours</p>
          <div className="grid grid-cols-2 gap-4">
            <input aria-label="Quiet hours start" type="time" name="quiet_hours_start" className="field" defaultValue={profile.quiet_hours_start?.slice(0, 5) ?? ""} />
            <input aria-label="Quiet hours end" type="time" name="quiet_hours_end" className="field" defaultValue={profile.quiet_hours_end?.slice(0, 5) ?? ""} />
          </div>
          <p className="mt-2 text-sm text-ivory-faint">General nudges wait until quiet hours end. Appointment reminders still arrive on time.</p>
        </div>
      </section>

      {showAll && (
        <>
          <section className="space-y-3">
            <h2 className="h-section">What you&apos;re working on</h2>
            <ChipGroup name="focus_areas" items={FOCUS_AREAS.map((f) => ({ key: f.key, label: f.label }))} selected={profile.focus_areas} />
          </section>
          <section className="space-y-3">
            <h2 className="h-section">What tends to get in the way</h2>
            <p className="text-sm text-ivory-dim">Used to choose which questions to ask. These are not diagnoses.</p>
            <ChipGroup name="challenges" items={CHALLENGES.map((c) => ({ key: c, label: c }))} selected={profile.challenges} />
          </section>
        </>
      )}

      <section className="space-y-3">
        <h2 className="h-section">AI analysis</h2>
        <label className="flex gap-3 rounded-[14px] border border-line p-4 has-checked:border-emerald-deep">
          <input type="checkbox" name="ai_analysis_consent" defaultChecked={profile.ai_analysis_consent} className="mt-1 size-5 accent-emerald" />
          <span className="text-sm text-ivory-dim">
            <span className="mb-1 block text-base text-ivory">Allow Claude to read my entries</span>
            When on, the text of your check-in answers (and later, journal entries you haven&apos;t excluded) is sent to Anthropic&apos;s
            API to generate follow-up questions and reviews. Anthropic does not train on API data by default. When off, nothing
            leaves this app for AI processing. You can change this any time.
          </span>
        </label>
      </section>

      <section className="space-y-3">
        <h2 className="h-section">Hijri date</h2>
        <label className="label" htmlFor="hijri">Adjustment for local moon sighting</label>
        <select id="hijri" name="hijri_adjustment_days" defaultValue={String(profile.hijri_adjustment_days)} className="field max-w-48">
          {[-2, -1, 0, 1, 2].map((n) => <option key={n} value={n}>{n === 0 ? "None (Umm al-Qura)" : `${n > 0 ? "+" : ""}${n} day${Math.abs(n) > 1 ? "s" : ""}`}</option>)}
        </select>
      </section>
    </div>
  );
}
