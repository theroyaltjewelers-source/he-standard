import { describe, expect, it } from "vitest";
import { computeScores, commitmentIntegrity, trend, POLICY_V1, type ScoringInput, type CommitmentRec } from "../scoring";

const base = (over: Partial<ScoringInput> = {}): ScoringInput => ({
  from: "2026-10-21", to: "2026-10-27", today: "2026-10-27", now: new Date("2026-10-27T22:00:00Z"),
  commitments: [], tasks: [], occurrences: [], focus: [], impulses: [], habits: [], habitLogs: [],
  checkins: [], answers: [], journalDates: [], workouts: [], ...over,
});
const c = (status: CommitmentRec["status"], extra: Partial<CommitmentRec> = {}): CommitmentRec => ({
  date: "2026-10-25", status, made_to: "self", promised_by: "2026-10-25T18:00:00Z", resolved_at: "2026-10-25T17:00:00Z", verification: "self_reported", ...extra,
});

describe("scoring engine", () => {
  it("returns insufficient data, not zero, when nothing is recorded", () => {
    const r = computeScores(base({ since: "2026-10-27" }));
    expect(r.overall).toBeNull();
    expect(r.overallStatus).toBe("insufficient");
    expect(r.domains.every((d) => d.score === null)).toBe(true);
    expect(r.excluded).toHaveLength(7);
    expect(r.policyVersion).toBe(POLICY_V1.version);
  });

  it("does not count unknown outcomes as failures", () => {
    const r = computeScores(base({ commitments: [c("kept"), c("kept"), c("kept"), c("open"), c("open", { date: "2026-10-22" })] }));
    const m = r.domains.find((d) => d.key === "reliability")!.metrics.find((x) => x.key === "commitments_on_time")!;
    expect(m.denominator).toBe(3);
    expect(m.unknown).toBe(2);
    expect(m.value).toBe(1);
  });

  it("gives late completion partial credit, never zero", () => {
    const r = computeScores(base({ commitments: [c("kept"), c("kept_late"), c("broken")] }));
    const m = r.domains[0].metrics[0];
    expect(m.numerator).toBe(1 + POLICY_V1.lateCredit);
    expect(m.denominator).toBe(3);
  });

  it("measures lateness against the original deadline after rescheduling", () => {
    const resched = c("kept", { original_promised_by: "2026-10-25T15:00:00Z", promised_by: "2026-10-25T20:00:00Z", resolved_at: "2026-10-25T19:00:00Z", reschedule_count: 1 });
    const r = computeScores(base({ commitments: [resched, c("kept"), c("kept")] }));
    expect(r.domains[0].metrics[0].numerator).toBe(2 + POLICY_V1.lateCredit);
    const b = commitmentIntegrity([resched, c("kept"), c("kept")], "2026-10-21", "2026-10-27", "2026-10-27", new Date("2026-10-27T22:00:00Z"));
    expect(b).toMatchObject({ onTime: 2, late: 1, rescheduled: 1 });
  });

  it("excludes excused commitments and reports them", () => {
    const b = commitmentIntegrity([c("released"), c("kept"), c("kept"), c("broken"), c("open", { date: "2026-10-27", promised_by: "2026-10-27T20:00:00Z" }), c("open", { date: "2026-10-23" })],
      "2026-10-21", "2026-10-27", "2026-10-27", new Date("2026-10-27T22:00:00Z"));
    expect(b).toMatchObject({ eligible: 3, onTime: 2, missed: 1, excused: 1, awaiting: 1, unknown: 1 });
    expect(b.onTimeRate).toBeCloseTo(2 / 3);
  });

  it("treats rescheduled and excused activity occurrences as neutral and unanswered as awaiting", () => {
    const occ = (status: string) => ({ date: "2026-10-24", kind: "workout", status, evidence: "self_reported" as const, start: "2026-10-24T11:00:00Z" });
    const r = computeScores(base({ occurrences: [occ("completed"), occ("completed"), occ("skipped"), occ("rescheduled"), occ("excused"), occ("awaiting_confirmation")] }));
    const m = r.domains.find((d) => d.key === "fitness")!.metrics[0];
    expect(m).toMatchObject({ numerator: 2, denominator: 3, excluded: 2, unknown: 1 });
    expect(r.domains.find((d) => d.key === "fitness")!.score).toBe(67);
  });

  it("only shows an overall score when enough of the weight is covered, and lists exclusions", () => {
    const days = ["2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26"];
    const checkins = days.flatMap((d) => [{ date: d, kind: "morning" as const, status: "completed" }, { date: d, kind: "evening" as const, status: "completed" }]);
    // Reliability (0.25) + planning (0.15) + self-awareness (0.10) = 0.50 → just at the floor
    const r = computeScores(base({ commitments: [c("kept"), c("kept"), c("broken")], checkins, tasks: [] }));
    const scored = r.domains.filter((d) => d.score !== null).map((d) => d.key).sort();
    expect(scored).toEqual(["planning", "reliability", "self_awareness"].sort());
    expect(r.coverageWeight).toBe(0.5);
    expect(r.overall).not.toBeNull();
    expect(r.excluded.map((e) => e.key)).toContain("fitness");
    // Remove planning/self-awareness evidence → below floor → no overall
    const r2 = computeScores(base({ since: "2026-10-27", commitments: [c("kept"), c("kept"), c("broken")] }));
    expect(r2.overall).toBeNull();
  });

  it("never counts days before the account existed", () => {
    const r = computeScores(base({ since: "2026-10-26" }));
    expect(r.domains.find((d) => d.key === "planning")!.metrics[0].denominator).toBe(1);
  });

  it("never counts future days", () => {
    const r = computeScores(base({ from: "2026-10-27", to: "2026-11-02", checkins: [{ date: "2026-10-27", kind: "morning", status: "completed" }] }));
    const m = r.domains.find((d) => d.key === "planning")!.metrics[0];
    expect(m.denominator).toBe(1);
  });

  it("prorates habit targets and excludes rest days", () => {
    const habits = [{ id: "h", area: "attention", target_per_week: 7, created: "2026-10-01", active: true }];
    const logs = [
      ...["2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"].map((d) => ({ habit_id: "h", date: d, status: "done" as const })),
      { habit_id: "h", date: "2026-10-25", status: "rest" as const },
    ];
    const r = computeScores(base({ habits, habitLogs: logs }));
    const m = r.domains.find((d) => d.key === "discipline")!.metrics.find((x) => x.key === "habit_consistency")!;
    expect(m.denominator).toBe(6);
    expect(m.numerator).toBe(4);
  });

  it("is deterministic", () => {
    const i = base({ commitments: [c("kept"), c("kept_late"), c("broken"), c("kept")] });
    expect(JSON.stringify(computeScores(i))).toBe(JSON.stringify(computeScores(i)));
  });

  it("produces gaps rather than interpolated values in trends", () => {
    const t = trend({ ...base(), commitments: [c("kept"), c("kept"), c("kept")] }, "30d", "2026-09-01");
    expect(t.points.length).toBeGreaterThanOrEqual(30);
    const early = t.points.find((p) => p.date === "2026-10-05")!;
    expect(early.overall).toBeNull();
    expect(t.points[t.points.length - 1].date).toBe("2026-10-27");
  });
});
