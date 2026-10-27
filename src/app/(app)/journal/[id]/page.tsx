import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { formatInZone, formatLocalDate } from "@/lib/time";
import { ConfirmButton } from "@/components/confirm-button";
import { PageHeader } from "@/components/page-header";
import { deleteJournal } from "@/app/actions/journal";
import type { JournalEntry } from "@/lib/types";

export const metadata = { title: "Entry" };

export default async function Entry({ params }: PageProps<"/journal/[id]">) {
  const { id } = await params;
  const { supabase, profile } = await requireUser();
  const { data: e } = await supabase.from("journal_entries").select("*").eq("id", id).maybeSingle<JournalEntry>();
  if (!e) notFound();
  return (
    <article>
      <PageHeader back="/journal" title={e.title || formatLocalDate(e.entry_date, "EEEE, MMMM d")}
        subtitle={e.title ? formatLocalDate(e.entry_date, "EEEE, MMMM d, yyyy") : undefined}
        action={<Link href={`/journal/${id}/edit`} className="btn btn-quiet">Edit</Link>} />
      <div className="serif text-[1.15rem] leading-[1.75] whitespace-pre-wrap">{e.body}</div>
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
      <p className="mt-8 text-sm text-ivory-faint">Reflect Deeper — Claude asking questions about this entry — arrives in Phase 2.</p>
      <form action={deleteJournal} className="mt-10">
        <input type="hidden" name="id" value={e.id} />
        <ConfirmButton message="Delete this entry permanently?">Delete entry</ConfirmButton>
      </form>
    </article>
  );
}
