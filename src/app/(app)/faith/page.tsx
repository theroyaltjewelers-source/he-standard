import "@fontsource/amiri/arabic-400.css";
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { hijriDate } from "@/lib/hijri";
import { nextPrayer, PRAYERS, PRAYER_LABEL, prayerTimesFor, prayerWindowEnd, METHODS } from "@/lib/prayer";
import { prayerConfig, type PrayerSettingsRow } from "@/lib/reminders";
import { pickIndex, quranComUrl } from "@/lib/quran";
import { formatInZone, formatLocalDate, shiftDate } from "@/lib/time";
import { env } from "@/lib/env";
import { confirmPrayer, deleteSpiritual, logSpiritual, reflectOnVerse, unconfirmPrayer } from "@/app/actions/faith";
import { Countdown, LocationControl, PrayerSettingsForm } from "@/components/faith-client";
import type { QuranVerse } from "@/lib/types";

export const metadata = { title: "Faith" };

const SPIRITUAL = [
  { kind: "quran", label: "Quran", unit: "minutes" },
  { kind: "dhikr", label: "Dhikr", unit: "minutes" },
  { kind: "sunnah", label: "Sunnah prayer", unit: "rak'ahs" },
  { kind: "witr", label: "Witr", unit: "rak'ahs" },
  { kind: "fast", label: "Fast", unit: null },
  { kind: "dua", label: "Dua", unit: null },
] as const;

export default async function Faith({ searchParams }: PageProps<"/faith">) {
  const sp = await searchParams;
  const { supabase, profile, today } = await requireUser();
  const tz = profile.timezone;
  const date = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  const weekFrom = shiftDate(today, -6);

  const [{ data: settings }, { data: conf }, { data: week }, { data: logs }, { data: verses }] = await Promise.all([
    supabase.from("prayer_settings").select("*").maybeSingle<PrayerSettingsRow & { auto_location: boolean; mosque_note: string | null; location_updated_at: string | null }>(),
    supabase.from("prayer_confirmations").select("*").eq("prayer_date", date),
    supabase.from("prayer_confirmations").select("prayer,prayer_date").gte("prayer_date", weekFrom).lte("prayer_date", today),
    supabase.from("spiritual_logs").select("*").eq("log_date", date).order("created_at"),
    supabase.from("quran_verses").select("*").order("surah").order("ayah"),
  ]);
  const cfg = settings ? prayerConfig(settings, tz) : null;
  const sched = cfg ? prayerTimesFor(date, cfg) : null;
  const next = cfg && date === today ? nextPrayer(today, cfg) : null;
  const now = new Date();
  const confirmed = new Map((conf ?? []).map((c) => [c.prayer, c]));
  const verse = verses?.length ? (verses as QuranVerse[])[pickIndex(today, profile.id, verses.length)] : null;
  const { data: reflections } = verse ? await supabase.from("verse_reflections").select("reflection,created_at").eq("verse_id", verse.id).order("created_at", { ascending: false }).limit(1) : { data: [] };
  const methodLabel = METHODS.find((m) => m.key === settings?.method)?.label ?? settings?.method;

  return (
    <div className="space-y-14">
      <header>
        <h1 className="h-page">Faith</h1>
        <p className="mt-1.5 text-ivory-dim">{formatLocalDate(date, "EEEE, MMMM d")} · {hijriDate(date, profile.hijri_adjustment_days)}</p>
      </header>

      {!cfg && (
        <section className="rounded-[14px] border border-emerald-deep p-5">
          <h2 className="h-section mb-3">Set your location</h2>
          <LocationControl hasLocation={false} autoLocation={settings?.auto_location ?? true} label={null} />
        </section>
      )}

      {cfg && sched && (
        <>
          {next && (
            <section aria-labelledby="next-h" className="settle">
              <p id="next-h" className="text-sm text-ivory-dim">Next: {PRAYER_LABEL[next.prayer]}{next.date !== today ? " (tomorrow)" : ""}</p>
              <p className="serif mt-1 leading-none font-light tracking-tight" style={{ fontSize: "clamp(3.5rem, 15vw, 5.5rem)" }}>
                {formatInZone(next.at, tz, "h:mm")}<span className="ml-2 text-2xl text-ivory-dim">{formatInZone(next.at, tz, "a")}</span>
              </p>
              <p className="mt-2 text-ivory-dim">in <Countdown target={next.at.toISOString()} label={PRAYER_LABEL[next.prayer]} /></p>
            </section>
          )}

          <section aria-labelledby="sched-h">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="sched-h" className="h-section">{date === today ? "Today" : formatLocalDate(date, "EEE MMM d")}</h2>
              <div className="flex gap-3 text-sm">
                <Link href={`/faith?date=${shiftDate(date, -1)}`} className="text-ivory-dim hover:text-ivory">‹ Previous</Link>
                {date !== today && <Link href="/faith" className="text-ivory-dim hover:text-ivory">Today</Link>}
              </div>
            </div>
            <ul className="mt-3 divide-y divide-line">
              {PRAYERS.map((p) => {
                const c = confirmed.get(p);
                const start = sched[p];
                const end = prayerWindowEnd(p, date, cfg);
                const current = now >= start && now < end;
                const future = now < start;
                return (
                  <li key={p} className={`flex items-center gap-4 py-4 ${current ? "-mx-3 rounded-[12px] bg-surface px-3" : ""}`}>
                    <div className="w-24 shrink-0">
                      <p className="serif text-xl">{PRAYER_LABEL[p]}</p>
                      <p className="text-sm text-ivory-dim tabular-nums">{formatInZone(start, tz, "h:mm a")}</p>
                    </div>
                    <div className="min-w-0 flex-1 text-sm">
                      {c ? <p className="text-emerald">{c.status === "qada" ? "Made up (qada)" : c.status === "prayed_late" ? "Prayed, late" : "Prayed"}{c.in_congregation ? " · in congregation" : ""}<span className="text-ivory-faint"> · confirmed {formatInZone(c.confirmed_at, tz, "h:mm a")}</span></p>
                        : future ? <p className="text-ivory-faint">Begins {formatInZone(start, tz, "h:mm a")}</p>
                        : current ? <p className="text-ivory-dim">Now · until {formatInZone(end, tz, "h:mm a")}</p>
                        : <p className="text-ivory-faint">Not confirmed</p>}
                    </div>
                    {c ? (
                      <form action={unconfirmPrayer}><input type="hidden" name="date" value={date} /><input type="hidden" name="prayer" value={p} /><button className="text-xs text-ivory-faint hover:text-ivory-dim">Undo</button></form>
                    ) : !future ? (
                      <form action={confirmPrayer} className="flex items-center gap-2">
                        <input type="hidden" name="date" value={date} /><input type="hidden" name="prayer" value={p} />
                        <input type="hidden" name="status" value={current ? "prayed" : now >= end ? "prayed_late" : "prayed"} />
                        <button className="btn btn-quiet min-h-10 px-3">Prayed</button>
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-xs text-ivory-faint">
              Calculated for {settings?.location_label ?? "your location"} using {methodLabel}, {settings?.madhab === "hanafi" ? "Hanafi" : "standard"} Asr. Calculated times can differ from your local mosque&apos;s timetable — adjust below.
              An unconfirmed prayer is shown as unconfirmed, never as missed.
            </p>
          </section>

          <section aria-labelledby="week-h">
            <h2 id="week-h" className="h-section mb-3">Last seven days</h2>
            <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] text-ivory-faint">
              {Array.from({ length: 7 }, (_, i) => shiftDate(weekFrom, i)).map((d) => {
                const n = (week ?? []).filter((w) => w.prayer_date === d);
                return (
                  <Link key={d} href={`/faith?date=${d}`} className="space-y-1.5" aria-label={`${formatLocalDate(d, "EEEE")}: ${n.length} of 5 confirmed`}>
                    <div className="flex flex-col gap-1">
                      {PRAYERS.map((p) => <span key={p} className={`h-1.5 rounded-full ${n.some((x) => x.prayer === p) ? "bg-emerald" : "bg-surface-2"}`} />)}
                    </div>
                    <span>{formatLocalDate(d, "EEEEE")}</span>
                  </Link>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-ivory-faint">Each bar is one prayer you confirmed; Fajr at the top.</p>
          </section>
        </>
      )}

      <section aria-labelledby="sp-h">
        <h2 id="sp-h" className="h-section mb-3">Beyond the five</h2>
        <form action={logSpiritual} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="date" value={date} />
          <label className="text-sm text-ivory-dim">Practice
            <select name="kind" className="field mt-1 w-40">{SPIRITUAL.map((x) => <option key={x.kind} value={x.kind}>{x.label}</option>)}</select>
          </label>
          <label className="text-sm text-ivory-dim">Amount
            <input type="number" name="amount" min={0} max={1000} className="field mt-1 w-24" placeholder="min" />
          </label>
          <input name="note" className="field min-w-40 flex-1" placeholder="Note (optional)" aria-label="Note" maxLength={300} />
          <button className="btn btn-quiet">Log</button>
        </form>
        {(logs ?? []).length > 0 && (
          <ul className="mt-3 divide-y divide-line text-sm">
            {logs!.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 py-2.5">
                <span>{SPIRITUAL.find((x) => x.kind === l.kind)?.label}{l.amount != null && ` · ${l.amount} ${l.unit ?? ""}`}{l.note && <span className="text-ivory-faint"> · {l.note}</span>}</span>
                <form action={deleteSpiritual}><input type="hidden" name="id" value={l.id} /><button className="text-xs text-ivory-faint hover:text-ivory-dim">Remove</button></form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="verse" aria-labelledby="verse-h">
        <h2 id="verse-h" className="h-section mb-4">Today&apos;s verse</h2>
        {verse ? (
          <figure className="border-l-2 border-emerald pl-5">
            <p dir="rtl" lang="ar" className="text-right text-[1.6rem] leading-[2.1] text-ivory" style={{ fontFamily: "Amiri, 'Geeza Pro', 'Noto Naskh Arabic', serif" }}>{verse.arabic}</p>
            <blockquote className="serif mt-4 text-lg leading-relaxed">{verse.translation}</blockquote>
            <figcaption className="mt-3 text-sm text-ivory-faint">
              Quran {verse.surah}:{verse.ayah}{verse.surah_name && ` · ${verse.surah_name}`} · Translation: {verse.translator} ·{" "}
              <a href={quranComUrl(verse.surah, verse.ayah)} target="_blank" rel="noopener noreferrer" className="underline-offset-4 hover:underline">Read in context</a>
            </figcaption>
            {reflections?.[0] ? (
              <div className="mt-5 rounded-[12px] bg-surface p-4 text-sm">
                <p className="text-xs text-ivory-faint">A reflection written by Claude — commentary, not a religious ruling</p>
                <p className="mt-1.5 text-ivory-dim">{reflections[0].reflection}</p>
              </div>
            ) : env.anthropicKey() && profile.ai_analysis_consent ? (
              <form action={reflectOnVerse} className="mt-4"><input type="hidden" name="verse_id" value={verse.id} /><button className="text-sm text-ivory-dim underline-offset-4 hover:underline">Add a short reflection (AI)</button></form>
            ) : null}
          </figure>
        ) : (
          <p className="text-sm text-ivory-dim">The verse library is imported automatically from a published source (Arabic text and Sahih International translation) within 15 minutes of setup. Verses are never written by AI.</p>
        )}
      </section>

      {cfg && (
        <section id="settings" aria-labelledby="loc-h" className="space-y-10 scroll-mt-8">
          <div>
            <h2 id="loc-h" className="h-section mb-3">Location</h2>
            <LocationControl hasLocation autoLocation={settings!.auto_location} label={settings!.location_label} />
          </div>
          <div>
            <h2 className="h-section mb-3">Calculation and reminders</h2>
            <PrayerSettingsForm s={{ ...settings!, offsets: (settings!.offsets ?? {}) as Record<string, number>, mosque_note: settings!.mosque_note }} />
          </div>
        </section>
      )}
    </div>
  );
}
