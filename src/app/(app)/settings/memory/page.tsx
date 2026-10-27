import { requireUser } from "@/lib/session";
import { formatInZone } from "@/lib/time";
import { PageHeader, Empty } from "@/components/page-header";
import { AddMemoryForm } from "@/components/settings-forms";
import { deleteAllMemory, deleteMemory, setMemoryStatus, updateMemory } from "@/app/actions/data";
import type { AiMemory } from "@/lib/types";

export const metadata = { title: "Memory" };

const CATEGORY: Record<AiMemory["category"], string> = {
  preference: "Preferences", long_term_goal: "Long-term goals", commitment: "Standing commitments", routine: "Routines",
  observation: "Observations", difficulty: "Recurring difficulties", accomplishment: "Accomplishments", reflection: "Reflections",
  hypothesis: "Coach's hypotheses", context: "Context",
};
const EVIDENCE: Record<AiMemory["evidence_status"], string> = { verified: "Verified from your records", self_reported: "You said", unverified: "Unverified" };

interface Source { memory_id: string; source_type: string; excerpt: string | null; created_at: string }

function MemoryRow({ m, sources, tz }: { m: AiMemory; sources: Source[]; tz: string }) {
  return (
    <li className={`py-4 ${m.status === "rejected" || m.status === "archived" ? "opacity-60" : ""}`}>
      <form action={updateMemory} className="flex gap-2">
        <input type="hidden" name="id" value={m.id} />
        <textarea name="content" defaultValue={m.content} className="field min-h-14" aria-label="Memory" />
        <button className="btn btn-quiet shrink-0 self-start">Save</button>
      </form>
      <p className="mt-2 text-xs text-ivory-faint">
        {EVIDENCE[m.evidence_status]} · {formatInZone(m.created_at, tz, "MMM d, yyyy")}{m.user_edited && " · edited by you"}{m.sensitive && " · sensitive (never sent to the coach)"}
        {m.status !== "active" && m.status !== "proposed" && ` · ${m.status}`}
      </p>
      {sources.length > 0 && (
        <details className="mt-1 text-xs">
          <summary className="cursor-pointer text-ivory-faint hover:text-ivory-dim">Where this came from ({sources.length})</summary>
          <ul className="mt-1 space-y-1 border-l border-line pl-3 text-ivory-dim">
            {sources.map((x, i) => <li key={i}><span className="text-ivory-faint">{x.source_type.replace(/_/g, " ")}:</span> {x.excerpt ?? "—"}</li>)}
          </ul>
        </details>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        {m.status === "proposed" ? (
          <>
            <form action={setMemoryStatus}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="status" value="active" /><button className="chip" data-on="true">Keep</button></form>
            <form action={setMemoryStatus}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="status" value="rejected" /><button className="chip">Reject</button></form>
          </>
        ) : (
          <form action={setMemoryStatus}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="status" value={m.status === "active" ? "archived" : "active"} />
            <button className="text-ivory-faint hover:text-ivory-dim">{m.status === "active" ? "Archive" : "Restore"}</button></form>
        )}
        <form action={deleteMemory}><input type="hidden" name="id" value={m.id} /><button className="ml-2 text-ivory-faint hover:text-ivory-dim">Delete</button></form>
      </div>
    </li>
  );
}

export default async function Memory() {
  const { supabase, profile } = await requireUser();
  const [{ data }, { data: src }] = await Promise.all([
    supabase.from("ai_memory").select("*").order("created_at", { ascending: false }),
    supabase.from("ai_memory_sources").select("memory_id,source_type,excerpt,created_at"),
  ]);
  const items = (data ?? []) as AiMemory[];
  const sources = (src ?? []) as Source[];
  const proposed = items.filter((i) => i.status === "proposed");
  const rest = items.filter((i) => i.status !== "proposed");
  const tz = profile.timezone;

  return (
    <>
      <PageHeader back="/settings" title="What the coach remembers"
        subtitle={profile.ai_analysis_consent ? "AI analysis is on." : "AI analysis is off. Nothing here is sent to Claude."} />
      <p className="mb-10 text-ivory-dim">
        The coach can only propose memories. Nothing it proposes is used until you keep it. Every memory shows where it came from;
        edit anything that is slightly wrong, reject anything that is wrong.
      </p>

      {proposed.length > 0 && (
        <section className="mb-12 rounded-[14px] border border-emerald/50 p-4">
          <h2 className="h-section">Waiting for your approval ({proposed.length})</h2>
          <ul className="divide-y divide-line">{proposed.map((m) => <MemoryRow key={m.id} m={m} tz={tz} sources={sources.filter((x) => x.memory_id === m.id)} />)}</ul>
        </section>
      )}

      <section className="mb-12"><AddMemoryForm /></section>

      {rest.length === 0 ? <Empty>Nothing stored.</Empty> : (
        <div className="space-y-10">
          {(Object.keys(CATEGORY) as AiMemory["category"][]).map((c) => {
            const list = rest.filter((i) => (i.category ?? "context") === c);
            if (!list.length) return null;
            return (
              <section key={c}>
                <h2 className="h-section">{CATEGORY[c]}</h2>
                <ul className="divide-y divide-line">{list.map((m) => <MemoryRow key={m.id} m={m} tz={tz} sources={sources.filter((x) => x.memory_id === m.id)} />)}</ul>
              </section>
            );
          })}
          <form action={deleteAllMemory} className="flex gap-2 pt-6">
            <input name="confirm" className="field max-w-48" placeholder="Type DELETE" aria-label="Type DELETE to confirm" autoComplete="off" />
            <button className="btn btn-danger">Delete all memory</button>
          </form>
        </div>
      )}
    </>
  );
}
