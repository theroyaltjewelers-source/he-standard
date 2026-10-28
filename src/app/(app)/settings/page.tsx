import Link from "next/link";
import { requireUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { DeleteAccountForm, EraseForm, SettingsForm } from "@/components/settings-forms";
import { PreferencesForm } from "@/components/preferences-form";
import type { UserPreferences } from "@/lib/types";
import { SystemHealth } from "@/components/system-health";

export const metadata = { title: "Settings & data" };

export default async function Settings() {
  const { supabase, user, profile } = await requireUser();
  const [{ data: prefs }, { data: google }] = await Promise.all([
    supabase.from("user_preferences").select("*").maybeSingle<UserPreferences>(),
    supabase.from("connected_accounts").select("account_email,status").eq("provider", "google").maybeSingle(),
  ]);
  return (
    <>
      <PageHeader title="Settings & data" subtitle={user.email} />
      <SettingsForm profile={profile} />

      <section className="mt-16"><PreferencesForm prefs={prefs ?? null} /></section>

      <section className="mt-16 space-y-4">
        <h2 className="h-section">Connections</h2>
        <ul className="divide-y divide-line">
          <li className="flex items-center justify-between gap-4 py-4">
            <div><p>Google Calendar</p><p className="text-sm text-ivory-dim">{google ? `${google.status === "active" ? "Connected" : "Needs attention"} — ${google.account_email ?? ""}` : "Not connected"}</p></div>
            <Link href="/settings/calendar" className="btn btn-quiet shrink-0">{google ? "Manage" : "Connect"}</Link>
          </li>
          <li className="flex items-center justify-between gap-4 py-4">
            <div><p>Prayer settings</p><p className="text-sm text-ivory-dim">Location, calculation method, reminders.</p></div>
            <Link href="/faith#settings" className="btn btn-quiet shrink-0">Open</Link>
          </li>
        </ul>
      </section>

      <SystemHealth supabase={supabase} tz={profile.timezone} />

      <section className="mt-16 space-y-4">
        <h2 className="h-section">Your data</h2>
        <ul className="divide-y divide-line">
          <li className="flex items-center justify-between gap-4 py-4">
            <div><p>What the coach remembers</p><p className="text-sm text-ivory-dim">Inspect, correct or delete every stored memory.</p></div>
            <Link href="/settings/memory" className="btn btn-quiet shrink-0">Open</Link>
          </li>
          <li className="flex items-center justify-between gap-4 py-4">
            <div><p>Activity log</p><p className="text-sm text-ivory-dim">Every change the Coach or system made, with undo history.</p></div>
            <Link href="/settings/activity" className="btn btn-quiet shrink-0">Open</Link>
          </li>
          <li className="flex items-center justify-between gap-4 py-4">
            <div><p>Export everything</p><p className="text-sm text-ivory-dim">A complete JSON file of every record in your account.</p></div>
            <a href="/api/export" className="btn btn-quiet shrink-0" download>Download</a>
          </li>
          <li className="flex items-center justify-between gap-4 py-4">
            <div><p>Password</p><p className="text-sm text-ivory-dim">Change the password you sign in with.</p></div>
            <Link href="/settings/password" className="btn btn-quiet shrink-0">Change</Link>
          </li>
        </ul>
        <p className="text-sm text-ivory-faint">
          Records are stored in your own Supabase database, readable only by your account (row-level security), encrypted at rest and in transit.
          Nothing is sent to Anthropic unless AI analysis is on.
        </p>
      </section>

      <section className="mt-16 space-y-8 rounded-[14px] border border-[#6b3a2e]/60 p-5">
        <h2 className="h-section">Erase and delete</h2>
        <EraseForm />
        <div className="rule pt-8"><DeleteAccountForm email={user.email ?? ""} /></div>
      </section>
    </>
  );
}
