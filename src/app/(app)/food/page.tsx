import Link from "next/link";
import { requireUser } from "@/lib/session";
import { shiftDate } from "@/lib/time";
import { dayLabel } from "@/lib/food";
import { FoodDay } from "@/components/food/food-log";
import type { FoodEntryRow } from "@/app/actions/food";

export const metadata = { title: "Food" };

export default async function FoodPage({ searchParams }: PageProps<"/food">) {
  const sp = await searchParams;
  const { supabase, profile, today } = await requireUser();
  const raw = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  const date = raw > today ? today : raw;
  // Only the selected day is loaded (indexed on user, local_date, eaten_at).
  const { data } = await supabase.from("food_entries")
    .select("id,description,eaten_at,local_date,timezone,meal,portion,notes,created_at,updated_at")
    .eq("local_date", date).order("eaten_at").order("created_at");
  const entries = (data ?? []) as FoodEntryRow[];
  const isToday = date === today;
  const long = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: date.slice(0, 4) !== today.slice(0, 4) ? "numeric" : undefined });

  return (
    <div>
      <header className="mb-6">
        <h1 className="h-page">Food</h1>
        <p className="mt-1.5 text-sm text-ivory-dim">What you ate and when.</p>
      </header>

      <nav aria-label="Choose a day" className="mb-5 space-y-3">
        <div className="flex items-center gap-2">
          <Link href={`/food?date=${shiftDate(date, -1)}`} scroll={false} className="icon-btn shrink-0 border border-line" aria-label={`Previous day, ${dayLabel(shiftDate(date, -1), today, true)}`}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
          </Link>
          <div className="min-w-0 flex-1 text-center" aria-live="polite">
            <p className="truncate font-semibold">{dayLabel(date, today, true)}</p>
            {(isToday || date === shiftDate(today, -1)) && <p className="truncate text-xs text-ivory-faint">{long}</p>}
          </div>
          {isToday ? (
            <span className="icon-btn shrink-0 border border-line opacity-30" aria-hidden><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M9 5l7 7-7 7" /></svg></span>
          ) : (
            <Link href={`/food?date=${shiftDate(date, 1)}`} scroll={false} className="icon-btn shrink-0 border border-line" aria-label={`Next day, ${dayLabel(shiftDate(date, 1), today, true)}`}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="M9 5l7 7-7 7" /></svg>
            </Link>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <form action="/food" className="flex items-center gap-1.5">
            <label htmlFor="food-date" className="sr-only">Go to date</label>
            <input id="food-date" type="date" name="date" defaultValue={date} max={today} className="field h-11 w-auto py-1 text-sm" />
            <button className="chip">Go</button>
          </form>
          {!isToday && <Link href="/food" scroll={false} className="chip">Back to today</Link>}
        </div>
      </nav>

      <FoodDay key={date} date={date} today={today} tz={profile.timezone} entries={entries} />
    </div>
  );
}
