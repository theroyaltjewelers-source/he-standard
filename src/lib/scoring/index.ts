/**
 * Deterministic personal-development scoring.
 *
 * Pure functions over stored records: no AI, no network, no randomness. Every
 * metric reports its numerator, denominator, eligible events, exclusions,
 * evidence mix and data coverage, under a versioned policy. Claude may explain
 * these numbers; it can neither produce nor change them.
 *
 * Principles (enforced below and in tests):
 *   - Unknown outcomes are excluded from the denominator and reported as
 *     coverage gaps — never counted as failure.
 *   - Late completion earns partial credit, never zero.
 *   - Rescheduling preserves the original deadline; lateness is measured
 *     against it.
 *   - A metric or domain without enough eligible events says "insufficient
 *     data" instead of producing a number.
 *   - The overall score lists every excluded domain and the share of the total
 *     weight it is based on; below the policy's coverage floor there is no
 *     overall score at all.
 */

export const POLICY_V1 = {
  version: "2026.10-1",
  weights: {
    reliability: 0.25,
    discipline: 0.2,
    fitness: 0.15,
    planning: 0.15,
    self_awareness: 0.1,
    communication: 0.1,
    learning: 0.05,
  },
  /** Minimum eligible events for a metric to produce a value. */
  minEvents: 3,
  /** Credit for completing after the (original) deadline. */
  lateCredit: 0.5,
  /** Credit for an urge that was partly resisted. */
  partialCredit: 0.5,
  /** Minimum share of total domain weight that must be scored to show an overall score. */
  minCoverageForOverall: 0.5,
} as const;
export type Policy = typeof POLICY_V1;

export type DomainKey = keyof Policy["weights"];
export const DOMAIN_LABEL: Record<DomainKey, string> = {
  reliability: "Reliability",
  discipline: "Discipline & attention",
  fitness: "Fitness",
  planning: "Planning & execution",
  self_awareness: "Self-awareness",
  communication: "Communication",
  learning: "Learning & reasoning",
};

/* --------------------------------- inputs --------------------------------- */

export type Evidence = "confirmed" | "self_reported" | "imported" | "unverified";

export interface CommitmentRec { date: string; status: "open" | "kept" | "kept_late" | "broken" | "released"; made_to: string; promised_by: string | null; original_promised_by?: string | null; resolved_at: string | null; verification: string; reschedule_count?: number; source?: string }
export interface TaskRec { date: string | null; status: "pending" | "done" | "missed" | "cancelled"; verification: string; due_at: string | null; original_due_at?: string | null; original_scheduled_for?: string | null; completed_at: string | null; postponed_count: number }
export interface OccurrenceRec { date: string; kind: string; status: string; evidence: Evidence; start: string }
export interface FocusRec { date: string; status: "active" | "completed" | "abandoned"; planned_minutes: number; minutes: number; distractions: number }
export interface ImpulseRec { date: string; outcome: "resisted" | "acted" | "partly" | "unsure" | null }
export interface HabitRec { id: string; area: string; target_per_week: number; created: string; active: boolean }
export interface HabitLogRec { habit_id: string; date: string; status: "done" | "skipped" | "rest" }
export interface CheckinRec { date: string; kind: "morning" | "midday" | "evening"; status: string }
export interface AnswerRec { date: string; key: string; skipped: boolean }
export interface WorkoutRec { date: string; type: string }

export interface ScoringInput {
  from: string;          // local date, inclusive
  to: string;            // local date, inclusive
  today: string;         // local date
  now: Date;
  commitments: CommitmentRec[];
  tasks: TaskRec[];
  occurrences: OccurrenceRec[];
  focus: FocusRec[];
  impulses: ImpulseRec[];
  habits: HabitRec[];
  habitLogs: HabitLogRec[];
  checkins: CheckinRec[];
  answers: AnswerRec[];
  journalDates: string[];
  workouts: WorkoutRec[];
  workoutTargetPerWeek?: number | null;
  /** First day the account existed; day-based metrics never count days before it. */
  since?: string;
}

/* --------------------------------- outputs -------------------------------- */

export interface EvidenceMix { confirmed: number; self_reported: number; imported: number; unverified: number }
export interface Metric {
  key: string;
  label: string;
  numerator: number;
  denominator: number;
  value: number | null;         // 0..1, null when insufficient
  status: "ok" | "insufficient";
  eligible: string;             // which events count
  exclusions: string;           // what is excluded and why
  unknown: number;              // eligible events with no recorded outcome (not counted)
  excluded: number;             // events excluded by policy (excused, rescheduled, …)
  evidence: EvidenceMix;
  source: string;               // tables the metric reads
}
export interface DomainScore {
  key: DomainKey;
  label: string;
  weight: number;
  score: number | null;         // 0..100
  status: "ok" | "insufficient";
  reason: string | null;
  metrics: Metric[];
  numerator: number;
  denominator: number;
}
export interface ScoreReport {
  policyVersion: string;
  from: string;
  to: string;
  overall: number | null;
  overallStatus: "ok" | "insufficient";
  coverageWeight: number;       // share of total weight that is scored (0..1)
  domains: DomainScore[];
  excluded: { key: DomainKey; label: string; reason: string }[];
}

/* --------------------------------- helpers -------------------------------- */

const inRange = (d: string | null | undefined, from: string, to: string) => !!d && d >= from && d <= to;
const emptyMix = (): EvidenceMix => ({ confirmed: 0, self_reported: 0, imported: 0, unverified: 0 });
const evidenceOf = (v: string): Evidence => (v === "evidence" || v === "system" || v === "confirmed" ? "confirmed" : v === "self_reported" ? "self_reported" : v === "imported" ? "imported" : "unverified");

function metric(policy: Policy, m: Omit<Metric, "value" | "status">): Metric {
  const ok = m.denominator >= policy.minEvents;
  return { ...m, value: ok ? m.numerator / m.denominator : null, status: ok ? "ok" : "insufficient" };
}

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (d <= end) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}

/** Days of the period that have already finished or are today (future days are never eligible). */
function elapsedDays(i: ScoringInput) {
  const start = i.since && i.since > i.from ? i.since : i.from;
  const end = i.to < i.today ? i.to : i.today;
  return start > end ? [] : daysBetween(start, end);
}

/* ------------------------------ metric builders ---------------------------- */

/** On-time rate for commitments, measured against the ORIGINAL deadline. */
export function commitmentMetric(policy: Policy, i: ScoringInput, filter: (c: CommitmentRec) => boolean, key: string, label: string): Metric {
  const list = i.commitments.filter((c) => inRange(c.date, i.from, i.to) && filter(c));
  let num = 0, den = 0, unknown = 0, excluded = 0;
  const ev = emptyMix();
  for (const c of list) {
    if (c.status === "released") { excluded++; continue; }
    if (c.status === "open") {
      // Not yet due, or past due without a record: either way unknown, not failure.
      unknown++;
      continue;
    }
    den++;
    ev[evidenceOf(c.verification)]++;
    if (c.status === "broken") continue;
    const deadline = c.original_promised_by ?? c.promised_by;
    const lateByRecord = c.status === "kept_late";
    const lateVsOriginal = !!(deadline && c.resolved_at && Date.parse(c.resolved_at) > Date.parse(deadline) + 5 * 60_000 && (c.reschedule_count ?? 0) > 0);
    num += lateByRecord || lateVsOriginal ? policy.lateCredit : 1;
  }
  return metric(policy, {
    key, label, numerator: num, denominator: den, unknown, excluded, evidence: ev,
    eligible: "Commitments dated in the period with a recorded outcome (kept, kept late, not kept).",
    exclusions: "Released by agreement (excused) are excluded. Open or unrecorded commitments are unknown and not counted. Lateness is measured against the original deadline; late = half credit.",
    source: "commitments",
  });
}

function occurrenceMetric(policy: Policy, i: ScoringInput, kinds: string[], key: string, label: string): Metric {
  const list = i.occurrences.filter((o) => inRange(o.date, i.from, i.to) && kinds.includes(o.kind) && Date.parse(o.start) <= i.now.getTime());
  let num = 0, den = 0, unknown = 0, excluded = 0;
  const ev = emptyMix();
  for (const o of list) {
    if (o.status === "excused" || o.status === "rescheduled") { excluded++; continue; }
    if (o.status === "scheduled" || o.status === "awaiting_confirmation" || o.status === "started") { unknown++; continue; }
    den++;
    ev[o.evidence]++;
    if (o.status === "completed") num += 1;
    else if (o.status === "completed_late") num += policy.lateCredit;
  }
  return metric(policy, {
    key, label, numerator: num, denominator: den, unknown, excluded, evidence: ev,
    eligible: `Past scheduled ${kinds.join("/")} occurrences with a recorded outcome.`,
    exclusions: "Excused and rescheduled occurrences are excluded (the original stays on record). No answer = awaiting confirmation, not counted. Late = half credit.",
    source: "activity_occurrences",
  });
}

function taskMetric(policy: Policy, i: ScoringInput): Metric {
  const list = i.tasks.filter((t) => inRange(t.date, i.from, i.to));
  let num = 0, den = 0, unknown = 0, excluded = 0;
  const ev = emptyMix();
  for (const t of list) {
    if (t.status === "cancelled") { excluded++; continue; }
    if (t.status === "pending") { if (t.date! < i.today) unknown++; continue; }
    den++;
    ev[evidenceOf(t.verification)]++;
    if (t.status === "done") {
      const deadline = t.original_due_at ?? t.due_at;
      const late = !!(deadline && t.completed_at && Date.parse(t.completed_at) > Date.parse(deadline) + 5 * 60_000);
      num += late ? policy.lateCredit : 1;
    }
  }
  return metric(policy, {
    key: "tasks_completed", label: "Tasks completed", numerator: num, denominator: den, unknown, excluded, evidence: ev,
    eligible: "Tasks scheduled in the period marked done or not done.",
    exclusions: "Cancelled tasks excluded. Open tasks from past days are unknown and not counted. Done after the original deadline = half credit.",
    source: "tasks",
  });
}

function habitMetric(policy: Policy, i: ScoringInput, areaFilter: (a: string) => boolean, key: string, label: string): Metric {
  const days = elapsedDays(i);
  const habits = i.habits.filter((h) => h.active && areaFilter(h.area));
  let num = 0, den = 0;
  for (const h of habits) {
    const activeDays = days.filter((d) => d >= h.created.slice(0, 10));
    if (!activeDays.length) continue;
    const rest = i.habitLogs.filter((l) => l.habit_id === h.id && l.status === "rest" && activeDays.includes(l.date)).length;
    const target = Math.max(0, Math.round(((activeDays.length - rest) * h.target_per_week) / 7));
    const done = i.habitLogs.filter((l) => l.habit_id === h.id && l.status === "done" && activeDays.includes(l.date)).length;
    den += target;
    num += Math.min(done, target);
  }
  return metric(policy, {
    key, label, numerator: num, denominator: den, unknown: 0, excluded: 0, evidence: { ...emptyMix(), self_reported: num },
    eligible: "Expected habit completions: weekly target prorated over the days each habit was active, minus logged rest days.",
    exclusions: "Planned rest days are excluded. Completions above target are capped.",
    source: "habits, habit_logs",
  });
}

/* --------------------------------- domains -------------------------------- */

function domain(policy: Policy, key: DomainKey, metrics: Metric[], reasonIfEmpty: string): DomainScore {
  const ok = metrics.filter((m) => m.status === "ok");
  const num = ok.reduce((n, m) => n + m.numerator, 0);
  const den = ok.reduce((n, m) => n + m.denominator, 0);
  const scored = ok.length > 0 && den > 0;
  const allDen = metrics.reduce((n, m) => n + m.denominator, 0);
  return {
    key, label: DOMAIN_LABEL[key], weight: policy.weights[key], metrics,
    numerator: num, denominator: den,
    score: scored ? Math.round((num / den) * 100) : null,
    status: scored ? "ok" : "insufficient",
    reason: scored ? null : allDen === 0 ? reasonIfEmpty : `Fewer than ${policy.minEvents} eligible events in this period.`,
  };
}

export function computeScores(i: ScoringInput, policy: Policy = POLICY_V1): ScoreReport {
  const days = elapsedDays(i);
  const isFitnessArea = (a: string) => a === "fitness" || a === "wellness";

  // Reliability
  const reliability = domain(policy, "reliability", [
    commitmentMetric(policy, i, () => true, "commitments_on_time", "Commitments kept on time"),
    occurrenceMetric(policy, i, ["appointment", "call", "obligation", "deadline"], "appointments_kept", "Appointments, calls and deadlines kept"),
    taskMetric(policy, i),
  ], "No commitments, appointments or tasks with recorded outcomes.");

  // Discipline & attention
  const focus = i.focus.filter((f) => inRange(f.date, i.from, i.to) && f.status !== "active");
  const imp = i.impulses.filter((x) => inRange(x.date, i.from, i.to));
  const impResolved = imp.filter((x) => x.outcome && x.outcome !== "unsure");
  const discipline = domain(policy, "discipline", [
    metric(policy, {
      key: "focus_completion", label: "Focus sessions completed", numerator: focus.filter((f) => f.status === "completed").length, denominator: focus.length,
      unknown: 0, excluded: 0, evidence: { ...emptyMix(), confirmed: focus.length }, source: "focus_sessions",
      eligible: "Focus sessions started in the period and ended (completed or stopped).",
      exclusions: "Sessions still running are excluded.",
    }),
    metric(policy, {
      key: "urges_resisted", label: "Urges resisted", numerator: impResolved.reduce((n, x) => n + (x.outcome === "resisted" ? 1 : x.outcome === "partly" ? policy.partialCredit : 0), 0), denominator: impResolved.length,
      unknown: imp.length - impResolved.length, excluded: 0, evidence: { ...emptyMix(), self_reported: impResolved.length }, source: "impulse_logs",
      eligible: "Logged urges with a recorded outcome.",
      exclusions: "Urges without an outcome, or marked unsure, are unknown and not counted. Partly resisted = half credit.",
    }),
    habitMetric(policy, i, (a) => !isFitnessArea(a) && a !== "learning" && a !== "spiritual", "habit_consistency", "Habit consistency"),
  ], "No focus sessions, urges or habits recorded.");

  // Fitness
  const workoutsLogged = i.workouts.filter((w) => inRange(w.date, i.from, i.to)).length;
  const weeks = days.length / 7;
  const workoutTarget = i.workoutTargetPerWeek ? Math.round(i.workoutTargetPerWeek * weeks) : 0;
  const fitness = domain(policy, "fitness", [
    occurrenceMetric(policy, i, ["workout"], "workouts_completed", "Scheduled workouts completed"),
    metric(policy, {
      key: "workout_frequency", label: "Training frequency vs. weekly target", numerator: Math.min(workoutsLogged, workoutTarget), denominator: workoutTarget,
      unknown: 0, excluded: 0, evidence: { ...emptyMix(), self_reported: workoutsLogged }, source: "workout_logs, user_preferences",
      eligible: "Logged workouts (scheduled or not) against your weekly target, prorated to the period.",
      exclusions: "Only measured when a weekly target is set. Workouts above target are capped.",
    }),
    habitMetric(policy, i, isFitnessArea, "fitness_habits", "Fitness habits"),
  ], "No scheduled workouts, workout target or fitness habits.");

  // Planning & execution
  const morning = new Set(i.checkins.filter((c) => c.kind === "morning" && c.status === "completed").map((c) => c.date));
  const planDays = days.filter((d) => d < i.today || morning.has(d));
  const resolvedTasks = i.tasks.filter((t) => inRange(t.date, i.from, i.to) && (t.status === "done" || t.status === "missed"));
  const firstDay = resolvedTasks.filter((t) => t.status === "done" && t.postponed_count === 0 && (!t.original_scheduled_for || t.original_scheduled_for === t.date)).length;
  const planning = domain(policy, "planning", [
    metric(policy, {
      key: "days_planned", label: "Days planned in the morning", numerator: planDays.filter((d) => morning.has(d)).length, denominator: planDays.length,
      unknown: 0, excluded: 0, evidence: { ...emptyMix(), confirmed: planDays.filter((d) => morning.has(d)).length }, source: "accountability_sessions",
      eligible: "Each finished day in the period (today counts once planned).",
      exclusions: "Future days excluded.",
    }),
    metric(policy, {
      key: "executed_as_planned", label: "Tasks done on the day planned", numerator: firstDay, denominator: resolvedTasks.length,
      unknown: 0, excluded: 0, evidence: { ...emptyMix(), self_reported: resolvedTasks.length }, source: "tasks",
      eligible: "Tasks marked done or not done.",
      exclusions: "Done after being postponed counts as not executed as planned (it still counts as done under Reliability).",
    }),
  ], "No planning days or resolved tasks.");

  // Self-awareness
  const evening = new Set(i.checkins.filter((c) => c.kind === "evening" && c.status === "completed").map((c) => c.date));
  const closedDays = days.filter((d) => d < i.today || evening.has(d));
  const journal = new Set(i.journalDates);
  const chunks: { size: number; wrote: boolean }[] = [];
  days.forEach((d, idx) => {
    const c = Math.floor(idx / 7);
    chunks[c] ??= { size: 0, wrote: false };
    chunks[c].size++;
    if (journal.has(d)) chunks[c].wrote = true;
  });
  const eligibleWeeks = chunks.filter((c) => c.size === 7 || c.wrote);
  const self_awareness = domain(policy, "self_awareness", [
    metric(policy, {
      key: "evening_reviews", label: "Evening reviews completed", numerator: closedDays.filter((d) => evening.has(d)).length, denominator: closedDays.length,
      unknown: 0, excluded: 0, evidence: { ...emptyMix(), confirmed: closedDays.filter((d) => evening.has(d)).length }, source: "accountability_sessions",
      eligible: "Each finished day in the period.",
      exclusions: "Today counts only once reviewed.",
    }),
    metric(policy, {
      key: "reflection_weeks", label: "Weeks with written reflection", numerator: eligibleWeeks.filter((c) => c.wrote).length, denominator: eligibleWeeks.length,
      unknown: 0, excluded: 0, evidence: { ...emptyMix(), confirmed: eligibleWeeks.filter((c) => c.wrote).length }, source: "journal_entries",
      eligible: "Complete weeks in the period (the current partial week counts once it has an entry).",
      exclusions: "None.",
    }),
  ], "No finished days in the period.");

  // Communication
  const honest = i.answers.filter((a) => a.key === "honest_communication" && inRange(a.date, i.from, i.to));
  const communication = domain(policy, "communication", [
    commitmentMetric(policy, i, (c) => !!c.made_to && c.made_to !== "self", "promises_to_others", "Promises to other people kept on time"),
    metric(policy, {
      key: "honesty_reflection", label: "Honest-communication reflection answered", numerator: honest.filter((a) => !a.skipped).length, denominator: honest.length,
      unknown: 0, excluded: 0, evidence: { ...emptyMix(), self_reported: honest.length }, source: "accountability_answers",
      eligible: "Evening reviews that asked about honest communication.",
      exclusions: "Measures that you examined it, not a judgment of your honesty.",
    }),
  ], "No promises to others and no evening reviews.");

  // Learning & reasoning
  const learning = domain(policy, "learning", [
    habitMetric(policy, i, (a) => a === "learning", "learning_habits", "Learning habits"),
  ], "No learning habits yet. Add a habit in the Learning & reasoning area to measure this.");

  const domains = [reliability, discipline, fitness, planning, self_awareness, communication, learning];
  const scored = domains.filter((d) => d.score !== null);
  const coverageWeight = scored.reduce((n, d) => n + d.weight, 0);
  const overall = coverageWeight >= policy.minCoverageForOverall
    ? Math.round(scored.reduce((n, d) => n + d.weight * d.score!, 0) / coverageWeight)
    : null;
  return {
    policyVersion: policy.version,
    from: i.from, to: i.to,
    overall,
    overallStatus: overall === null ? "insufficient" : "ok",
    coverageWeight: Math.round(coverageWeight * 100) / 100,
    domains,
    excluded: domains.filter((d) => d.score === null).map((d) => ({ key: d.key, label: d.label, reason: d.reason ?? "Insufficient data" })),
  };
}

/* ---------------------------- commitment integrity --------------------------- */

export interface IntegrityBreakdown {
  eligible: number; onTime: number; late: number; missed: number; rescheduled: number; excused: number; awaiting: number; unknown: number;
  onTimeRate: number | null;
}

/** Counts for the Commitment Integrity card. Original deadlines are preserved. */
export function commitmentIntegrity(list: CommitmentRec[], from: string, to: string, today: string, now: Date, policy: Policy = POLICY_V1): IntegrityBreakdown {
  const b: IntegrityBreakdown = { eligible: 0, onTime: 0, late: 0, missed: 0, rescheduled: 0, excused: 0, awaiting: 0, unknown: 0, onTimeRate: null };
  for (const c of list.filter((x) => inRange(x.date, from, to))) {
    if ((c.reschedule_count ?? 0) > 0) b.rescheduled++;
    if (c.status === "released") { b.excused++; continue; }
    if (c.status === "open") {
      const due = c.promised_by ? Date.parse(c.promised_by) : null;
      if (c.date < today) b.unknown++;
      else if (due !== null && due < now.getTime()) b.awaiting++;
      continue;
    }
    b.eligible++;
    const deadline = c.original_promised_by ?? c.promised_by;
    const lateVsOriginal = !!(deadline && c.resolved_at && Date.parse(c.resolved_at) > Date.parse(deadline) + 5 * 60_000 && (c.reschedule_count ?? 0) > 0);
    if (c.status === "broken") b.missed++;
    else if (c.status === "kept_late" || lateVsOriginal) b.late++;
    else b.onTime++;
  }
  b.onTimeRate = b.eligible >= policy.minEvents ? b.onTime / b.eligible : null;
  return b;
}

/* ---------------------------------- trends ---------------------------------- */

export type Period = "7d" | "30d" | "90d" | "1y" | "all";
export const PERIODS: { key: Period; label: string; days: number | null }[] = [
  { key: "7d", label: "7D", days: 7 }, { key: "30d", label: "30D", days: 30 }, { key: "90d", label: "90D", days: 90 },
  { key: "1y", label: "1Y", days: 365 }, { key: "all", label: "All", days: null },
];

function shift(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Trend points for a period. Each point is the score of a trailing window
 * ending on that date (7 days for short periods, 30 for long ones). Windows
 * without enough evidence produce null — a gap, never an interpolated value.
 */
export function trend(input: Omit<ScoringInput, "from" | "to">, period: Period, earliest: string, policy: Policy = POLICY_V1) {
  const p = PERIODS.find((x) => x.key === period)!;
  const start = p.days ? shift(input.today, -(p.days - 1)) : earliest < input.today ? earliest : shift(input.today, -6);
  const span = daysBetween(start, input.today).length;
  const window = span <= 30 ? 7 : 30;
  const step = span <= 30 ? 1 : span <= 120 ? 7 : span <= 400 ? 14 : 30;
  const points: { date: string; overall: number | null; coverage: number; domains: Record<DomainKey, number | null> }[] = [];
  for (let k = span - 1; k >= 0; k -= step) {
    const end = shift(input.today, -k);
    const r = computeScores({ ...input, from: shift(end, -(window - 1)), to: end }, policy);
    points.push({ date: end, overall: r.overall, coverage: r.coverageWeight, domains: Object.fromEntries(r.domains.map((d) => [d.key, d.score])) as Record<DomainKey, number | null> });
  }
  if (points.length && points[points.length - 1].date !== input.today) {
    const r = computeScores({ ...input, from: shift(input.today, -(window - 1)), to: input.today }, policy);
    points.push({ date: input.today, overall: r.overall, coverage: r.coverageWeight, domains: Object.fromEntries(r.domains.map((d) => [d.key, d.score])) as Record<DomainKey, number | null> });
  }
  return { start, window, points };
}

/* ------------------------------ daily execution ----------------------------- */

export interface DayExecution { date: string; planned: number; done: number; late: number; missed: number; unknown: number }

/** Planned vs completed per day from tasks, commitments and activity occurrences. */
export function dailyExecution(i: Pick<ScoringInput, "tasks" | "commitments" | "occurrences" | "today">, from: string, to: string): DayExecution[] {
  const days = daysBetween(from, to);
  const map = new Map(days.map((d) => [d, { date: d, planned: 0, done: 0, late: 0, missed: 0, unknown: 0 }]));
  for (const t of i.tasks) {
    const d = t.date && map.get(t.date);
    if (!d || t.status === "cancelled") continue;
    d.planned++;
    if (t.status === "done") d.done++;
    else if (t.status === "missed") d.missed++;
    else if (t.date! < i.today) d.unknown++;
  }
  for (const c of i.commitments) {
    const d = map.get(c.date);
    if (!d || c.status === "released") continue;
    d.planned++;
    if (c.status === "kept") d.done++;
    else if (c.status === "kept_late") { d.done++; d.late++; }
    else if (c.status === "broken") d.missed++;
    else if (c.date < i.today) d.unknown++;
  }
  for (const o of i.occurrences) {
    const d = map.get(o.date);
    if (!d || o.status === "rescheduled" || o.status === "excused") continue;
    d.planned++;
    if (o.status === "completed") d.done++;
    else if (o.status === "completed_late") { d.done++; d.late++; }
    else if (o.status === "skipped" || o.status === "missed") d.missed++;
    else if (o.status === "awaiting_confirmation") d.unknown++;
  }
  return days.map((d) => map.get(d)!);
}
