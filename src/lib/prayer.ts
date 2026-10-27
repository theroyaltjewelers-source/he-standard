import { CalculationMethod, Coordinates, HighLatitudeRule, Madhab, PrayerTimes, type CalculationParameters } from "adhan";
import { shiftDate } from "./time";

/**
 * Prayer-time calculation (adhan library, astronomical calculation).
 * Times are computed for the calendar day in the user's time zone and returned
 * as UTC instants, so DST and travel are handled by the tz database.
 * Calculated times can differ from a local mosque's published timetable;
 * per-prayer minute offsets let the user match their mosque.
 */

export const PRAYERS = ["fajr", "dhuhr", "asr", "maghrib", "isha"] as const;
export type Prayer = (typeof PRAYERS)[number];

export const PRAYER_LABEL: Record<Prayer, string> = {
  fajr: "Fajr", dhuhr: "Dhuhr", asr: "Asr", maghrib: "Maghrib", isha: "Isha",
};

export const METHODS: { key: string; label: string }[] = [
  { key: "NorthAmerica", label: "ISNA (North America)" },
  { key: "MuslimWorldLeague", label: "Muslim World League" },
  { key: "Egyptian", label: "Egyptian General Authority" },
  { key: "Karachi", label: "University of Islamic Sciences, Karachi" },
  { key: "UmmAlQura", label: "Umm al-Qura, Makkah" },
  { key: "Dubai", label: "Dubai" },
  { key: "MoonsightingCommittee", label: "Moonsighting Committee" },
  { key: "Kuwait", label: "Kuwait" },
  { key: "Qatar", label: "Qatar" },
  { key: "Singapore", label: "Singapore" },
  { key: "Turkey", label: "Diyanet (Turkey)" },
  { key: "Tehran", label: "Institute of Geophysics, Tehran" },
];

export interface PrayerConfig {
  latitude: number;
  longitude: number;
  method: string;
  madhab: "shafi" | "hanafi";
  highLatitudeRule: "recommended" | "MiddleOfTheNight" | "SeventhOfTheNight" | "TwilightAngle";
  offsets: Partial<Record<Prayer, number>>;
  timeZone: string;
}

export type DaySchedule = Record<Prayer | "sunrise", Date>;

function params(cfg: PrayerConfig): CalculationParameters {
  const factory = (CalculationMethod as unknown as Record<string, () => CalculationParameters>)[cfg.method] ?? CalculationMethod.NorthAmerica;
  const p = factory();
  p.madhab = cfg.madhab === "hanafi" ? Madhab.Hanafi : Madhab.Shafi;
  const coords = new Coordinates(cfg.latitude, cfg.longitude);
  p.highLatitudeRule =
    cfg.highLatitudeRule === "recommended"
      ? HighLatitudeRule.recommended(coords)
      : (HighLatitudeRule as unknown as Record<string, typeof p.highLatitudeRule>)[cfg.highLatitudeRule];
  p.adjustments = {
    fajr: cfg.offsets.fajr ?? 0, sunrise: 0, dhuhr: cfg.offsets.dhuhr ?? 0,
    asr: cfg.offsets.asr ?? 0, maghrib: cfg.offsets.maghrib ?? 0, isha: cfg.offsets.isha ?? 0,
  };
  return p;
}

/** Schedule for a local calendar date ("YYYY-MM-DD") in cfg.timeZone. */
export function prayerTimesFor(date: string, cfg: PrayerConfig): DaySchedule {
  const [y, m, d] = date.split("-").map(Number);
  // adhan reads only the Y/M/D components of the Date and returns absolute instants
  // for that solar day at the coordinates, so DST is handled when displaying in cfg.timeZone.
  const t = new PrayerTimes(new Coordinates(cfg.latitude, cfg.longitude), new Date(y, m - 1, d), params(cfg));
  return { fajr: t.fajr, sunrise: t.sunrise, dhuhr: t.dhuhr, asr: t.asr, maghrib: t.maghrib, isha: t.isha };
}

export interface NextPrayer {
  prayer: Prayer;
  at: Date;
  date: string;
}

/** The next prayer start after `now` (looks into tomorrow after Isha). */
export function nextPrayer(today: string, cfg: PrayerConfig, now = new Date()): NextPrayer {
  for (const day of [today, shiftDate(today, 1)]) {
    const s = prayerTimesFor(day, cfg);
    for (const p of PRAYERS) if (s[p] > now) return { prayer: p, at: s[p], date: day };
  }
  const s = prayerTimesFor(shiftDate(today, 1), cfg);
  return { prayer: "fajr", at: s.fajr, date: shiftDate(today, 1) };
}

/**
 * The window in which a prayer is "current": from its start until the next
 * prayer begins (Fajr ends at sunrise; Isha runs until the next Fajr).
 */
export function prayerWindowEnd(p: Prayer, date: string, cfg: PrayerConfig): Date {
  const s = prayerTimesFor(date, cfg);
  switch (p) {
    case "fajr": return s.sunrise;
    case "dhuhr": return s.asr;
    case "asr": return s.maghrib;
    case "maghrib": return s.isha;
    case "isha": return prayerTimesFor(shiftDate(date, 1), cfg).fajr;
  }
}

/** Great-circle distance in km, used to decide whether a location change warrants recalculation. */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Minimum move before prayer times are recalculated for a new location. */
export const RELOCATE_THRESHOLD_KM = 15;
