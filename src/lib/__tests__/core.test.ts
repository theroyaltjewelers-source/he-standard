import { describe, expect, it } from "vitest";
import { computeIntegrity } from "../integrity";
import { eventReminders, inQuietHours, occurrences, prepPlan, quietHoursEnd } from "../scheduling";
import { checkAnswer, EVENING_QUESTIONS, MORNING_QUESTIONS } from "../interview";
import { hijriDate } from "../hijri";
import { dayBoundsUtc, localDateString, shiftDate, weekStart, zonedToUtc } from "../time";

const NY = "America/New_York";

describe("time", () => {
  it("converts local wall time to UTC across DST", () => {
    expect(zonedToUtc("2026-10-27", "20:00", NY).toISOString()).toBe("2026-10-28T00:00:00.000Z"); // EDT
    expect(zonedToUtc("2026-11-10", "20:00", NY).toISOString()).toBe("2026-11-11T01:00:00.000Z"); // EST
  });
  it("computes local date and bounds", () => {
    expect(localDateString(new Date("2026-10-28T02:00:00Z"), NY)).toBe("2026-10-27");
    const b = dayBoundsUtc("2026-10-27", NY);
    expect(b.start.toISOString()).toBe("2026-10-27T04:00:00.000Z");
    expect(b.end.toISOString()).toBe("2026-10-28T04:00:00.000Z");
  });
  it("shifts dates and finds week start", () => {
    expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(weekStart("2026-10-27")).toBe("2026-10-25"); // Tuesday → Sunday
  });
});

describe("hijri", () => {
  it("formats Umm al-Qura date with adjustment", () => {
    expect(hijriDate("2026-10-27")).toBe("16 Jumada I 1448 AH");
    expect(hijriDate("2026-10-27", 1)).toBe("17 Jumada I 1448 AH");
  });
});

describe("integrity score", () => {
  it("returns no score when nothing was recorded", () => {
    const r = computeIntegrity({ commitments: [], tasks: [], eveningReviewCompleted: true, dayClosed: true });
    expect(r.score).toBeNull();
  });

  it("never gives full credit for a bare claim", () => {
    const claimed = computeIntegrity({
      commitments: [{ status: "kept", verification: "self_reported" }],
      tasks: [],
      eveningReviewCompleted: true,
      dayClosed: true,
    });
    const evidenced = computeIntegrity({
      commitments: [{ status: "kept", verification: "evidence" }],
      tasks: [],
      eveningReviewCompleted: true,
      dayClosed: true,
    });
    expect(evidenced.score).toBe(100);
    expect(claimed.score!).toBeLessThan(100);
  });

  it("rewards honest reporting of a miss over silence", () => {
    const honest = computeIntegrity({
      commitments: [{ status: "broken", verification: "none", failure_context: "Scrolled after lunch" }],
      tasks: [],
      eveningReviewCompleted: true,
      dayClosed: true,
    });
    const silent = computeIntegrity({
      commitments: [{ status: "open", verification: "none" }],
      tasks: [],
      eveningReviewCompleted: false,
      dayClosed: true,
    });
    expect(honest.score!).toBeGreaterThan(silent.score!);
    expect(silent.score).toBe(0);
    // ...but honesty about a miss is never close to keeping the commitment.
    expect(honest.score!).toBeLessThan(50);
  });

  it("excludes released commitments and cancelled tasks", () => {
    const r = computeIntegrity({
      commitments: [{ status: "released", verification: "none" }],
      tasks: [{ status: "cancelled", verification: "none" }],
      eveningReviewCompleted: true,
      dayClosed: true,
    });
    expect(r.score).toBeNull();
  });

  it("marks the score provisional before the day is closed", () => {
    const r = computeIntegrity({
      commitments: [{ status: "kept", verification: "evidence" }, { status: "open", verification: "none" }],
      tasks: [{ status: "done", verification: "self_reported" }],
      eveningReviewCompleted: false,
      dayClosed: false,
    });
    expect(r.provisional).toBe(true);
    expect(r.counts.unresolved).toBe(1);
    expect(r.counts.withEvidence).toBe(1);
    expect(r.counts.selfReported).toBe(1);
  });
});

describe("scheduling", () => {
  it("computes prep and departure times for an 8 PM appointment", () => {
    const start = zonedToUtc("2026-10-27", "20:00", NY);
    const p = prepPlan(start, 30, 25);
    expect(p.leaveBy.toISOString()).toBe(zonedToUtc("2026-10-27", "19:35", NY).toISOString());
    expect(p.beginPrepAt.toISOString()).toBe(zonedToUtc("2026-10-27", "19:05", NY).toISOString());
  });

  it("generates prep, leave, offset and evening-before reminders", () => {
    const start = zonedToUtc("2026-10-28", "20:00", NY);
    const r = eventReminders({
      title: "Client consultation",
      startsAt: start,
      prepMinutes: 30,
      travelMinutes: 25,
      offsets: [120],
      importance: "high",
      timeZone: NY,
      now: zonedToUtc("2026-10-27", "09:00", NY),
    });
    expect(r.map((x) => x.key)).toEqual(["eve", "before-120", "prep", "leave"]);
    expect(r[0].sendAt.toISOString()).toBe(zonedToUtc("2026-10-27", "19:00", NY).toISOString());
  });

  it("drops reminders in the past and merges near-duplicates", () => {
    const start = zonedToUtc("2026-10-27", "20:00", NY);
    const r = eventReminders({
      title: "X", startsAt: start, prepMinutes: 0, travelMinutes: 60, offsets: [60, 240],
      importance: "normal", timeZone: NY, now: zonedToUtc("2026-10-27", "17:00", NY),
    });
    expect(r).toHaveLength(1); // 240-before is past; leave (60) and before-60 coincide
  });

  it("expands weekly recurrence keeping local time across DST", () => {
    const start = zonedToUtc("2026-10-26", "09:00", NY); // Monday
    const occ = occurrences({
      startsAt: start, recurrence: "weekly", timeZone: NY,
      from: zonedToUtc("2026-10-26", "00:00", NY), to: zonedToUtc("2026-11-10", "00:00", NY),
    });
    expect(occ.map((d) => localDateString(d, NY))).toEqual(["2026-10-26", "2026-11-02", "2026-11-09"]);
    expect(occ.every((d) => new Intl.DateTimeFormat("en-US", { timeZone: NY, hour: "numeric", hour12: false }).format(d) === "09")).toBe(true);
  });

  it("respects recurrence end dates", () => {
    const occ = occurrences({
      startsAt: zonedToUtc("2026-10-01", "08:00", NY), recurrence: "daily", until: "2026-10-03", timeZone: NY,
      from: zonedToUtc("2026-10-01", "00:00", NY), to: zonedToUtc("2026-10-31", "00:00", NY),
    });
    expect(occ).toHaveLength(3);
  });

  it("handles quiet hours crossing midnight", () => {
    const late = zonedToUtc("2026-10-27", "23:30", NY);
    const early = zonedToUtc("2026-10-28", "05:00", NY);
    const day = zonedToUtc("2026-10-27", "14:00", NY);
    expect(inQuietHours(late, "22:30", "06:30", NY)).toBe(true);
    expect(inQuietHours(early, "22:30", "06:30", NY)).toBe(true);
    expect(inQuietHours(day, "22:30", "06:30", NY)).toBe(false);
    expect(quietHoursEnd(late, "06:30", NY).toISOString()).toBe(zonedToUtc("2026-10-28", "06:30", NY).toISOString());
    expect(quietHoursEnd(early, "06:30", NY).toISOString()).toBe(zonedToUtc("2026-10-28", "06:30", NY).toISOString());
  });
});

describe("interview answer checks", () => {
  const evidence = EVENING_QUESTIONS.find((q) => q.key === "evidence")!;
  const money = EVENING_QUESTIONS.find((q) => q.key === "money")!;
  const spiritual = MORNING_QUESTIONS.find((q) => q.key === "spiritual_intention")!;

  it("asks what specifically occupied the time for 'I was busy'", () => {
    const r = checkAnswer(evidence, "I was busy");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("vague");
    expect(r.followUp).toMatch(/specifically/);
  });
  it("accepts a specific answer that mentions being busy", () => {
    expect(checkAnswer(evidence, "Sent the Hendricks quote at 3pm and finished the CAD review with Marcus before closing").ok).toBe(true);
  });
  it("accepts honest short answers where appropriate", () => {
    expect(checkAnswer(money, "Nowhere").ok).toBe(true);
  });
  it("does not require optional questions", () => {
    expect(checkAnswer(spiritual, "").ok).toBe(true);
  });
  it("rejects empty required answers", () => {
    expect(checkAnswer(evidence, "   ").reason).toBe("empty");
  });
});
