import { describe, expect, it } from "vitest";
import { dayLabel, newEntryDefaults, validateFood } from "../food";
import { localDateString } from "../time";

const NY = "America/New_York";
const now = new Date("2026-10-28T03:30:00Z"); // 23:30 on Oct 27 in New York
const base = { description: "Eggs, toast and fruit", date: "2026-10-27", time: "08:15" };

describe("food entry validation", () => {
  it("accepts a minimal entry; optional fields are optional", () => {
    const r = validateFood(base, NY, now);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.values).toMatchObject({ description: "Eggs, toast and fruit", local_date: "2026-10-27", meal: null, portion: null, notes: null });
      expect(r.values.eaten_at).toBe("2026-10-27T12:15:00.000Z");
    }
  });
  it("trims text and rejects empty or whitespace-only descriptions", () => {
    expect(validateFood({ ...base, description: "   \n\t " }, NY, now)).toEqual({ ok: false, errors: { description: "Describe what you ate." } });
    const r = validateFood({ ...base, description: "  oatmeal  ", portion: " 1 bowl ", notes: "  " }, NY, now);
    expect(r.ok && r.values.description === "oatmeal" && r.values.portion === "1 bowl" && r.values.notes === null).toBe(true);
  });
  it("enforces text limits with a helpful message", () => {
    const r = validateFood({ ...base, description: "x".repeat(501) }, NY, now);
    expect(!r.ok && r.errors.description).toMatch(/under 500 characters \(now 501\)/);
    expect(validateFood({ ...base, notes: "n".repeat(1001) }, NY, now).ok).toBe(false);
    expect(validateFood({ ...base, portion: "p".repeat(101) }, NY, now).ok).toBe(false);
  });
  it("rejects future times, allows a minute of clock drift", () => {
    expect(validateFood({ ...base, time: "23:45" }, NY, now)).toMatchObject({ ok: false, errors: { time: expect.stringMatching(/hasn't happened yet/) } });
    expect(validateFood({ ...base, date: "2026-10-28", time: "00:05" }, NY, now).ok).toBe(false);
    expect(validateFood({ ...base, time: "23:30" }, NY, now).ok).toBe(true);
  });
  it("rejects invalid dates, times and meal values", () => {
    expect(validateFood({ ...base, date: "2026-02-30" }, NY, now).ok).toBe(false);
    expect(validateFood({ ...base, time: "25:00" }, NY, now).ok).toBe(false);
    expect(validateFood({ ...base, meal: "brunch" }, NY, now).ok).toBe(false);
    expect(validateFood({ ...base, meal: "snack" }, NY, now).ok).toBe(true);
  });
  it("late-night and midnight meals land on the chosen local day, not the UTC day", () => {
    const late = validateFood({ ...base, time: "23:20" }, NY, now);
    expect(late.ok && late.values.local_date).toBe("2026-10-27");
    expect(late.ok && late.values.eaten_at.slice(0, 10)).toBe("2026-10-28"); // UTC date differs
    const midnight = validateFood({ ...base, time: "00:00" }, NY, now);
    expect(midnight.ok && midnight.values.local_date).toBe("2026-10-27");
    expect(midnight.ok && localDateString(new Date(midnight.values.eaten_at), NY)).toBe("2026-10-27");
  });
  it("handles daylight-saving days without crashing or changing the day", () => {
    const later = new Date("2026-12-01T00:00:00Z");
    const gap = validateFood({ ...base, date: "2026-03-08", time: "02:30" }, NY, later); // doesn't exist (spring forward)
    expect(gap.ok && gap.values.local_date).toBe("2026-03-08");
    const repeat = validateFood({ ...base, date: "2026-11-01", time: "01:30" }, NY, later); // happens twice (fall back)
    expect(repeat.ok && repeat.values.local_date).toBe("2026-11-01");
  });
  it("stored local day doesn't depend on the viewer's zone (travel)", () => {
    const r = validateFood({ ...base, time: "21:00" }, NY, now);
    // Logged in New York at 9 PM; viewed from Riyadh it's already the next day, but the entry keeps its day.
    expect(r.ok && r.values.local_date).toBe("2026-10-27");
    expect(r.ok && localDateString(new Date(r.values.eaten_at), "Asia/Riyadh")).toBe("2026-10-28");
  });
});

describe("food helpers", () => {
  it("new entries default to the chosen day (never the future) at the current time", () => {
    expect(newEntryDefaults("2026-10-27", NY, now)).toEqual({ date: "2026-10-27", time: "23:30" });
    expect(newEntryDefaults("2026-10-20", NY, now)).toEqual({ date: "2026-10-20", time: "23:30" });
    expect(newEntryDefaults("2026-11-05", NY, now)).toEqual({ date: "2026-10-27", time: "23:30" });
  });
  it("labels days", () => {
    expect(dayLabel("2026-10-27", "2026-10-27")).toBe("Today");
    expect(dayLabel("2026-10-26", "2026-10-27")).toBe("Yesterday");
    expect(dayLabel("2026-10-20", "2026-10-27")).toBe("Tue, Oct 20");
    expect(dayLabel("2025-12-31", "2026-10-27")).toBe("Wed, Dec 31, 2025");
  });
});
