import { describe, expect, it } from "vitest";
import { lifecycleReminders, lifecycleRelevant, completionStatus, parseLifecycleKey } from "../lifecycle";
import { budgetDecision, pauseDecision, actionsFor, CATEGORY_PRIORITY } from "../reminder-policy";
import { dailyExecution } from "../scoring";
import { pickInsight } from "../insights";
import { computeScores } from "../scoring";

const start = new Date("2026-10-28T11:00:00Z"); // 7:00 AM New York
const end = new Date("2026-10-28T12:00:00Z");
const before = new Date("2026-10-28T09:00:00Z");

describe("activity lifecycle", () => {
  it("standard: start, did-you-start and did-you-complete", () => {
    const r = lifecycleReminders({ title: "Gym", kind: "workout", level: "standard", start, end, timeZone: "America/New_York", now: before });
    expect(r.map((x) => x.stage)).toEqual(["life-start", "life-started", "life-done"]);
    expect(r[0].sendAt).toEqual(start);
    expect(r[1].sendAt.getTime()).toBe(start.getTime() + 10 * 60_000);
    expect(r[2].sendAt.getTime()).toBe(end.getTime() + 5 * 60_000);
    expect(r[0].title).toContain("Time to train");
  });
  it("light skips the did-you-start check; strict adds one last follow-up; off sends nothing", () => {
    expect(lifecycleReminders({ title: "Call", kind: "call", level: "light", start, end, timeZone: "UTC", now: before }).map((x) => x.stage)).toEqual(["life-start", "life-done"]);
    expect(lifecycleReminders({ title: "Gym", kind: "workout", level: "strict", start, end, timeZone: "UTC", now: before }).map((x) => x.stage)).toEqual(["life-start", "life-started", "life-done", "life-done-2"]);
    expect(lifecycleReminders({ title: "X", kind: "appointment", level: "off", start, end, timeZone: "UTC", now: before })).toEqual([]);
  });
  it("drops stages already in the past", () => {
    const r = lifecycleReminders({ title: "Gym", kind: "workout", level: "standard", start, end, timeZone: "UTC", now: new Date(start.getTime() + 20 * 60_000) });
    expect(r.map((x) => x.stage)).toEqual(["life-done"]);
  });
  it("stops reminding once the user answered", () => {
    expect(lifecycleRelevant("life-start", "scheduled")).toBe(true);
    expect(lifecycleRelevant("life-start", "started")).toBe(false);
    expect(lifecycleRelevant("life-started", "started")).toBe(false);
    expect(lifecycleRelevant("life-done", "started")).toBe(true);
    expect(lifecycleRelevant("life-start-late3", "started")).toBe(false);
    for (const s of ["completed", "completed_late", "skipped", "rescheduled", "excused"] as const) expect(lifecycleRelevant("life-done", s)).toBe(false);
  });
  it("classifies late completion by when it started", () => {
    expect(completionStatus({ scheduledStart: start, startedAt: new Date(start.getTime() + 10 * 60_000), delayMinutes: null })).toBe("completed");
    expect(completionStatus({ scheduledStart: start, startedAt: new Date(start.getTime() + 25 * 60_000), delayMinutes: null })).toBe("completed_late");
    expect(completionStatus({ scheduledStart: start, startedAt: null, delayMinutes: 30 })).toBe("completed_late");
  });
  it("parses lifecycle keys, including snoozed copies", () => {
    const id = "3f2b8c1e-1111-4222-8333-944455556666";
    expect(parseLifecycleKey(`event:${id}:2026-10-28T11:00:00.000Z:life-done`)).toEqual({ eventId: id, occurrence: "2026-10-28T11:00:00.000Z", stage: "life-done" });
    expect(parseLifecycleKey(`event:${id}:2026-10-28T11:00:00.000Z:life-done:snooze:123`)?.stage).toBe("life-done");
    expect(parseLifecycleKey(`event:${id}:2026-10-28T11:00:00.000Z:prep`)).toBeNull();
  });
  it("offers lifecycle notification actions", () => {
    expect(actionsFor("event", "life-start").map((a) => a.action)).toEqual(["start", "late"]);
    expect(actionsFor("event", "life-done").map((a) => a.action)).toEqual(["completed", "remind"]);
  });
});

describe("notification controls", () => {
  it("budget holds normal/low priority but never critical", () => {
    expect(budgetDecision(2, 4, 5)).toBe("send");
    expect(budgetDecision(2, 5, 5)).toBe("hold");
    expect(budgetDecision(3, 9, 5)).toBe("hold");
    expect(budgetDecision(1, 99, 5)).toBe("send");
    expect(budgetDecision(2, 99, null)).toBe("send");
    expect(CATEGORY_PRIORITY.prayer).toBe(1);
  });
  it("pause holds everything except prayer (if kept) and system notices", () => {
    const now = new Date("2026-10-28T12:00:00Z");
    const until = "2026-10-28T15:00:00Z";
    expect(pauseDecision("commitments", until, true, now)).toBe("hold");
    expect(pauseDecision("prayer", until, true, now)).toBe("send");
    expect(pauseDecision("prayer", until, false, now)).toBe("hold");
    expect(pauseDecision("system", until, false, now)).toBe("send");
    expect(pauseDecision("commitments", "2026-10-28T11:00:00Z", true, now)).toBe("send");
  });
});

describe("execution and insights", () => {
  const base = { today: "2026-10-28", tasks: [], commitments: [], occurrences: [] };
  it("counts planned vs completed per day, excluding excused and rescheduled", () => {
    const d = dailyExecution({ ...base,
      tasks: [{ date: "2026-10-27", status: "done", verification: "self_reported", due_at: null, completed_at: null, postponed_count: 0 }, { date: "2026-10-27", status: "cancelled", verification: "none", due_at: null, completed_at: null, postponed_count: 0 }],
      commitments: [{ date: "2026-10-27", status: "kept_late", made_to: "self", promised_by: null, resolved_at: null, verification: "x" }, { date: "2026-10-27", status: "released", made_to: "self", promised_by: null, resolved_at: null, verification: "x" }],
      occurrences: [{ date: "2026-10-27", kind: "workout", status: "rescheduled", evidence: "unverified", start: "2026-10-27T11:00:00Z" }, { date: "2026-10-27", kind: "workout", status: "awaiting_confirmation", evidence: "unverified", start: "2026-10-27T11:00:00Z" }],
    }, "2026-10-27", "2026-10-27");
    expect(d[0]).toMatchObject({ planned: 3, done: 2, late: 1, unknown: 1 });
  });
  it("finds a weak weekday with evidence, and stays silent without it", () => {
    const tasks = [];
    for (let k = 1; k <= 28; k++) {
      const date = new Date(Date.UTC(2026, 9, 28 - k, 12)).toISOString().slice(0, 10);
      const thursday = new Date(`${date}T12:00:00Z`).getUTCDay() === 4;
      tasks.push({ date, status: thursday ? "missed" : "done", verification: "self_reported", due_at: null, completed_at: null, postponed_count: 0 } as const);
      tasks.push({ date, status: thursday && k % 2 ? "missed" : "done", verification: "self_reported", due_at: null, completed_at: null, postponed_count: 0 } as const);
    }
    const input = { today: "2026-10-28", now: new Date("2026-10-28T12:00:00Z"), tasks, commitments: [], occurrences: [], focus: [], impulses: [], habits: [], habitLogs: [], checkins: [], answers: [], journalDates: [], workouts: [] };
    const rep = computeScores({ ...input, from: "2026-10-01", to: "2026-10-28" });
    const ins = pickInsight(input, rep, null);
    expect(ins?.title).toBe("Thursdays are your weakest day");
    expect(ins?.evidence.join(" ")).toMatch(/of 8 resolved items done/);
    const empty = { ...input, tasks: [], since: "2026-10-28" };
    expect(pickInsight(empty, computeScores({ ...empty, from: "2026-10-01", to: "2026-10-28" }), null)).toBeNull();
  });
});
