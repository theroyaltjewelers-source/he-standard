import Link from "next/link";
import { requireUser } from "@/lib/session";
import { formatLocalDate } from "@/lib/time";
import { PageHeader, Empty } from "@/components/page-header";
import { IconPlus } from "@/components/icons";
import { JOURNAL_TAGS, type JournalEntry } from "@/lib/types";

export const metadata = { title: "Journal" };

export default async function Journal({ searchParams }: PageProps<"/journal">) {
  const sp = await searchParams;
  const { supabase } = await requireUser();
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 200) : "";
  const tag = typeof sp.tag === "string" && (JOURNAL_TAGS as readonly string[]).includes(sp.tag) ? sp.tag : "";

  let query = supabase.from("journal_entries").select("id,entry_date,title,body,mood,energy,tags,input_method").order("entry_date", { ascending: false }).order("created_at", { ascending: false }).limit(60);
  if (q) query = query.textSearch("search", q, { type: "websearch", config: "english" });
  if (tag) query = query.contains("tags", [tag]);
  const { data, error } = await query;
  const entries = (data ?? []) as JournalEntry[];

  return (
    <>
      <PageHeader title="Journal" action={<Link href="/journal/new" className="btn btn-primary"><IconPlus width={18} height={18} /> Write</Link>} />
      <form className="mb-4 flex gap-2" role="search">
        <input name="q" defaultValue={q} className="field" placeholder="Search entries" aria-label="Search entries" />
        {tag && <input type="hidden" name="tag" value={tag} />}
        <button className="btn btn-quiet">Search</button>
      </form>
      <div className="mb-8 flex flex-wrap gap-2">
        <Link href={q ? `/journal?q=${encodeURIComponent(q)}` : "/journal"} className="chip" data-on={!tag}>All</Link>
        {JOURNAL_TAGS.map((t) => (
          <Link key={t} href={`/journal?tag=${t}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className="chip capitalize" data-on={tag === t}>{t}</Link>
        ))}
      </div>
      {error && <p className="mb-4 text-sm text-brass">Search couldn&apos;t run: {error.message}</p>}
      {entries.length === 0 ? (
        <Empty action={!q && !tag ? <Link href="/journal/new" className="btn btn-quiet">Write the first entry</Link> : undefined}>
          {q || tag ? "No entries match." : "Your journal is empty. It's private to your account."}
        </Empty>
      ) : (
        <ul className="divide-y divide-line">
          {entries.map((e) => (
            <li key={e.id}>
              <Link href={`/journal/${e.id}`} className="block py-5">
                <p className="text-xs text-ivory-faint">
                  {formatLocalDate(e.entry_date, "EEE, MMM d, yyyy")}
                  {e.mood && `, mood ${e.mood}/5`}{e.energy && `, energy ${e.energy}/5`}{e.input_method === "voice" && ", dictated"}
                </p>
                {e.title && <p className="serif mt-1 text-lg">{e.title}</p>}
                <p className="serif mt-1 line-clamp-3 text-ivory-dim">{e.body}</p>
                {e.tags.length > 0 && <p className="mt-2 text-xs text-ivory-faint capitalize">{e.tags.join(", ")}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
