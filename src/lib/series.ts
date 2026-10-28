/**
 * Recurring tasks and day rollover (pure, deterministic, testable with a fixed clock).
 *
 * A recurring task is a *series*; every scheduled day gets its own task row
 * (unique on series_id + occurrence_date), so history is never a checkbox that
 * resets — yesterday's record stays exactly as it was left.
 */
import { zonedToUtc } from "./time";

export type SeriesRecurrence = "daily" | "weekdays" | "weekly" | "monthly";
export interface SeriesLike {
  recurrence: SeriesRecurrence;
  weekdays: number[];          // weekly: 0 = Sunday … 6 = Saturday
  starts_on: string;
  ends_on: string | null;
  due_time: string | null;     // "HH:mm" or "HH:mm:ss", wall clock in `timezone`
  timezone: string;
}

const utcNoon = (d: string) => new Date(`${d}T12:00:00Z`);
export function addDays(d: string, n: number): string {
  const x = utcNoon(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-based

/** Does the series have an occurrence on this local date? Monthly on the 29th–31st falls on the month's last day when shorter. */
export function occursOn(s: SeriesLike, date: string): boolean {
  if (date < s.starts_on || (s.ends_on && date > s.ends_on)) return false;
  const dow = utcNoon(date).getUTCDay();
  switch (s.recurrence) {
    case "daily": return true;
    case "weekdays": return dow >= 1 && dow <= 5;
    case "weekly": return (s.weekdays.length ? s.weekdays : [utcNoon(s.starts_on).getUTCDay()]).includes(dow);
    case "monthly": {
      const anchor = Number(s.starts_on.slice(8, 10));
      const [y, m, d] = date.split("-").map(Number);
      return d === Math.min(anchor, daysInMonth(y, m));
    }
  }
}

export function seriesDates(s: SeriesLike, from: string, to: string): string[] {
  return dateRange(from, to).filter((d) => occursOn(s, d));
}

/** The UTC deadline of an occurrence: its wall-clock time in the series' own time zone (DST-safe). */
export function seriesDueAt(s: SeriesLike, date: string): Date | null {
  return s.due_time ? zonedToUtc(date, s.due_time.slice(0, 5), s.timezone) : null;
}

/**
 * Which dates still need occurrences. Generation runs up to tomorrow (so
 * reminders exist before the day starts) and back-fills days missed while
 * the app or scheduler was idle — at most `maxBackfill` days back.
 */
export function generationWindow(args: { lastGenerated: string | null; startsOn: string; today: string; maxBackfill?: number }): { from: string; to: string } | null {
  const floor = addDays(args.today, -(args.maxBackfill ?? 30));
  const after = args.lastGenerated ? addDays(args.lastGenerated, 1) : args.startsOn;
  const from = [after, args.startsOn, floor].sort().pop()!;
  const to = addDays(args.today, 1);
  return from > to ? null : { from, to };
}

/** Does [start, end) overlap the local day [dayStart, dayEnd)? Used for events crossing midnight. */
export function overlapsDay(start: Date, end: Date | null, dayStart: Date, dayEnd: Date): boolean {
  const e = end ?? start;
  return start < dayEnd && (e > dayStart || (start >= dayStart && start < dayEnd));
}

/** Milliseconds until the next local midnight in `timeZone` (handles 23- and 25-hour days). */
export function msUntilNextLocalMidnight(now: Date, today: string, timeZone: string): number {
  return Math.max(1000, zonedToUtc(addDays(today, 1), "00:00", timeZone).getTime() - now.getTime());
}
