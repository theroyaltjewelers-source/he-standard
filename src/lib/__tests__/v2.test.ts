import { describe, expect, it, beforeAll } from "vitest";
import { followUpSchedule, nextFollowUp, categorySetting, actionsFor, ESCALATE_AFTER_IGNORED } from "../reminder-policy";
import { resolve, normalize } from "../coach/match";
import { composeGuided } from "../reflection";
import { checkAnswer, MIDDAY_QUESTIONS, EVENING_QUESTIONS } from "../interview";

describe("reminder policy", () => {
  it("schedules follow-ups by intensity", () => {
    expect(followUpSchedule("gentle")).toEqual([60]);
    expect(followUpSchedule("balanced")).toEqual([30, 120]);
    expect(followUpSchedule("firm")).toEqual([15, 45, 120]);
    expect(followUpSchedule("custom", [300, 10, -5, 5000, 20])).toEqual([10, 20, 300]);
  });
  it("follows up while open, then stops", () => {
    expect(nextFollowUp("balanced", 0, 0)).toEqual({ kind: "follow_up", atMinutes: 30 });
    expect(nextFollowUp("balanced", 1, 1)).toEqual({ kind: "follow_up", atMinutes: 120 });
    expect(nextFollowUp("balanced", 2, 2)).toEqual({ kind: "stop" });
  });
  it("escalates to an offer to adjust instead of nagging after repeated ignored reminders", () => {
    expect(nextFollowUp("firm", 1, ESCALATE_AFTER_IGNORED)).toEqual({ kind: "offer_adjustment" });
  });
  it("defaults categories and lets user settings override", () => {
    expect(categorySetting(null, "prayer")).toEqual({ enabled: true, quiet_override: true });
    expect(categorySetting({ prayer: { enabled: false } }, "prayer")).toEqual({ enabled: false, quiet_override: true });
    expect(categorySetting({}, "commitments").quiet_override).toBe(false);
  });
  it("offers Prayed (never Missed) on prayer notifications", () => {
    const a = actionsFor("prayer").map((x) => x.action);
    expect(a).toContain("prayed");
    expect(a).not.toContain("missed");
    expect(actionsFor("task").map((x) => x.action)).toEqual(["done", "snooze"]);
  });
});

describe("coach reference matching", () => {
  const items = [
    { id: 1, title: "Morning workout at the gym" },
    { id: 2, title: "Monthly financial review" },
    { id: 3, title: "Call the supplier" },
    { id: 4, title: "Call mom" },
  ];
  it("resolves synonyms to one record", () => {
    expect(resolve("my exercise", items, (i) => i.title)).toEqual({ kind: "one", item: items[0] });
    expect(resolve("the finance review", items, (i) => i.title)).toEqual({ kind: "one", item: items[1] });
  });
  it("asks when a reference is ambiguous", () => {
    const r = resolve("the call", items, (i) => i.title);
    expect(r.kind).toBe("many");
  });
  it("returns none rather than guessing", () => {
    expect(resolve("dentist", items, (i) => i.title)).toEqual({ kind: "none" });
  });
  it("normalizes stop words and plurals", () => {
    expect(normalize("My meetings today")).toEqual(["meeting"]);
  });
});

describe("guided reflection", () => {
  it("joins answered prompts and skips empty ones", () => {
    const body = composeGuided("gratitude", ["Health", "", "Losing the deal"], "Extra note");
    expect(body).toContain("Three things I'm grateful for today, and why each matters.\nHealth");
    expect(body).not.toContain("Someone who helped me");
    expect(body.endsWith("Extra note")).toBe(true);
  });
  it("free mode is just the text", () => {
    expect(composeGuided("free", [], " hello ")).toBe("hello");
  });
});

describe("interview answers", () => {
  it("accepts 'Nothing' for the midday distraction question", () => {
    const q = MIDDAY_QUESTIONS.find((x) => x.key === "distracted_by")!;
    expect(checkAnswer(q, "Nothing").ok).toBe(true);
  });
  it("asks a follow-up for a vague excuse", () => {
    const q = EVENING_QUESTIONS.find((x) => x.key === "failure_trigger")!;
    const r = checkAnswer(q, "I was just busy all day honestly");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("vague");
  });
});

describe("token encryption", () => {
  beforeAll(() => { process.env.TOKEN_ENCRYPTION_KEY = "test-secret-for-unit-tests"; });
  it("round-trips and detects tampering", async () => {
    const { encrypt, decrypt } = await import("../crypto");
    const t = encrypt("ya29.secret-token");
    expect(t.startsWith("v1.")).toBe(true);
    expect(t).not.toContain("secret-token");
    expect(decrypt(t)).toBe("ya29.secret-token");
    const parts = t.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decrypt(parts.join("."))).toThrow();
  });
});

describe("coach tool confirmation policy", () => {
  it("requires confirmation for destructive and calendar-changing tools only", async () => {
    const { TOOLS } = await import("../coach/tools");
    const needs = (n: string) => typeof TOOLS.find((t) => t.name === n)?.confirm === "function";
    for (const n of ["delete_task", "delete_commitment", "create_event", "reschedule_event", "delete_event"]) expect(needs(n), n).toBe(true);
    for (const n of ["create_task", "complete_item", "confirm_prayer", "get_today"]) expect(needs(n), n).toBe(false);
  });
});
