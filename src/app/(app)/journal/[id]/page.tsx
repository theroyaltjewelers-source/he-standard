import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { formatInZone, formatLocalDate } from "@/lib/time";
import { ConfirmButton } from "@/components/confirm-button";
import { PageHeader } from "@/components/page-header";
import { deleteJournal, deleteReflection } from "@/app/actions/journal";
import { ReflectDeeperButton } from "@/components/reflect-deeper";
import { GUIDED_MODES } from "@/lib/reflection";
import type { JournalEntry } from "@/lib/types";

export const metadata = { title: "Entry" };

export default async function Entry({ params }: PageProps<"/journal/[id]">) {
  const { id } = await params;
  const { supabase, profile } = await requireUser();
  const { data: e } = await supabase.from("journal_entries").select("*").eq("id", id).maybeSingle<JournalEntry>();
  if (!e) notFound();
  const { data: refl } = await supabase.from("journal_reflections").select("id,reflection,questions,created_at").eq("entry_id", id).order("created_at", { ascending: false });
  const modeLabel = e.guided_mode && e.guided_mode !== "free" ? GUIDED_MODES.find((m) => m.key === e.guided_mode)?.label : null;
  return (
    <article>
      <PageHeader back="/journal" title={e.title || formatLocalDate(e.entry_date, "EEEE, MMMM d")}
        subtitle={e.title ? formatLocalDate(e.entry_date, "EEEE, MMMM d, yyyy") : undefined}
        action={<Link href={`/journal/${id}/edit`} className="btn btn-quiet">Edit</Link>} />
      {modeLabel && <p className="mb-4 text-xs uppercase tracking-[0.14em] text-ivory-faint">{modeLabel}</p>}
      <div className="reading text-[1.15rem] leading-[1.75] whitespace-pre-wrap">{e.body}</div>
      <dl className="mt-10 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <div><dt className="text-ivory-faint">Mood</dt><dd>{e.mood ? `${e.mood} / 5` : "—"}</dd></div>
        <div><dt className="text-ivory-faint">Energy</dt><dd>{e.energy ? `${e.energy} / 5` : "—"}</dd></div>
        <div><dt className="text-ivory-faint">Tags</dt><dd className="capitalize">{e.tags.join(", ") || "—"}</dd></div>
        <div><dt className="text-ivory-faint">AI analysis</dt><dd>{e.ai_analysis_allowed ? (profile.ai_analysis_consent ? "Allowed" : "Off (account)") : "Excluded"}</dd></div>
      </dl>
      <p className="mt-6 text-xs text-ivory-faint">
        Written {formatInZone(e.created_at, profile.timezone, "MMM d, h:mm a")}{e.input_method === "voice" && ", partly dictated"}
        {e.updated_at !== e.created_at && `. Edited ${formatInZone(e.updated_at, profile.timezone, "MMM d, h:mm a")}`}
      </p>
      <section className="mt-12 space-y-4">
        <h2 className="h-section">Reflect deeper</h2>
        {(refl ?? []).map((r) => (
          <div key={r.id} className="rounded-[14px] bg-surface p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-ivory-faint">Written by Claude · {formatInZone(r.created_at, profile.timezone, "MMM d, h:mm a")}</p>
            <p className="reading mt-2 text-[1.05rem] leading-relaxed">{r.reflection}</p>
            {Array.isArray(r.questions) && r.questions.length > 0 && (
              <ul className="mt-3 space-y-1.5 border-l border-emerald/60 pl-4">{(r.questions as string[]).map((q) => <li key={q} className="text-ivory-dim">{q}</li>)}</ul>
            )}
            <div className="mt-3 flex gap-4 text-xs">
              <Link href={`/journal/new`} className="text-emerald hover:underline">Answer in a new entry</Link>
              <form action={deleteReflection}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="entry_id" value={e.id} /><button className="text-ivory-faint hover:text-ivory-dim">Delete</button></form>
            </div>
          </div>
        ))}
        {e.ai_analysis_allowed && profile.ai_analysis_consent ? (
          <ReflectDeeperButton id={e.id} label={(refl ?? []).length ? "Reflect again" : "Ask Claude to reflect on this entry"} />
        ) : (
          <p className="text-sm text-ivory-faint">{!profile.ai_analysis_consent ? "Turn on AI analysis in Settings to have Claude reflect on entries." : "This entry is excluded from AI analysis."}</p>
        )}
      </section>
      <form action={deleteJournal} className="mt-10">
        <input type="hidden" name="id" value={e.id} />
        <ConfirmButton message="Delete this entry permanently?">Delete entry</ConfirmButton>
      </form>
    </article>
  );
}
