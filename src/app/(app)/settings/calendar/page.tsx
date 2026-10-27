import { requireUser } from "@/lib/session";
import { formatInZone } from "@/lib/time";
import { PageHeader } from "@/components/page-header";
import { googleConfigured } from "@/lib/google";

export const metadata = { title: "Calendar connection" };

const ERRORS: Record<string, string> = {
  not_configured: "Google Calendar isn't set up on the server yet. The owner needs to add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel (see SETUP.md).",
  state: "The sign-in couldn't be verified (it may have expired). Try connecting again.",
  access_denied: "You declined access in Google. Nothing was connected.",
  no_code: "Google didn't return an authorization code. Try again.",
};

export default async function CalendarSettings({ searchParams }: PageProps<"/settings/calendar">) {
  const sp = await searchParams;
  const { supabase, profile } = await requireUser();
  const tz = profile.timezone;
  const [{ data: acct }, { data: sync }, { data: problems }] = await Promise.all([
    supabase.from("connected_accounts").select("account_email,status,last_error,created_at,scopes").eq("provider", "google").maybeSingle(),
    supabase.from("calendar_sync_state").select("last_synced_at,last_status,last_error").eq("provider", "google").maybeSingle(),
    supabase.from("events").select("id,title,sync_status,sync_error").in("sync_status", ["conflict", "error", "pending_push"]).limit(20),
  ]);
  const configured = googleConfigured();
  const err = typeof sp.error === "string" ? sp.error : typeof sp.gerror === "string" ? sp.gerror : null;

  return (
    <>
      <PageHeader back="/settings" title="Google Calendar" subtitle="Two-way sync with your primary calendar." />
      {sp.connected && <p role="status" className="mb-6 rounded-[10px] bg-emerald-deep px-4 py-3">Connected. Imported {String(sp.imported ?? 0)} events. Reminders were scheduled for them.</p>}
      {sp.synced && <p role="status" className="mb-6 rounded-[10px] bg-surface px-4 py-3">Synced — {String(sp.synced)} change{sp.synced === "1" ? "" : "s"} pulled from Google.</p>}
      {sp.disconnected && <p role="status" className="mb-6 rounded-[10px] bg-surface px-4 py-3">Disconnected. Google access was revoked and tokens deleted. Imported events stay in your calendar here.</p>}
      {err && <p role="alert" className="mb-6 rounded-[10px] border border-brass/60 px-4 py-3 text-brass">{ERRORS[err] ?? `Google returned an error: ${err}`}</p>}

      {acct ? (
        <section className="space-y-4 rounded-[14px] border border-line p-5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-lg">{acct.account_email ?? "Google account"}</p>
            <span className={`text-sm ${acct.status === "active" ? "text-emerald" : "text-brass"}`}>{acct.status === "active" ? "Connected" : acct.status === "revoked" ? "Access revoked" : "Error"}</span>
          </div>
          <p className="text-sm text-ivory-dim">
            Connected {formatInZone(acct.created_at, tz, "MMM d, yyyy")}.{" "}
            {sync?.last_synced_at ? `Last synced ${formatInZone(sync.last_synced_at, tz, "MMM d, h:mm a")}.` : "Not synced yet."}{" "}
            Changes from Google are pulled every 15 minutes; changes you make here are pushed immediately.
          </p>
          {(acct.last_error || sync?.last_error) && <p className="text-sm text-brass">Last problem: {acct.last_error ?? sync?.last_error}</p>}
          {acct.status !== "active" && <a href="/api/google/connect" className="btn btn-primary">Reconnect</a>}
          <div className="flex flex-wrap gap-2">
            <form action="/api/google/sync" method="post"><button className="btn btn-quiet">Sync now</button></form>
            <form action="/api/google/disconnect" method="post"><button className="btn btn-danger">Disconnect</button></form>
          </div>
        </section>
      ) : (
        <section className="space-y-4 rounded-[14px] border border-line p-5">
          <p>Connect Google Calendar to see your appointments here, get preparation and departure reminders for them, and have events you create here appear in Google.</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-ivory-dim">
            <li>Access is limited to calendar events. The app never sees your email or files.</li>
            <li>Tokens are encrypted before they are stored, and you can disconnect at any time.</li>
            <li>If an event is edited in both places, the most recent change wins and the conflict is shown here.</li>
          </ul>
          {configured ? <a href="/api/google/connect" className="btn btn-primary">Connect Google Calendar</a> : <p className="text-sm text-brass">{ERRORS.not_configured}</p>}
        </section>
      )}

      {(problems ?? []).length > 0 && (
        <section className="mt-10">
          <h2 className="h-section mb-2">Needs attention</h2>
          <ul className="divide-y divide-line">
            {(problems ?? []).map((e) => (
              <li key={e.id} className="py-3">
                <p>{e.title}</p>
                <p className="text-sm text-brass">{e.sync_status === "conflict" ? "Edited in both places — the latest change was kept." : e.sync_status === "pending_push" ? "Waiting to be sent to Google." : `Couldn't sync: ${e.sync_error ?? "unknown error"}`}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
