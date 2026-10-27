import Link from "next/link";
import { requireUser } from "@/lib/session";
import { formatLocalDate, shiftDate } from "@/lib/time";
import { GUIDED_MODES } from "@/lib/reflection";
import { PageHeader, Empty } from "@/components/page-header";
import { IconPlus } from "@/components/icons";
import { JOURNAL_TAGS, type JournalEntry } from "@/lib/types";

export const metadata = { title: "Reflection" };

function monthGrid(month: string) {
  const first = `${month}-01`;
  const dow = new Date(`${first}T12:00:00Z`).getUTCDay();
  const start = shiftDate(first, -dow);
  return Array.from({ length: 42 }, (_, i) => shiftDate(start, i));
}

export default async function Journal({ searchParams }: PageProps<"/journal">) {
  const sp = await searchParams;
  const { supabase, today } = await requireUser();
  const view = sp.view === "calendar" ? "calendar" : "list";
  const month = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : today.slice(0, 7);
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 200) : "";
  const tag = typeof sp.tag === "string" && (JOURNAL_TAGS as readonly string[]).includes(sp.tag) ? sp.tag : "";

  let query = supabase.from("journal_entries").select("id,entry_date,title,body,mood,energy,tags,input_method").order("entry_date", { ascending: false }).order("created_at", { ascending: false }).limit(60);
  if (q) query = query.textSearch("search", q, { type: "websearch", config: "english" });
  if (tag) query = query.contains("tags", [tag]);
  const { data, error } = view === "list" ? await query : { data: [], error: null };
  const entries = (data ?? []) as JournalEntry[];
  const grid = monthGrid(month);
  const { data: monthData } = view === "calendar"
    ? await supabase.from("journal_entries").select("id,entry_date,title,mood").gte("entry_date", grid[0]).lte("entry_date", grid[41]).order("created_at")
    : { data: [] };
  const byDay = new Map<string, { id: string; title: string | null; mood: number | null }[]>();
  for (const e of monthData ?? []) byDay.set(e.entry_date, [...(byDay.get(e.entry_date) ?? []), e]);
  const [y, mo] = month.split("-").map(Number);
  const prevMonth = mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
  const nextMonth = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  const selectedDay = typeof sp.day === "string" ? sp.day : null;

  return (
    <>
      <PageHeader title="Reflection" subtitle="Private writing. Yours alone." action={<Link href="/journal/new" className="btn btn-primary"><IconPlus width={18} height={18} /> Write</Link>} />
      <div className="mb-6 flex gap-2 overflow-x-auto pb-1">
        {GUIDED_MODES.filter((m) => m.key !== "free").map((m) => (
          <Link key={m.key} href={`/journal/new?mode=${m.key}`} className="shrink-0 rounded-[12px] border border-line px-3 py-2 text-sm hover:border-ivory-faint">
            <span className="block">{m.label}</span><span className="block text-xs text-ivory-faint">{m.prompts.length} questions</span>
          </Link>
        ))}
      </div>
      <div className="mb-6 inline-flex rounded-[10px] border border-line p-1">
        <Link href="/journal" className={`rounded-[7px] px-3 py-1.5 text-sm ${view === "list" ? "bg-surface-2" : "text-ivory-dim"}`}>List</Link>
        <Link href="/journal?view=calendar" className={`rounded-[7px] px-3 py-1.5 text-sm ${view === "calendar" ? "bg-surface-2" : "text-ivory-dim"}`}>Calendar</Link>
      </div>
      {view === "calendar" ? (
        <section aria-label="Calendar">
          <div className="mb-3 flex items-center justify-between">
            <Link href={`/journal?view=calendar&month=${prevMonth}`} className="btn btn-quiet" aria-label="Previous month">‹</Link>
            <h2 className="serif text-xl">{formatLocalDate(`${month}-01`, "MMMM yyyy")}</h2>
            <Link href={`/journal?view=calendar&month=${nextMonth}`} className="btn btn-quiet" aria-label="Next month">›</Link>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs text-ivory-faint">{["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <span key={i}>{d}</span>)}</div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {grid.map((d) => {
              const es = byDay.get(d) ?? [];
              const inMonth = d.startsWith(month);
              return (
                <Link key={d} href={`/journal?view=calendar&month=${month}&day=${d}`}
                  className={`flex aspect-square flex-col items-center justify-center rounded-[8px] text-sm ${d === selectedDay ? "bg-surface-2" : ""} ${inMonth ? "" : "text-ivory-faint/50"} ${d === today ? "ring-1 ring-emerald" : ""}`}>
                  {Number(d.slice(8))}
                  <span className={`mt-0.5 size-1.5 rounded-full ${es.length ? "bg-emerald" : "bg-transparent"}`} />
                </Link>
              );
            })}
          </div>
          {selectedDay && (
            <div className="mt-6">
              <h3 className="text-sm text-ivory-dim">{formatLocalDate(selectedDay, "EEEE, MMMM d")}</h3>
              {(byDay.get(selectedDay) ?? []).length ? (
                <ul className="mt-2 divide-y divide-line">{(byDay.get(selectedDay) ?? []).map((e) => <li key={e.id}><Link href={`/journal/${e.id}`} className="block py-3">{e.title || "Untitled entry"}{e.mood && <span className="text-ivory-faint"> · mood {e.mood}/5</span>}</Link></li>)}</ul>
              ) : <p className="mt-2 text-ivory-dim">No entry. <Link href="/journal/new" className="text-emerald hover:underline">Write one</Link></p>}
            </div>
          )}
        </section>
      ) : (<>
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
      </>)}
    </>
  );
}
