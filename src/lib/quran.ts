import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Verified Quran library.
 *
 * The app never writes Quranic text itself. This file lists only verse
 * REFERENCES (surah:ayah) chosen for the themes the user is working on. The
 * Arabic text and the English translation are imported verbatim from the
 * Al Quran Cloud API (Tanzil Uthmani text; Sahih International translation),
 * the response is checked to be the exact verse requested, and each stored
 * verse keeps its source URL and translator attribution.
 */

export const TRANSLATION_EDITION = "en.sahih";
export const TRANSLATOR = "Sahih International";
export const ARABIC_EDITION = "quran-uthmani";
const API = "https://api.alquran.cloud/v1/ayah";

export const THEMES = [
  "honesty", "patience", "discipline", "self_control", "gratitude", "responsibility",
  "speech", "promises", "prayer", "wealth", "time", "repentance", "reliance", "composure",
] as const;
export type Theme = (typeof THEMES)[number];

/** Curated references. Themes are tags for selection; the verse text is always the source's. */
export const VERSE_REFERENCES: { ref: string; topics: Theme[] }[] = [
  { ref: "61:2", topics: ["honesty", "promises"] },
  { ref: "61:3", topics: ["honesty", "promises"] },
  { ref: "9:119", topics: ["honesty"] },
  { ref: "33:70", topics: ["honesty", "speech"] },
  { ref: "4:135", topics: ["honesty", "responsibility"] },
  { ref: "17:34", topics: ["promises", "responsibility"] },
  { ref: "23:8", topics: ["promises", "responsibility"] },
  { ref: "2:153", topics: ["patience", "prayer"] },
  { ref: "2:45", topics: ["patience", "prayer"] },
  { ref: "3:200", topics: ["patience", "discipline"] },
  { ref: "8:46", topics: ["patience", "composure"] },
  { ref: "3:134", topics: ["self_control", "composure"] },
  { ref: "41:34", topics: ["composure", "speech"] },
  { ref: "31:19", topics: ["speech", "composure"] },
  { ref: "25:63", topics: ["composure", "speech"] },
  { ref: "49:12", topics: ["self_control", "speech"] },
  { ref: "24:30", topics: ["self_control"] },
  { ref: "79:40", topics: ["self_control"] },
  { ref: "79:41", topics: ["self_control"] },
  { ref: "7:31", topics: ["self_control", "discipline"] },
  { ref: "29:45", topics: ["prayer", "self_control"] },
  { ref: "20:14", topics: ["prayer"] },
  { ref: "2:238", topics: ["prayer", "discipline"] },
  { ref: "17:26", topics: ["wealth"] },
  { ref: "17:27", topics: ["wealth"] },
  { ref: "25:67", topics: ["wealth", "discipline"] },
  { ref: "103:1", topics: ["time"] },
  { ref: "103:2", topics: ["time"] },
  { ref: "103:3", topics: ["time", "patience", "honesty"] },
  { ref: "59:18", topics: ["responsibility", "time"] },
  { ref: "13:11", topics: ["responsibility", "discipline"] },
  { ref: "29:69", topics: ["discipline"] },
  { ref: "2:286", topics: ["responsibility", "reliance"] },
  { ref: "65:3", topics: ["reliance"] },
  { ref: "94:5", topics: ["patience", "reliance"] },
  { ref: "94:6", topics: ["patience", "reliance"] },
  { ref: "39:53", topics: ["repentance"] },
  { ref: "66:8", topics: ["repentance"] },
  { ref: "14:7", topics: ["gratitude"] },
  { ref: "2:152", topics: ["gratitude"] },
  { ref: "16:90", topics: ["responsibility", "honesty"] },
];

interface AyahResponse {
  code: number;
  data?: {
    text: string;
    numberInSurah: number;
    surah: { number: number; englishName: string };
    edition: { identifier: string; englishName: string; name: string };
  };
}

async function fetchAyah(ref: string, edition: string) {
  const url = `${API}/${ref}/${edition}`;
  const res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const json = (await res.json()) as AyahResponse;
  if (json.code !== 200 || !json.data) throw new Error(`${url}: unexpected response`);
  const [s, a] = ref.split(":").map(Number);
  // Verification: the response must be exactly the verse and edition requested.
  if (json.data.surah.number !== s || json.data.numberInSurah !== a) throw new Error(`${url}: returned ${json.data.surah.number}:${json.data.numberInSurah}`);
  if (json.data.edition.identifier !== edition) throw new Error(`${url}: returned edition ${json.data.edition.identifier}`);
  if (!json.data.text?.trim()) throw new Error(`${url}: empty text`);
  return { url, data: json.data };
}

/** Imports any curated verses not yet stored. Service-role client only. Returns counts. */
export async function importVerses(admin: SupabaseClient, limit = 50) {
  const { data: existing } = await admin.from("quran_verses").select("surah,ayah").eq("edition", TRANSLATION_EDITION);
  const have = new Set((existing ?? []).map((r) => `${r.surah}:${r.ayah}`));
  const todo = VERSE_REFERENCES.filter((v) => !have.has(v.ref)).slice(0, limit);
  const errors: string[] = [];
  let imported = 0;
  for (const v of todo) {
    try {
      const [ar, en] = await Promise.all([fetchAyah(v.ref, ARABIC_EDITION), fetchAyah(v.ref, TRANSLATION_EDITION)]);
      const [surah, ayah] = v.ref.split(":").map(Number);
      const { error } = await admin.from("quran_verses").upsert({
        surah, ayah, surah_name: en.data.surah.englishName, arabic: ar.data.text, translation: en.data.text,
        translator: TRANSLATOR, edition: TRANSLATION_EDITION, topics: v.topics,
        source_url: `${en.url} (translation); ${ar.url} (Arabic)`,
      }, { onConflict: "surah,ayah,edition" });
      if (error) throw new Error(error.message);
      imported++;
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return { imported, remaining: VERSE_REFERENCES.length - have.size - imported, errors };
}

/** Deterministic daily verse for a theme (rotates by date so it's stable through the day). */
export function pickIndex(date: string, salt: string, n: number): number {
  let h = 2166136261;
  for (const c of date + salt) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return Math.abs(h) % Math.max(1, n);
}

export const quranComUrl = (surah: number, ayah: number) => `https://quran.com/${surah}/${ayah}`;
