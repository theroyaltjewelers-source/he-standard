import { requireUser } from "@/lib/session";
import { formatInZone } from "@/lib/time";
import { PageHeader, Empty } from "@/components/page-header";

export const metadata = { title: "Activity log" };

const ACTOR = { user: "You", ai: "Coach", system: "System" } as const;

/** Every change the Coach or the system made on your behalf, and key account actions. */
export default async function Activity() {
  const { supabase, profile } = await requireUser();
  const [{ data: logs }, { data: execs }] = await Promise.all([
    supabase.from("audit_logs").select("id,actor,action,entity_type,detail,created_at").order("created_at", { ascending: false }).limit(150),
    supabase.from("ai_tool_executions").select("id,tool,status,summary,error,created_at,executed_at,undone_at").order("created_at", { ascending: false }).limit(50),
  ]);
  const tz = profile.timezone;
  return (
    <>
      <PageHeader back="/settings" title="Activity log" subtitle="What changed, who changed it, and when." />

      <section className="mb-12">
        <h2 className="h-section mb-2">Coach actions</h2>
        {(execs ?? []).length === 0 ? <Empty>The Coach hasn&apos;t taken any actions yet.</Empty> : (
          <ul className="divide-y divide-line">
            {(execs ?? []).map((x) => (
              <li key={x.id} className="py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p>{x.summary ?? x.tool}</p>
                  <span className={`shrink-0 text-xs ${x.status === "executed" ? "text-emerald" : x.status === "failed" ? "text-brass" : "text-ivory-faint"}`}>{x.status.replace("_", " ")}</span>
                </div>
                <p className="text-xs text-ivory-faint">{formatInZone(x.created_at, tz, "MMM d, h:mm a")} · {x.tool}{x.undone_at && ` · undone ${formatInZone(x.undone_at, tz, "h:mm a")}`}</p>
                {x.error && <p className="text-sm text-brass">{x.error}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="h-section mb-2">All changes</h2>
        {(logs ?? []).length === 0 ? <Empty>Nothing logged yet.</Empty> : (
          <ul className="divide-y divide-line text-sm">
            {(logs ?? []).map((l) => (
              <li key={l.id} className="flex items-baseline justify-between gap-3 py-2.5">
                <span><span className="text-ivory-dim">{ACTOR[l.actor as keyof typeof ACTOR]}</span> · {l.action.replace(/[._]/g, " ")}</span>
                <span className="shrink-0 text-xs text-ivory-faint">{formatInZone(l.created_at, tz, "MMM d, h:mm a")}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-xs text-ivory-faint">Kept for 365 days, then removed automatically.</p>
      </section>
    </>
  );
}
