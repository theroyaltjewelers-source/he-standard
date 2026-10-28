/**
 * Controlled-clock tests for day rollover, recurrence and time-zone edge cases.
 * Every test passes an explicit instant; nothing reads the wall clock.
 */
import { describe, expect, it } from "vitest";
import { addDays, dateRange, generationWindow, msUntilNextLocalMidnight, occursOn, overlapsDay, seriesDates, seriesDueAt, type SeriesLike } from "../series";
import { dayBoundsUtc, localDateString, shiftDate, todayIn, zonedToUtc } from "../time";

const NY = "America/New_York";
const s = (o: Partial<SeriesLike>): SeriesLike => ({ recurrence: "daily", weekdays: [], starts_on: "2026-01-01", ends_on: null, due_time: null, timezone: NY, ...o });
const H = 3_600_000;

describe("midnight rollover", () => {
  it("the local date changes exactly at local midnight, not UTC midnight", () => {
    expect(todayIn(NY, new Date("2026-10-28T03:59:00Z"))).toBe("2026-10-27"); // 23:59 EDT
    expect(todayIn(NY, new Date("2026-10-28T04:00:00Z"))).toBe("2026-10-28"); // 00:00 EDT
    expect(todayIn("Asia/Riyadh", new Date("2026-10-27T20:59:00Z"))).toBe("2026-10-27");
    expect(todayIn("Asia/Riyadh", new Date("2026-10-27T21:00:00Z"))).toBe("2026-10-28");
  });
  it("crosses month and year boundaries", () => {
    expect(shiftDate("2026-10-31", 1)).toBe("2026-11-01");
    expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDate("2028-02-28", 1)).toBe("2028-02-29");
    expect(todayIn(NY, new Date("2027-01-01T05:00:00Z"))).toBe("2027-01-01");
    expect(todayIn(NY, new Date("2027-01-01T04:59:59Z"))).toBe("2026-12-31");
  });
  it("day bounds are 23 h and 25 h on DST transition days", () => {
    const spring = dayBoundsUtc("2026-03-08", NY), fall = dayBoundsUtc("2026-11-01", NY), normal = dayBoundsUtc("2026-10-27", NY);
    expect(spring.end.getTime() - spring.start.getTime()).toBe(23 * H);
    expect(fall.end.getTime() - fall.start.getTime()).toBe(25 * H);
    expect(normal.end.getTime() - normal.start.getTime()).toBe(24 * H);
  });
  it("time until midnight is correct on normal and DST days", () => {
    expect(msUntilNextLocalMidnight(new Date("2026-10-28T03:00:00Z"), "2026-10-27", NY)).toBe(H); // 23:00 EDT
    // 2026-03-08 01:00 EST → next midnight is 22 real hours away (23 h day, 1 h used).
    expect(msUntilNextLocalMidnight(new Date("2026-03-08T06:00:00Z"), "2026-03-08", NY)).toBe(22 * H);
    // 2026-11-01 01:00 EDT → 24 real hours away (25 h day).
    expect(msUntilNextLocalMidnight(new Date("2026-11-01T05:00:00Z"), "2026-11-01", NY)).toBe(24 * H);
    expect(msUntilNextLocalMidnight(new Date("2026-10-28T04:00:00Z"), "2026-10-27", NY)).toBe(1000); // never 0 / negative
  });
});

describe("recurring series", () => {
  it("daily, weekdays and weekly patterns", () => {
    const week = dateRange("2026-10-25", "2026-10-31"); // Sun … Sat
    expect(seriesDates(s({}), week[0], week[6])).toHaveLength(7);
    expect(seriesDates(s({ recurrence: "weekdays" }), week[0], week[6])).toEqual(week.slice(1, 6));
    expect(seriesDates(s({ recurrence: "weekly", weekdays: [1, 3] }), week[0], week[6])).toEqual(["2026-10-26", "2026-10-28"]);
    expect(seriesDates(s({ recurrence: "weekly", starts_on: "2026-10-30" }), "2026-10-25", "2026-11-14")).toEqual(["2026-10-30", "2026-11-06", "2026-11-13"]);
  });
  it("monthly on the 31st falls on the last day of shorter months", () => {
    const m = s({ recurrence: "monthly", starts_on: "2026-01-31" });
    expect(seriesDates(m, "2026-01-01", "2026-05-31")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
    expect(occursOn(s({ recurrence: "monthly", starts_on: "2027-01-29" }), "2028-02-29")).toBe(true);
  });
  it("respects start and end dates", () => {
    expect(occursOn(s({ starts_on: "2026-10-27" }), "2026-10-26")).toBe(false);
    expect(occursOn(s({ ends_on: "2026-10-27" }), "2026-10-28")).toBe(false);
  });
  it("deadlines keep their wall-clock time across DST", () => {
    const due = s({ due_time: "09:00:00" });
    expect(seriesDueAt(due, "2026-10-31")!.toISOString()).toBe("2026-10-31T13:00:00.000Z"); // EDT
    expect(seriesDueAt(due, "2026-11-02")!.toISOString()).toBe("2026-11-02T14:00:00.000Z"); // EST
    expect(seriesDueAt(s({}), "2026-11-02")).toBeNull();
  });
});

describe("generation window (reconciling after inactivity)", () => {
  it("generates today and tomorrow on a fresh series", () => {
    expect(generationWindow({ lastGenerated: null, startsOn: "2026-10-27", today: "2026-10-27" })).toEqual({ from: "2026-10-27", to: "2026-10-28" });
  });
  it("back-fills days missed while the app was closed", () => {
    expect(generationWindow({ lastGenerated: "2026-10-22", startsOn: "2026-01-01", today: "2026-10-27" })).toEqual({ from: "2026-10-23", to: "2026-10-28" });
  });
  it("caps back-fill after very long inactivity", () => {
    expect(generationWindow({ lastGenerated: "2026-01-01", startsOn: "2026-01-01", today: "2026-10-27", maxBackfill: 30 })!.from).toBe(addDays("2026-10-27", -30));
  });
  it("is idempotent once caught up", () => {
    expect(generationWindow({ lastGenerated: "2026-10-28", startsOn: "2026-01-01", today: "2026-10-27" })).toBeNull();
  });
});

describe("events crossing midnight and travel", () => {
  it("an event 23:00–01:00 belongs to both days", () => {
    const start = zonedToUtc("2026-10-27", "23:00", NY), end = zonedToUtc("2026-10-28", "01:00", NY);
    const d1 = dayBoundsUtc("2026-10-27", NY), d2 = dayBoundsUtc("2026-10-28", NY), d3 = dayBoundsUtc("2026-10-29", NY);
    expect(overlapsDay(start, end, d1.start, d1.end)).toBe(true);
    expect(overlapsDay(start, end, d2.start, d2.end)).toBe(true);
    expect(overlapsDay(start, end, d3.start, d3.end)).toBe(false);
  });
  it("an event ending exactly at midnight does not leak into the next day", () => {
    const start = zonedToUtc("2026-10-27", "22:00", NY), end = zonedToUtc("2026-10-28", "00:00", NY);
    const d2 = dayBoundsUtc("2026-10-28", NY);
    expect(overlapsDay(start, end, d2.start, d2.end)).toBe(false);
  });
  it("point events (no end) count on their own day only", () => {
    const at = zonedToUtc("2026-10-28", "00:00", NY), d1 = dayBoundsUtc("2026-10-27", NY), d2 = dayBoundsUtc("2026-10-28", NY);
    expect(overlapsDay(at, null, d1.start, d1.end)).toBe(false);
    expect(overlapsDay(at, null, d2.start, d2.end)).toBe(true);
  });
  it("travel: the same instant is a different local day; stored UTC is unchanged", () => {
    const instant = new Date("2026-10-27T22:30:00Z");
    expect(localDateString(instant, NY)).toBe("2026-10-27");
    expect(localDateString(instant, "Asia/Riyadh")).toBe("2026-10-28");
    // A 9:00 appointment stays 9:00 in the zone it was booked in, regardless of where the user is now.
    expect(zonedToUtc("2026-10-28", "09:00", NY).toISOString()).toBe("2026-10-28T13:00:00.000Z");
  });
});

import { convertWeight, estimated1RM, personalRecords, setVolume, weekKey, weeklyConsistency, weekStreak } from "../fitness";
describe("fitness math", () => {
  it("converts units without drift", () => {
    expect(convertWeight(100, "kg", "lb")).toBeCloseTo(220.46, 2);
    expect(convertWeight(convertWeight(135, "lb", "kg"), "kg", "lb")).toBeCloseTo(135, 6);
  });
  it("volume mixes units and ignores bodyweight/cardio sets", () => {
    expect(setVolume([{ reps: 5, weight: 100, unit: "kg" }, { reps: 10, weight: null, unit: "lb" }, { reps: null, weight: null, unit: "lb", duration_seconds: 600 }], "kg")).toBe(500);
  });
  it("estimated 1RM only for 1–12 reps", () => {
    expect(estimated1RM(100, 1)).toBe(100);
    expect(estimated1RM(100, 10)).toBe(133.3);
    expect(estimated1RM(100, 20)).toBeNull();
  });
  it("PRs pick the best set per exercise across sessions and name variants", () => {
    const prs = personalRecords([
      { name: "Bench press", performed_on: "2026-10-01", sets: [{ reps: 5, weight: 185, unit: "lb" }] },
      { name: "bench  Press", performed_on: "2026-10-15", sets: [{ reps: 3, weight: 100, unit: "kg" }] },
      { name: "Squat", performed_on: "2026-10-15", sets: [{ reps: 5, weight: 225, unit: "lb" }] },
    ], "lb");
    expect(prs).toHaveLength(2);
    expect(prs.find((p) => p.exercise.toLowerCase().startsWith("bench"))!.performed_on).toBe("2026-10-15");
  });
  it("weekly consistency is Monday-based and includes empty weeks", () => {
    expect(weekKey("2026-11-01")).toBe("2026-10-26"); // Sunday → previous Monday
    const w = weeklyConsistency(["2026-10-26", "2026-10-28", "2026-10-13"], "2026-10-28", 3);
    expect(w).toEqual([{ week: "2026-10-12", sessions: 1 }, { week: "2026-10-19", sessions: 0 }, { week: "2026-10-26", sessions: 2 }]);
    expect(weekStreak([{ sessions: 3 }, { sessions: 3 }, { sessions: 1 }], 3)).toBe(2); // current week still in progress
  });
});
