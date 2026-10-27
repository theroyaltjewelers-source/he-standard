import { requireUser } from "@/lib/session";
import { formatInZone } from "@/lib/time";
import { PageHeader, Empty } from "@/components/page-header";
import { AddMemoryForm } from "@/components/settings-forms";
import { deleteAllMemory, deleteMemory, setMemoryStatus, updateMemory } from "@/app/actions/data";
import type { AiMemory } from "@/lib/types";

export const metadata = { title: "Memory" };

const KIND = {
  verified_fact: { label: "From your records", desc: "Counted from data in the app, such as how often a task was postponed." },
  self_report: { label: "You said", desc: "Things you told the app about yourself." },
  hypothesis: { label: "Coach's hypothesis", desc: "Interpretations — possibly wrong. Reject any that don't fit." },
} as const;

export default async function Memory() {
  const { supabase, profile } = await requireUser();
  const { data } = await supabase.from("ai_memory").select("*").order("created_at", { ascending: false });
  const items = (data ?? []) as AiMemory[];

  return (
    <>
      <PageHeader back="/settings" title="What the coach remembers"
        subtitle={profile.ai_analysis_consent ? "AI analysis is on." : "AI analysis is off. Nothing here is sent to Claude."} />
      <p className="mb-10 text-ivory-dim">
        Every memory is labelled by where it came from. In Phase 1 the only memories are ones you add; once AI coaching is
        enabled (Phase 2), the coach will add facts it counted and hypotheses it formed, and they will appear here for you to keep, correct or reject.
      </p>
      <section className="mb-12"><AddMemoryForm /></section>

      {items.length === 0 ? <Empty>Nothing stored.</Empty> : (
        <div className="space-y-10">
          {(Object.keys(KIND) as (keyof typeof KIND)[]).map((k) => {
            const list = items.filter((i) => i.kind === k);
            if (!list.length) return null;
            return (
              <section key={k}>
                <h2 className="h-section">{KIND[k].label}</h2>
                <p className="mb-2 text-sm text-ivory-faint">{KIND[k].desc}</p>
                <ul className="divide-y divide-line">
                  {list.map((m) => (
                    <li key={m.id} className={`py-4 ${m.status !== "active" ? "opacity-60" : ""}`}>
                      <form action={updateMemory} className="flex gap-2">
                        <input type="hidden" name="id" value={m.id} />
                        <textarea name="content" defaultValue={m.content} className="field min-h-14" aria-label="Memory" />
                        <button className="btn btn-quiet shrink-0 self-start">Save</button>
                      </form>
                      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-ivory-faint">
                        <span>{formatInZone(m.created_at, profile.timezone, "MMM d, yyyy")}{m.user_edited && ", edited by you"}{m.status !== "active" && `, ${m.status}`}</span>
                        <form action={setMemoryStatus}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="status" value={m.status === "active" ? (k === "hypothesis" ? "rejected" : "archived") : "active"} />
                          <button className="hover:text-ivory-dim">{m.status === "active" ? (k === "hypothesis" ? "Reject" : "Archive") : "Restore"}</button></form>
                        <form action={deleteMemory}><input type="hidden" name="id" value={m.id} /><button className="hover:text-ivory-dim">Delete</button></form>
                      </div>
                    </li>
                  ))}
                </ul>
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
