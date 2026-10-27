import { TZDate } from "@date-fns/tz";
import { addDays, format } from "date-fns";

/** "YYYY-MM-DD" for the given instant in the given IANA time zone. */
export function localDateString(instant: Date, timeZone: string): string {
  return format(new TZDate(instant.getTime(), timeZone), "yyyy-MM-dd");
}

/** Today's local date ("YYYY-MM-DD") in the user's time zone. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return localDateString(now, timeZone);
}

/** Add whole days to a "YYYY-MM-DD" date string (calendar arithmetic, no tz drift). */
export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/**
 * Convert a local wall-clock date + time in a time zone to a UTC instant.
 * e.g. zonedToUtc("2026-10-27", "20:00", "America/New_York") → 2026-10-28T00:00:00Z
 */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(new TZDate(y, m - 1, d, hh, mm, 0, timeZone).getTime());
}

/** Local "HH:mm" for an instant in a time zone. */
export function localTimeString(instant: Date, timeZone: string): string {
  return format(new TZDate(instant.getTime(), timeZone), "HH:mm");
}

/** Day of week (0 = Sunday) of a "YYYY-MM-DD" date. */
export function dayOfWeek(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** UTC instants bounding a local calendar day: [start, end). */
export function dayBoundsUtc(date: string, timeZone: string): { start: Date; end: Date } {
  return {
    start: zonedToUtc(date, "00:00", timeZone),
    end: zonedToUtc(shiftDate(date, 1), "00:00", timeZone),
  };
}

/** Sunday-start week containing the date. */
export function weekStart(date: string): string {
  return shiftDate(date, -dayOfWeek(date));
}

export function formatInZone(instant: Date | string, timeZone: string, pattern: string): string {
  const t = typeof instant === "string" ? new Date(instant).getTime() : instant.getTime();
  return format(new TZDate(t, timeZone), pattern);
}

export function formatLocalDate(date: string, pattern = "EEEE, MMMM d"): string {
  const [y, m, d] = date.split("-").map(Number);
  return format(new Date(y, m - 1, d), pattern);
}

export { addDays };

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** "21:00" → "9:00 PM" */
export function formatClock(hhmm: string): string {
  const [h, m] = hhmm.slice(0, 5).split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${suffix}`;
}
