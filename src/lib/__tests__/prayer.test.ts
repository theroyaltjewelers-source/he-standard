import { describe, expect, it } from "vitest";
import { distanceKm, nextPrayer, prayerTimesFor, prayerWindowEnd, type PrayerConfig } from "../prayer";
import { formatInZone, localDateString } from "../time";

const raleigh: PrayerConfig = {
  latitude: 35.7796, longitude: -78.6382, method: "NorthAmerica", madhab: "shafi",
  highLatitudeRule: "recommended", offsets: {}, timeZone: "America/New_York",
};
const t = (d: Date, tz = "America/New_York") => formatInZone(d, tz, "HH:mm");

describe("prayer times", () => {
  it("computes Raleigh times in order and on the right local day", () => {
    const s = prayerTimesFor("2026-10-27", raleigh);
    expect(s.fajr < s.sunrise && s.sunrise < s.dhuhr && s.dhuhr < s.asr && s.asr < s.maghrib && s.maghrib < s.isha).toBe(true);
    for (const k of ["fajr", "dhuhr", "asr", "maghrib", "isha"] as const) expect(localDateString(s[k], raleigh.timeZone)).toBe("2026-10-27");
    expect(t(s.dhuhr)).toMatch(/^12:5\d|^13:0\d/);
    expect(t(s.maghrib)).toMatch(/^18:2\d/);
  });

  it("shifts by an hour across the DST change (Nov 1, 2026)", () => {
    const before = prayerTimesFor("2026-10-31", raleigh);
    const after = prayerTimesFor("2026-11-02", raleigh);
    // Solar noon barely moves in 2 days, so local Dhuhr drops by ~1 hour.
    const diffMin = (Number(t(before.dhuhr).slice(0, 2)) * 60 + Number(t(before.dhuhr).slice(3))) -
      (Number(t(after.dhuhr).slice(0, 2)) * 60 + Number(t(after.dhuhr).slice(3)));
    expect(diffMin).toBeGreaterThanOrEqual(58);
    expect(diffMin).toBeLessThanOrEqual(62);
  });

  it("Hanafi Asr is later than Shafi Asr", () => {
    const shafi = prayerTimesFor("2026-10-27", raleigh);
    const hanafi = prayerTimesFor("2026-10-27", { ...raleigh, madhab: "hanafi" });
    expect(hanafi.asr.getTime()).toBeGreaterThan(shafi.asr.getTime());
    expect(hanafi.dhuhr.getTime()).toBe(shafi.dhuhr.getTime());
  });

  it("applies manual offsets", () => {
    const base = prayerTimesFor("2026-10-27", raleigh);
    const adj = prayerTimesFor("2026-10-27", { ...raleigh, offsets: { isha: 10 } });
    expect((adj.isha.getTime() - base.isha.getTime()) / 60000).toBe(10);
  });

  it("recalculates for a new city and time zone (travel)", () => {
    const london: PrayerConfig = { ...raleigh, latitude: 51.5072, longitude: -0.1276, method: "MuslimWorldLeague", timeZone: "Europe/London" };
    const s = prayerTimesFor("2026-10-27", london);
    expect(localDateString(s.dhuhr, "Europe/London")).toBe("2026-10-27");
    expect(t(s.dhuhr, "Europe/London")).toMatch(/^11:[45]\d/);
  });

  it("handles places east of UTC on the correct local date", () => {
    const tokyo: PrayerConfig = { ...raleigh, latitude: 35.6762, longitude: 139.6503, timeZone: "Asia/Tokyo" };
    const s = prayerTimesFor("2026-10-27", tokyo);
    for (const k of ["fajr", "dhuhr", "isha"] as const) expect(localDateString(s[k], "Asia/Tokyo")).toBe("2026-10-27");
  });

  it("finds the next prayer and rolls over to tomorrow's Fajr after Isha", () => {
    const s = prayerTimesFor("2026-10-27", raleigh);
    expect(nextPrayer("2026-10-27", raleigh, new Date(s.dhuhr.getTime() + 60000)).prayer).toBe("asr");
    const n = nextPrayer("2026-10-27", raleigh, new Date(s.isha.getTime() + 60000));
    expect(n.prayer).toBe("fajr");
    expect(n.date).toBe("2026-10-28");
  });

  it("prayer windows end when the next one begins", () => {
    const s = prayerTimesFor("2026-10-27", raleigh);
    expect(prayerWindowEnd("dhuhr", "2026-10-27", raleigh).getTime()).toBe(s.asr.getTime());
    expect(prayerWindowEnd("fajr", "2026-10-27", raleigh).getTime()).toBe(s.sunrise.getTime());
  });

  it("measures distance for relocation", () => {
    expect(Math.round(distanceKm({ lat: 35.7796, lon: -78.6382 }, { lat: 35.994, lon: -78.8986 }))).toBeGreaterThan(30); // Raleigh → Durham
  });
});
