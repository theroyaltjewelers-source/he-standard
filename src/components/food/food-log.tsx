"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FoodForm, type FormMode } from "./food-form";
import { Sheet } from "@/components/ui/sheet";
import { deleteFoodEntry, type FoodEntryRow, type FoodResult } from "@/app/actions/food";
import { MEAL_LABEL, dayLabel, type MealKey } from "@/lib/food";
import { formatInZone } from "@/lib/time";
import { toast } from "@/components/ui/toast";

/** Shared behaviour for opening the form and reacting to saves. */
export function useFoodForm({ today, view }: { today: string; view: "day" | "summary" }) {
  const router = useRouter();
  const [mode, setMode] = useState<FormMode | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  function onSaved(r: Extract<FoodResult, { ok: true }>, m: FormMode, currentDate?: string) {
    setMode(null);
    setSavedId(r.entry.id);
    const d = r.entry.local_date;
    const where = d === today ? "" : ` — saved to ${dayLabel(d, today, true)}`;
    toast({ text: m.kind === "edit" ? `Changes saved.${r.movedFrom ? where : ""}` : `Food logged.${where}` });
    if (view === "day" && currentDate && d !== currentDate) router.push(`/food?date=${d}`, { scroll: false });
    else router.refresh();
  }
  return { mode, setMode, savedId, onSaved, router };
}

/** The selected day's entries, earliest first, with edit / log again / delete. */
export function FoodDay({ date, today, tz, entries }: { date: string; today: string; tz: string; entries: FoodEntryRow[] }) {
  const { mode, setMode, savedId, onSaved } = useFoodForm({ today, view: "day" });
  const [toDelete, setToDelete] = useState<FoodEntryRow | null>(null);
  const [deleting, startDelete] = useTransition();
  const router = useRouter();
  const isToday = date === today;

  function confirmDelete() {
    if (!toDelete) return;
    const e = toDelete;
    startDelete(async () => {
      let r: Awaited<ReturnType<typeof deleteFoodEntry>>;
      try { r = await deleteFoodEntry(e.id); } catch { r = { ok: false, error: "Couldn't delete the entry. Check your connection and try again." }; }
      if (!r.ok) { toast({ text: r.error, tone: "error" }); return; }
      setToDelete(null);
      toast({ text: "Entry deleted." });
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ivory-dim" aria-live="polite">{entries.length === 0 ? "No entries" : `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`}</p>
        <button type="button" className="btn btn-primary" onClick={() => setMode({ kind: "new", date })}>Log food</button>
      </div>

      {entries.length === 0 ? (
        <div className="card mt-4 text-center">
          <p className="font-medium">{isToday ? "No food logged today." : "No food logged for this day."}</p>
          <p className="mt-1 text-sm text-ivory-dim">Keep a simple record of what you eat and when.</p>
          {!isToday && <button type="button" className="btn btn-quiet mt-4" onClick={() => setMode({ kind: "new", date })}>Add an entry for {dayLabel(date, today)}</button>}
        </div>
      ) : (
        <ol className="mt-4 space-y-2" aria-label={`Food eaten ${dayLabel(date, today, true)}`}>
          {entries.map((e) => (
            <EntryRow key={e.id} e={e} tz={tz} highlight={e.id === savedId}
              onEdit={() => setMode({ kind: "edit", entry: e })}
              onAgain={() => setMode({ kind: "again", entry: e })}
              onDelete={() => setToDelete(e)} />
          ))}
        </ol>
      )}

      <FoodForm mode={mode} tz={tz} today={today} onClose={() => setMode(null)} onSaved={(r, m) => onSaved(r, m, date)} />

      <Sheet open={!!toDelete} size="sm" title="Delete food entry?" description="This will remove this entry from your food log."
        onRequestClose={() => { if (!deleting) setToDelete(null); }}
        footer={<>
          <button type="button" className="btn btn-quiet" onClick={() => setToDelete(null)} disabled={deleting}>Cancel</button>
          <button type="button" className="btn btn-danger" onClick={confirmDelete} disabled={deleting} data-state={deleting ? "loading" : undefined}>{deleting ? "Deleting…" : "Delete entry"}</button>
        </>}>
        {toDelete && <p className="break-words text-sm text-ivory-dim">“{toDelete.description}”</p>}
      </Sheet>
    </>
  );
}

function EntryRow({ e, tz, highlight, onEdit, onAgain, onDelete }: { e: FoodEntryRow; tz: string; highlight: boolean; onEdit: () => void; onAgain: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (ev: MouseEvent | KeyboardEvent) => {
      if (ev instanceof KeyboardEvent) { if (ev.key === "Escape") { setOpen(false); btn.current?.focus(); } return; }
      if (!wrap.current?.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  const time = formatInZone(e.eaten_at, e.timezone, "h:mm a");
  const otherZone = e.timezone !== tz;
  const pick = (fn: () => void) => () => { setOpen(false); fn(); };
  return (
    <li className={`card flex items-start gap-3 !py-3.5 ${highlight ? "entry-in" : ""}`}>
      <time dateTime={e.eaten_at} className="w-[4.5rem] shrink-0 pt-0.5 text-sm tabular text-ivory-dim">
        {time}{otherZone && <span className="block text-[0.7rem] text-ivory-faint">{e.timezone.split("/").pop()?.replace(/_/g, " ")}</span>}
      </time>
      <div className="min-w-0 flex-1">
        <p className="whitespace-pre-wrap break-words">{e.description}</p>
        {(e.meal || e.portion) && (
          <p className="mt-1 flex flex-wrap gap-x-2 text-sm text-ivory-dim">
            {e.meal && <span>{MEAL_LABEL[e.meal as MealKey]}</span>}
            {e.meal && e.portion && <span aria-hidden>·</span>}
            {e.portion && <span className="break-words">{e.portion}</span>}
          </p>
        )}
        {e.notes && <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-ivory-faint">{e.notes}</p>}
      </div>
      <div ref={wrap} className="relative -mr-2 -mt-1.5 shrink-0">
        <button ref={btn} type="button" className="icon-btn" aria-haspopup="menu" aria-expanded={open} aria-label={`Actions for ${e.description.slice(0, 40)}`} onClick={() => setOpen((o) => !o)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
        </button>
        {open && (
          <div role="menu" className="menu" onKeyDown={(ev) => {
            const items = [...(ev.currentTarget.querySelectorAll("[role=menuitem]") as NodeListOf<HTMLButtonElement>)];
            const i = items.indexOf(document.activeElement as HTMLButtonElement);
            if (ev.key === "ArrowDown") { ev.preventDefault(); items[(i + 1) % items.length]?.focus(); }
            if (ev.key === "ArrowUp") { ev.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
          }}>
            <button role="menuitem" autoFocus onClick={pick(onEdit)}>Edit</button>
            <button role="menuitem" onClick={pick(onAgain)}>Log again</button>
            <button role="menuitem" className="text-brass" onClick={pick(onDelete)}>Delete</button>
          </div>
        )}
      </div>
    </li>
  );
}

/** Compact "Food" card for the Today overview. */
export function FoodSummary({ today, tz, count, latest }: { today: string; tz: string; count: number; latest: FoodEntryRow | null }) {
  const { mode, setMode, onSaved } = useFoodForm({ today, view: "summary" });
  return (
    <section aria-labelledby="food-h" className="card h-full">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="food-h" className="eyebrow">Food</h2>
        <span className="text-xs text-ivory-faint" aria-live="polite">{count ? `${count} today` : ""}</span>
      </div>
      {latest ? (
        <p className="mt-2 min-w-0"><span className="line-clamp-2 break-words">{latest.description}</span><span className="text-sm text-ivory-faint">Latest at {formatInZone(latest.eaten_at, latest.timezone, "h:mm a")}</span></p>
      ) : (
        <div className="mt-2"><p>No food logged today.</p><p className="text-sm text-ivory-dim">Keep a simple record of what you eat and when.</p></div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-quiet" onClick={() => setMode({ kind: "new", date: today })}>Log food</button>
        <Link href="/food" className="flex min-h-11 items-center px-2 text-sm text-accent hover:underline">View food log</Link>
      </div>
      <FoodForm mode={mode} tz={tz} today={today} onClose={() => setMode(null)} onSaved={onSaved} />
    </section>
  );
}
