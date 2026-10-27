import { TZDate } from "@date-fns/tz";
import { addDays, addMonths, addWeeks } from "date-fns";
import { localDateString, localTimeString, shiftDate, zonedToUtc } from "./time";

/* ----------------------------------------------------------------------------
 * Appointment preparation plan
 * --------------------------------------------------------------------------*/

export interface PrepPlan {
  startsAt: Date;
  leaveBy: Date;        // start − travel
  beginPrepAt: Date;    // leaveBy − prep
}

export function prepPlan(startsAt: Date, prepMinutes: number, travelMinutes: number): PrepPlan {
  const leaveBy = new Date(startsAt.getTime() - travelMinutes * 60_000);
  const beginPrepAt = new Date(leaveBy.getTime() - prepMinutes * 60_000);
  return { startsAt, leaveBy, beginPrepAt };
}

export interface PlannedReminder {
  key: string;          // stable within one event occurrence, used for dedupe
  sendAt: Date;
  title: string;
  body: string;
  respectQuietHours: boolean;
}

/**
 * Reminders for one occurrence of an appointment:
 *  - "Start preparing" at beginPrepAt (when prep > 0)
 *  - "Leave now" at leaveBy (when travel > 0)
 *  - each extra offset (minutes before start)
 *  - for high-importance events, a heads-up the evening before (19:00 local)
 * Reminders already in the past are dropped. Reminders tied to a fixed
 * appointment time ignore quiet hours — a late appointment still needs them.
 */
export function eventReminders(args: {
  title: string;
  startsAt: Date;
  prepMinutes: number;
  travelMinutes: number;
  offsets: number[];
  importance: "normal" | "high";
  timeZone: string;
  now?: Date;
}): PlannedReminder[] {
  const now = args.now ?? new Date();
  const plan = prepPlan(args.startsAt, args.prepMinutes, args.travelMinutes);
  const at = localTimeString(args.startsAt, args.timeZone);
  const out: PlannedReminder[] = [];

  if (args.prepMinutes > 0) {
    out.push({
      key: "prep",
      sendAt: plan.beginPrepAt,
      title: `Start preparing: ${args.title}`,
      body: `${args.prepMinutes} min of preparation${args.travelMinutes ? `, then leave by ${localTimeString(plan.leaveBy, args.timeZone)}` : ""}. Starts at ${at}.`,
      respectQuietHours: false,
    });
  }
  if (args.travelMinutes > 0) {
    out.push({
      key: "leave",
      sendAt: plan.leaveBy,
      title: `Leave now: ${args.title}`,
      body: `${args.travelMinutes} min of travel to arrive by ${at}.`,
      respectQuietHours: false,
    });
  }
  for (const m of Array.from(new Set(args.offsets)).filter((x) => x > 0)) {
    out.push({
      key: `before-${m}`,
      sendAt: new Date(args.startsAt.getTime() - m * 60_000),
      title: args.title,
      body: `Starts at ${at} (${humanMinutes(m)} from now).`,
      respectQuietHours: false,
    });
  }
  if (args.importance === "high") {
    const day = localDateString(args.startsAt, args.timeZone);
    const eveBefore = zonedToUtc(shiftDate(day, -1), "19:00", args.timeZone);
    out.push({
      key: "eve",
      sendAt: eveBefore,
      title: `Tomorrow: ${args.title} at ${at}`,
      body: "Important appointment. Review your preparation and departure time now.",
      respectQuietHours: true,
    });
  }

  // Drop past reminders and collapse ones within 2 minutes of each other.
  const sorted = out.filter((r) => r.sendAt.getTime() > now.getTime()).sort((a, b) => +a.sendAt - +b.sendAt);
  const merged: PlannedReminder[] = [];
  for (const r of sorted) {
    const prev = merged[merged.length - 1];
    if (prev && Math.abs(+prev.sendAt - +r.sendAt) < 120_000) continue;
    merged.push(r);
  }
  return merged;
}

export function humanMinutes(m: number): string {
  if (m < 60) return `${m} min`;
  if (m % 1440 === 0) return `${m / 1440} day${m === 1440 ? "" : "s"}`;
  if (m % 60 === 0) return `${m / 60} hr`;
  return `${Math.floor(m / 60)} hr ${m % 60} min`;
}

/* ----------------------------------------------------------------------------
 * Recurrence expansion
 * --------------------------------------------------------------------------*/

export type Recurrence = "none" | "daily" | "weekly" | "monthly";

/**
 * Occurrence start instants of a (possibly recurring) event inside
 * [from, to). Recurrence keeps the local wall-clock time across DST changes.
 */
export function occurrences(args: {
  startsAt: Date;
  recurrence: Recurrence;
  until?: string | null; // local date, inclusive
  timeZone: string;
  from: Date;
  to: Date;
  max?: number;
}): Date[] {
  const { startsAt, recurrence, timeZone, from, to } = args;
  const max = args.max ?? 500;
  if (recurrence === "none") {
    return startsAt >= from && startsAt < to ? [startsAt] : [];
  }
  const base = new TZDate(startsAt.getTime(), timeZone);
  const step = (n: number) =>
    recurrence === "daily" ? addDays(base, n) : recurrence === "weekly" ? addWeeks(base, n) : addMonths(base, n);
  const untilEnd = args.until ? zonedToUtc(shiftDate(args.until, 1), "00:00", timeZone) : null;
  const out: Date[] = [];
  // Jump close to `from` instead of iterating from the beginning.
  const approxStepMs = recurrence === "daily" ? 864e5 : recurrence === "weekly" ? 6048e5 : 2592e6;
  let n = Math.max(0, Math.floor((from.getTime() - startsAt.getTime()) / approxStepMs) - 2);
  for (let guard = 0; guard < max + 400; guard++, n++) {
    const occ = new Date(step(n).getTime());
    if (untilEnd && occ >= untilEnd) break;
    if (occ >= to) break;
    if (occ >= from) out.push(occ);
    if (out.length >= max) break;
  }
  return out;
}

/* ----------------------------------------------------------------------------
 * Quiet hours
 * --------------------------------------------------------------------------*/

function toMinutes(t: string): number {
  const [h, m] = t.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}

/** Is the local time of `instant` inside the quiet window (which may cross midnight)? */
export function inQuietHours(instant: Date, start: string | null, end: string | null, timeZone: string): boolean {
  if (!start || !end) return false;
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === e) return false;
  const t = toMinutes(localTimeString(instant, timeZone));
  return s < e ? t >= s && t < e : t >= s || t < e;
}

/** The instant quiet hours end, for an instant inside them. */
export function quietHoursEnd(instant: Date, end: string, timeZone: string): Date {
  const day = localDateString(instant, timeZone);
  const sameDay = zonedToUtc(day, end.slice(0, 5), timeZone);
  return sameDay > instant ? sameDay : zonedToUtc(shiftDate(day, 1), end.slice(0, 5), timeZone);
}
