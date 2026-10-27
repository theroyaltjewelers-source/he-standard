import Link from "next/link";
import { requireUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { DeleteAccountForm, EraseForm, SettingsForm } from "@/components/settings-forms";

export const metadata = { title: "Settings & data" };

export default async function Settings() {
  const { user, profile } = await requireUser();
  return (
    <>
      <PageHeader title="Settings & data" subtitle={user.email} />
      <SettingsForm profile={profile} />

      <section className="mt-16 space-y-4">
        <h2 className="h-section">Your data</h2>
        <ul className="divide-y divide-line">
          <li className="flex items-center justify-between gap-4 py-4">
            <div><p>What the coach remembers</p><p className="text-sm text-ivory-dim">Inspect, correct or delete every stored memory.</p></div>
            <Link href="/settings/memory" className="btn btn-quiet shrink-0">Open</Link>
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
