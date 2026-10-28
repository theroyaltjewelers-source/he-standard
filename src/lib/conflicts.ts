import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { eventsBetween } from "./records";
import { prayerConfig, type PrayerSettingsRow } from "./reminders";
import { PRAYERS, PRAYER_LABEL, prayerTimesFor } from "./prayer";
import { formatInZone, localDateString } from "./time";

/**
 * Overlaps between a proposed time block and the existing schedule
 * (appointments and prayer start times). Preparation/travel lead time counts
 * as part of the block. Used before any create, move or reschedule.
 */
export async function findConflicts(db: SupabaseClient, start: Date, end: Date, tz: string, ignoreEventId: string | null, leadMinutes = 0): Promise<string[]> {
  const blockStart = new Date(start.getTime() - leadMinutes * 60_000);
  const day = localDateString(start, tz);
  const occ = await eventsBetween(db, day, localDateString(end, tz), tz);
  const out: string[] = [];
  for (const o of occ) {
    if (o.event.all_day || o.event.id === ignoreEventId) continue;
    const oEnd = o.end ?? new Date(o.start.getTime() + 3600_000);
    const oLead = new Date(o.start.getTime() - ((o.event.prep_minutes ?? 0) + (o.event.travel_minutes ?? 0)) * 60_000);
    if (oLead < end && oEnd > blockStart) out.push(`“${o.event.title}” ${formatInZone(o.start, tz, "h:mm a")}–${formatInZone(oEnd, tz, "h:mm a")}`);
  }
  const { data: ps } = await db.from("prayer_settings").select("*").maybeSingle<PrayerSettingsRow>();
  const cfg = ps ? prayerConfig(ps, tz) : null;
  if (cfg) {
    const times = prayerTimesFor(day, cfg);
    for (const p of PRAYERS) if (times[p] >= blockStart && times[p] < end) out.push(`${PRAYER_LABEL[p]} at ${formatInZone(times[p], tz, "h:mm a")}`);
  }
  return out;
}
