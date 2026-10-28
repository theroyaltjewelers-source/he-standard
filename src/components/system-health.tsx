import { createAdminClient } from "@/lib/supabase/admin";
import { formatInZone } from "@/lib/time";
import { retrySync } from "@/app/actions/profile";
import type { SupabaseClient } from "@supabase/supabase-js";

const ago = (iso: string, now: number) => {
  const m = Math.round((now - Date.parse(iso)) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

/** Settings → System health: scheduler heartbeats, failed notifications, stuck calendar syncs. */
export async function SystemHealth({ supabase, tz }: { supabase: SupabaseClient; tz: string }) {
  const admin = createAdminClient();
  const nowDate = new Date();
  const now = nowDate.getTime();
  const since = new Date(now - 7 * 86400_000).toISOString();
  const [plan, dispatch, { data: failed }, { data: outbox }] = await Promise.all([
    admin.from("job_runs").select("started_at,finished_at,ok,error").eq("job", "plan").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("job_runs").select("started_at,finished_at,ok,error").eq("job", "dispatch").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("reminders").select("id,title,send_at,last_error").eq("status", "failed").gte("send_at", since).order("send_at", { ascending: false }).limit(10),
    supabase.from("sync_outbox").select("id,op,status,attempts,last_error,updated_at").in("status", ["pending", "dead"]).order("updated_at", { ascending: false }).limit(10),
  ]);
  const jobs = [
    { name: "Day planner & rollover", expect: 20, row: plan.data },
    { name: "Notification dispatcher", expect: 3, row: dispatch.data },
  ];
  return (
    <section className="mt-16 space-y-4" aria-labelledby="health-h">
      <h2 id="health-h" className="h-section">System health</h2>
      <ul className="divide-y divide-line">
        {jobs.map((j) => {
          const late = !j.row || now - Date.parse(j.row.started_at) > j.expect * 60_000;
          const bad = j.row?.ok === false;
          return (
            <li key={j.name} className="flex items-center justify-between gap-4 py-3">
              <div>
                <p>{j.name}</p>
                <p className="text-sm text-ivory-dim">{j.row ? `Last ran ${ago(j.row.started_at, now)}${bad ? ` — failed: ${j.row.error}` : ""}` : "No runs recorded yet"}</p>
              </div>
              <span className={`chip shrink-0 ${bad || late ? "text-brass" : "text-emerald"}`}>{bad ? "⚠ Failed" : late ? "⚠ Delayed" : "✓ Healthy"}</span>
            </li>
          );
        })}
      </ul>
      <div>
        <p className="text-sm text-ivory-dim">Notifications that couldn&apos;t be delivered (7 days)</p>
        {failed?.length ? (
          <ul className="mt-1 space-y-1 text-sm">{failed.map((r) => <li key={r.id}>{r.title} <span className="text-ivory-faint">· {formatInZone(r.send_at, tz, "MMM d, h:mm a")}{r.last_error ? ` · ${r.last_error.slice(0, 80)}` : ""}</span></li>)}</ul>
        ) : <p className="text-sm text-ivory-faint">None.</p>}
      </div>
      <div>
        <p className="text-sm text-ivory-dim">Google Calendar changes waiting to sync</p>
        {outbox?.length ? (
          <ul className="mt-1 space-y-1.5 text-sm">
            {outbox.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3">
                <span>{o.op === "delete" ? "Removal" : "Update"} · {o.status === "dead" ? <b className="text-brass">gave up after {o.attempts} tries</b> : `retrying (attempt ${o.attempts})`}<span className="text-ivory-faint"> · {o.last_error?.slice(0, 80)}</span></span>
                {o.status === "dead" && <form action={retrySync}><input type="hidden" name="id" value={o.id} /><button className="chip">Retry</button></form>}
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-ivory-faint">Everything is in sync.</p>}
      </div>
    </section>
  );
}
