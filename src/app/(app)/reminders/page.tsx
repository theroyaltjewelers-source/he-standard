import { requireUser } from "@/lib/session";
import { formatInZone } from "@/lib/time";
import { PageHeader } from "@/components/page-header";
import { PushToggle } from "@/components/push-toggle";
import { getVapidPublicKey } from "@/lib/app-config";
import { CustomReminderForm } from "@/components/custom-reminder-form";
import { cancelReminder, removeDevice } from "@/app/actions/reminders";
import { PauseControl } from "@/components/pause-control";
import { inQuietHours } from "@/lib/scheduling";
import { dayBoundsUtc } from "@/lib/time";
import { CATEGORIES, PRIORITY_LABEL, categorySetting } from "@/lib/reminder-policy";
import type { Reminder, UserPreferences } from "@/lib/types";

export const metadata = { title: "Reminders" };

const DELIVERY: Record<string, string> = {
  pending: "Sending",
  accepted: "Accepted by push service — not yet confirmed on the device",
  displayed: "Shown on the device",
  clicked: "Opened",
  failed: "Failed",
};
const REMINDER: Record<string, string> = {
  sent: "Accepted by every device's push service", partial: "Accepted by some devices", failed: "Failed after retries",
  no_device: "Not sent — no device registered", cancelled: "Cancelled", processing: "Sending", scheduled: "Scheduled",
};

export default async function Reminders() {
  const { supabase, profile, today } = await requireUser();
  const tz = profile.timezone;
  const dayStart = dayBoundsUtc(today, tz).start.toISOString();
  const [{ data: devices }, { data: upcoming }, { data: log }, { data: recent }, { data: prefs }, { count: sentToday }, { data: failures }] = await Promise.all([
    supabase.from("push_subscriptions").select("id,device_label,created_at,last_success_at,failure_count").order("created_at"),
    supabase.from("reminders").select("*").eq("status", "scheduled").order("send_at").limit(25),
    supabase.from("notifications").select("id,title,status,error,created_at,displayed_at,clicked_at,push_service_status").order("created_at", { ascending: false }).limit(30),
    supabase.from("reminders").select("*").in("status", ["no_device", "failed", "partial", "cancelled", "sent"]).order("send_at", { ascending: false }).limit(40),
    supabase.from("user_preferences").select("*").maybeSingle<UserPreferences>(),
    supabase.from("reminders").select("id", { count: "exact", head: true }).in("status", ["sent", "partial"]).gte("priority", 2).gte("processed_at", dayStart),
    supabase.from("notifications").select("error,created_at").eq("status", "failed").gte("created_at", new Date(new Date().getTime() - 86400_000).toISOString()).order("created_at", { ascending: false }).limit(5),
  ]);
  const now = new Date();
  const quietNow = !!(profile.quiet_hours_start && profile.quiet_hours_end && inQuietHours(now, profile.quiet_hours_start, profile.quiet_hours_end, tz));
  const paused = !!(prefs?.paused_until && Date.parse(prefs.paused_until) > now.getTime());
  const offCats = CATEGORIES.filter((c) => !categorySetting(prefs?.categories, c.key).enabled).map((c) => c.label);
  const lastSuccess = (devices ?? []).map((d) => d.last_success_at).filter(Boolean).sort().pop() as string | undefined;
  const checks: { ok: boolean; label: string; detail: string }[] = [
    { ok: (devices ?? []).length > 0, label: "A device is registered", detail: (devices ?? []).length ? `${devices!.length} device${devices!.length > 1 ? "s" : ""}` : "Turn on reminders on this device above." },
    { ok: !!lastSuccess, label: "The push service has accepted a message", detail: lastSuccess ? `Last accepted ${formatInZone(lastSuccess, tz, "MMM d, h:mm a")}` : "Nothing accepted yet — use Send test above." },
    { ok: (failures ?? []).length === 0, label: "No delivery failures in the last 24 hours", detail: (failures ?? []).length ? (failures ?? [])[0].error ?? "Failed" : "None" },
    { ok: !paused, label: "Notifications are not paused", detail: paused ? `Paused until ${formatInZone(prefs!.paused_until!, tz, "EEE h:mm a")}` : "Active" },
    { ok: !quietNow, label: "Outside quiet hours", detail: quietNow ? "Quiet hours now — normal reminders wait until they end." : "Yes" },
    { ok: !prefs?.daily_notification_budget || (sentToday ?? 0) < prefs.daily_notification_budget, label: "Daily budget not reached", detail: prefs?.daily_notification_budget ? `${sentToday ?? 0} of ${prefs.daily_notification_budget} used today` : "No limit set" },
    { ok: offCats.length === 0, label: "All categories on", detail: offCats.length ? `Off: ${offCats.join(", ")}` : "Yes" },
  ];

  return (
    <>
      <PageHeader title="Reminders" subtitle="Notifications are sent by the server on schedule, whether or not the app is open." />

      <section className="space-y-4">
        <h2 className="h-section">This device</h2>
        <PushToggle vapidKey={await getVapidPublicKey()} />
      </section>

      <section className="mt-12 space-y-4">
        <PauseControl pausedUntil={prefs?.paused_until ?? null} tz={tz} />
        <div className="card">
          <p className="h-section mb-3">Delivery check</p>
          <ul className="space-y-2.5 text-sm">
            {checks.map((c) => (
              <li key={c.label} className="flex gap-3">
                <span aria-hidden className={`mt-1 size-2.5 shrink-0 rounded-full ${c.ok ? "bg-emerald" : "bg-brass"}`} />
                <span><span className="block">{c.label}<span className="sr-only">: {c.ok ? "OK" : "needs attention"}</span></span><span className="block text-ivory-faint">{c.detail}</span></span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ivory-faint">On iPhone, notifications need the app opened from the Home Screen icon and allowed in iOS Settings → Notifications.</p>
        </div>
      </section>

      <section className="mt-12">
        <h2 className="h-section mb-2">Registered devices</h2>
        {(devices ?? []).length ? (
          <ul className="divide-y divide-line text-sm">
            {devices!.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <p>{d.device_label ?? "Device"}</p>
                  <p className="text-ivory-faint">
                    Added {formatInZone(d.created_at, tz, "MMM d")}
                    {d.last_success_at ? `, last accepted ${formatInZone(d.last_success_at, tz, "MMM d, h:mm a")}` : ", nothing sent yet"}
                    {d.failure_count > 0 && `, ${d.failure_count} recent failures`}
                  </p>
                </div>
                <form action={removeDevice}><input type="hidden" name="id" value={d.id} /><button className="text-ivory-faint hover:text-ivory-dim">Remove</button></form>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-ivory-dim">No devices yet. Turn on reminders above on each phone or computer you use.</p>}
      </section>

      <section className="mt-12">
        <h2 className="h-section mb-3">Custom reminder</h2>
        <CustomReminderForm today={today} />
      </section>

      <section className="mt-12">
        <h2 className="h-section mb-2">Upcoming</h2>
        {(upcoming ?? []).length ? (
          <ul className="divide-y divide-line text-sm">
            {(upcoming as Reminder[]).map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 py-3">
                <div>
                  <p className="text-ivory-dim tabular-nums">{formatInZone(r.send_at, tz, "EEE MMM d, h:mm a")}</p>
                  <p>{r.title}</p>
                  {r.body && <p className="text-ivory-faint">{r.body}</p>}
                </div>
                <form action={cancelReminder}><input type="hidden" name="id" value={r.id} /><button className="text-ivory-faint hover:text-ivory-dim">Cancel</button></form>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-ivory-dim">Nothing scheduled.</p>}
      </section>

      {(recent ?? []).length > 0 && (
        <section className="mt-12" id="history">
          <h2 className="h-section mb-1">History</h2>
          <p className="mb-2 text-sm text-ivory-faint">Every reminder that was due, including ones held back by your budget, a pause, or because the item was already done.</p>
          <ul className="divide-y divide-line text-sm">
            {(recent as Reminder[]).map((r) => (
              <li key={r.id} className="py-3">
                <div className="flex justify-between gap-3">
                  <p>{r.title}</p>
                  <span className="shrink-0 text-xs text-ivory-faint">{PRIORITY_LABEL[r.priority ?? 2]}</span>
                </div>
                <p className={r.status === "sent" ? "text-ivory-faint" : r.status === "cancelled" ? "text-ivory-faint" : "text-brass"}>
                  {formatInZone(r.send_at, tz, "MMM d, h:mm a")} · {REMINDER[r.status]}{r.last_error ? ` — ${r.last_error}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-12">
        <h2 className="h-section mb-1">Delivery log</h2>
        <p className="mb-3 text-sm text-ivory-faint">One row per device per notification. A notification is marked shown only when that device reports it.</p>
        {(log ?? []).length ? (
          <ul className="divide-y divide-line text-sm">
            {log!.map((n) => (
              <li key={n.id} className="py-3">
                <div className="flex justify-between gap-3">
                  <span>{n.title}</span>
                  <span className="shrink-0 text-ivory-faint tabular-nums">{formatInZone(n.created_at, tz, "MMM d, h:mm a")}</span>
                </div>
                <p className={n.status === "failed" ? "text-brass" : n.status === "displayed" || n.status === "clicked" ? "text-emerald" : "text-ivory-faint"}>
                  {DELIVERY[n.status]}{n.status === "failed" && n.error ? ` (${n.error})` : ""}
                </p>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-ivory-dim">Nothing sent yet.</p>}
      </section>
    </>
  );
}
