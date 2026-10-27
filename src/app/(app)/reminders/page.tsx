import { requireUser } from "@/lib/session";
import { formatInZone } from "@/lib/time";
import { PageHeader } from "@/components/page-header";
import { PushToggle } from "@/components/push-toggle";
import { getVapidPublicKey } from "@/lib/app-config";
import { CustomReminderForm } from "@/components/custom-reminder-form";
import { cancelReminder, removeDevice } from "@/app/actions/reminders";
import type { Reminder } from "@/lib/types";

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
  const [{ data: devices }, { data: upcoming }, { data: log }, { data: recent }] = await Promise.all([
    supabase.from("push_subscriptions").select("id,device_label,created_at,last_success_at,failure_count").order("created_at"),
    supabase.from("reminders").select("*").eq("status", "scheduled").order("send_at").limit(25),
    supabase.from("notifications").select("id,title,status,error,created_at,displayed_at,clicked_at,push_service_status").order("created_at", { ascending: false }).limit(30),
    supabase.from("reminders").select("*").in("status", ["no_device", "failed", "partial"]).order("send_at", { ascending: false }).limit(10),
  ]);

  return (
    <>
      <PageHeader title="Reminders" subtitle="Notifications are sent by the server on schedule, whether or not the app is open." />

      <section className="space-y-4">
        <h2 className="h-section">This device</h2>
        <PushToggle vapidKey={await getVapidPublicKey()} />
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
        <section className="mt-12">
          <h2 className="h-section mb-2">Not delivered</h2>
          <ul className="divide-y divide-line text-sm">
            {(recent as Reminder[]).map((r) => (
              <li key={r.id} className="py-3">
                <p>{r.title}</p>
                <p className="text-ivory-faint">{formatInZone(r.send_at, tz, "MMM d, h:mm a")}. {REMINDER[r.status]}{r.last_error ? `: ${r.last_error}` : ""}</p>
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
