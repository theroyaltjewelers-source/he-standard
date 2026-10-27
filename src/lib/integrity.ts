/**
 * DAILY INTEGRITY SCORE
 *
 * Measures behaviour that was recorded — commitments kept, tasks completed,
 * honest reporting, and consistency. It is not a measure of personal worth.
 *
 * Rules (shown to the user on the dashboard, so keep them in sync with
 * INTEGRITY_RULES below):
 *  - A claim of completion is never worth full credit by itself. Completion
 *    with specific evidence earns more than a bare self-report.
 *  - Honestly reporting a miss earns partial credit; leaving an item
 *    unresolved earns none. Telling the truth about a failure is better than
 *    silence, but never as good as keeping the commitment.
 *  - If nothing was committed or scheduled, there is no score. The system does
 *    not invent a number.
 */

export type Verification = "none" | "self_reported" | "evidence" | "system";

export interface CommitmentInput {
  status: "open" | "kept" | "kept_late" | "broken" | "released";
  verification: Verification;
  failure_context?: string | null;
}

export interface TaskInput {
  status: "pending" | "done" | "missed" | "cancelled";
  verification: Verification;
  miss_reason?: string | null;
}

export interface IntegrityInput {
  commitments: CommitmentInput[];
  tasks: TaskInput[];
  eveningReviewCompleted: boolean;
  /** true once the day is over (or the evening review is done). Before that, open items are "in progress", not failures. */
  dayClosed: boolean;
}

export interface IntegrityComponent {
  key: "commitments" | "tasks" | "reporting";
  label: string;
  weight: number;
  earned: number;
  possible: number;
  score: number | null; // 0–100 or null when nothing to measure
}

export interface IntegrityResult {
  score: number | null;
  components: IntegrityComponent[];
  counts: {
    commitments: number;
    commitmentsKept: number;
    tasks: number;
    tasksDone: number;
    withEvidence: number;
    selfReported: number;
    unresolved: number;
  };
  provisional: boolean;
  explanation: string;
}

export const CREDIT = {
  keptOnTime: { system: 1, evidence: 1, self_reported: 0.8, none: 0.8 },
  keptLate: { system: 0.6, evidence: 0.6, self_reported: 0.5, none: 0.5 },
  brokenReportedWithContext: 0.3,
  brokenReported: 0.2,
  unresolved: 0,
} as const;

export const WEIGHTS = { commitments: 0.55, tasks: 0.3, reporting: 0.15 } as const;

export const INTEGRITY_RULES = [
  "Commitments (55%): kept on time with evidence = full credit; kept on time, self-reported = 80%; kept late = 50–60%; missed but honestly reported = 20–30%; unresolved = 0.",
  "Tasks (30%; if you had only commitments or only tasks, that part carries the full 85%): done with evidence = full credit; done, self-reported = 80%; missed but honestly reported = 20–30%; unresolved = 0.",
  "Honest reporting (15%, fixed): completing the evening review and resolving every item.",
  "No commitments or tasks recorded = no score. The number reflects recorded behaviour only.",
];

function commitmentCredit(c: CommitmentInput): number | null {
  if (c.status === "released") return null; // released by agreement: excluded
  if (c.status === "kept") return CREDIT.keptOnTime[c.verification];
  if (c.status === "kept_late") return CREDIT.keptLate[c.verification];
  if (c.status === "broken")
    return c.failure_context && c.failure_context.trim().length > 0
      ? CREDIT.brokenReportedWithContext
      : CREDIT.brokenReported;
  return CREDIT.unresolved;
}

function taskCredit(t: TaskInput): number | null {
  if (t.status === "cancelled") return null;
  if (t.status === "done") return CREDIT.keptOnTime[t.verification];
  if (t.status === "missed")
    return t.miss_reason && t.miss_reason.trim().length > 0
      ? CREDIT.brokenReportedWithContext
      : CREDIT.brokenReported;
  return CREDIT.unresolved;
}

export function computeIntegrity(input: IntegrityInput): IntegrityResult {
  const cCredits = input.commitments.map(commitmentCredit).filter((x): x is number => x !== null);
  const tCredits = input.tasks.map(taskCredit).filter((x): x is number => x !== null);

  const countable = [
    ...input.commitments.filter((c) => c.status !== "released"),
    ...input.tasks.filter((t) => t.status !== "cancelled"),
  ];
  const unresolved =
    input.commitments.filter((c) => c.status === "open").length +
    input.tasks.filter((t) => t.status === "pending").length;

  const counts = {
    commitments: cCredits.length,
    commitmentsKept: input.commitments.filter((c) => c.status === "kept" || c.status === "kept_late").length,
    tasks: tCredits.length,
    tasksDone: input.tasks.filter((t) => t.status === "done").length,
    withEvidence: countable.filter(
      (x) => (x.verification === "evidence" || x.verification === "system") &&
        ("status" in x && (x.status === "done" || x.status === "kept" || x.status === "kept_late")),
    ).length,
    selfReported: countable.filter(
      (x) => (x.verification === "self_reported" || x.verification === "none") &&
        (x.status === "done" || x.status === "kept" || x.status === "kept_late"),
    ).length,
    unresolved,
  };

  const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);

  const components: IntegrityComponent[] = [
    {
      key: "commitments",
      label: "Commitments kept",
      weight: WEIGHTS.commitments,
      earned: sum(cCredits),
      possible: cCredits.length,
      score: cCredits.length ? Math.round((sum(cCredits) / cCredits.length) * 100) : null,
    },
    {
      key: "tasks",
      label: "Tasks completed",
      weight: WEIGHTS.tasks,
      earned: sum(tCredits),
      possible: tCredits.length,
      score: tCredits.length ? Math.round((sum(tCredits) / tCredits.length) * 100) : null,
    },
  ];

  const measured = cCredits.length + tCredits.length;
  if (measured === 0) {
    components.push({ key: "reporting", label: "Honest reporting", weight: WEIGHTS.reporting, earned: 0, possible: 0, score: null });
    return {
      score: null,
      components,
      counts,
      provisional: false,
      explanation: "Nothing was committed or scheduled for this day, so there is nothing to score.",
    };
  }

  // Reporting: half for completing the evening review, half for the share of items resolved.
  const resolvedShare = countable.length ? (countable.length - unresolved) / countable.length : 1;
  const reportingScore = (input.eveningReviewCompleted ? 0.5 : 0) + 0.5 * resolvedShare;
  components.push({
    key: "reporting",
    label: "Honest reporting",
    weight: WEIGHTS.reporting,
    earned: reportingScore,
    possible: 1,
    score: Math.round(reportingScore * 100),
  });

  // Performance (commitments + tasks) always carries 85%; if only one of the
  // two has data it carries all 85%. Reporting is a fixed 15% so that honesty
  // about a bad day can never outweigh the day itself.
  const perf = components.filter((c) => c.key !== "reporting" && c.score !== null);
  const perfWeight = sum(perf.map((c) => c.weight));
  const perfScore = sum(perf.map((c) => (c.score as number) * c.weight)) / perfWeight;
  const performanceShare = 1 - WEIGHTS.reporting;
  const score = Math.round(perfScore * performanceShare + reportingScore * 100 * WEIGHTS.reporting);

  const provisional = !input.dayClosed;
  const explanation = provisional
    ? `In progress: ${unresolved} item${unresolved === 1 ? "" : "s"} still open. Open items count as zero until you resolve them.`
    : unresolved > 0
      ? `${unresolved} item${unresolved === 1 ? " was" : "s were"} left unresolved and earned no credit.`
      : "All items resolved.";

  return { score, components, counts, provisional, explanation };
}
