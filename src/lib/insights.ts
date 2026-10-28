/**
 * One evidence-based recommendation, chosen deterministically from recorded
 * patterns. Every insight carries the numbers behind it so the user can see
 * exactly why it was generated. No generic motivation.
 */
import { dailyExecution, type ScoreReport, type ScoringInput } from "./scoring";

export interface Insight { title: string; recommendation: string; evidence: string[]; basis: string }

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const dow = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
const shift = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

export function pickInsight(input: Omit<ScoringInput, "from" | "to">, current: ScoreReport, previous: ScoreReport | null): Insight | null {
  const from = shift(input.today, -27);
  const days = dailyExecution(input, from, shift(input.today, -1));
  const resolved = days.map((d) => ({ ...d, resolved: d.done + d.missed }));

  // 1. Weekday weakness
  const byDow = Array.from({ length: 7 }, (_, k) => resolved.filter((d) => dow(d.date) === k).reduce((a, d) => ({ done: a.done + d.done, res: a.res + d.resolved }), { done: 0, res: 0 }));
  const totalRes = byDow.reduce((n, x) => n + x.res, 0);
  const totalDone = byDow.reduce((n, x) => n + x.done, 0);
  let worst: { k: number; rate: number; others: number; done: number; res: number } | null = null;
  for (let k = 0; k < 7; k++) {
    const x = byDow[k];
    if (x.res < 4 || totalRes - x.res < 8) continue;
    const rate = x.done / x.res;
    const others = (totalDone - x.done) / (totalRes - x.res);
    if (others - rate >= 0.2 && (!worst || others - rate > worst.others - worst.rate)) worst = { k, rate, others, done: x.done, res: x.res };
  }
  if (worst) {
    return {
      title: `${WEEKDAY[worst.k]}s are your weakest day`,
      recommendation: `Plan ${WEEKDAY[worst.k]}s lighter: one fewer priority, and schedule the most important one before noon.`,
      evidence: [`${WEEKDAY[worst.k]}s: ${worst.done} of ${worst.res} resolved items done (${Math.round(worst.rate * 100)}%).`, `Other days: ${Math.round(worst.others * 100)}% done.`, "Unknown outcomes are excluded."],
      basis: "Tasks, commitments and scheduled activities over the last 28 days.",
    };
  }

  // 2. Domain decline vs previous period
  if (previous) {
    const drops = current.domains
      .map((d) => ({ d, prev: previous.domains.find((p) => p.key === d.key)! }))
      .filter(({ d, prev }) => d.score !== null && prev.score !== null && prev.score - d.score >= 15)
      .sort((a, b) => (b.prev.score! - b.d.score!) - (a.prev.score! - a.d.score!));
    if (drops.length) {
      const { d, prev } = drops[0];
      const m = d.metrics.filter((x) => x.status === "ok").sort((a, b) => (a.value ?? 1) - (b.value ?? 1))[0];
      return {
        title: `${d.label} slipped from ${prev.score} to ${d.score}`,
        recommendation: m ? `Focus on “${m.label.toLowerCase()}” this week — it's the weakest part (${m.numerator % 1 ? m.numerator.toFixed(1) : m.numerator} of ${m.denominator}).` : `Review what changed in ${d.label.toLowerCase()} this period.`,
        evidence: [`Previous period: ${prev.score} (${prev.denominator} events).`, `This period: ${d.score} (${d.denominator} events).`],
        basis: `Scoring policy ${current.policyVersion}, same-length periods compared.`,
      };
    }
  }

  // 3. Repeated postponement
  const stuck = input.tasks.filter((t) => t.status === "pending" && t.postponed_count >= 3);
  if (stuck.length) {
    return {
      title: `${stuck.length} task${stuck.length > 1 ? "s have" : " has"} been postponed 3+ times`,
      recommendation: "Break the oldest one into a first step under 10 minutes and give it a fixed time today — or decide it isn't happening and release it.",
      evidence: [`Most postponed: ${Math.max(...stuck.map((t) => t.postponed_count))} times.`],
      basis: "Open tasks and their postponement counts.",
    };
  }

  // 4. Workouts
  const workouts = input.occurrences.filter((o) => o.kind === "workout" && o.date >= from && ["completed", "completed_late", "skipped", "missed"].includes(o.status));
  if (workouts.length >= 3) {
    const done = workouts.filter((o) => o.status.startsWith("completed")).length;
    if (done / workouts.length < 0.6) {
      const hours = workouts.map((o) => ({ h: new Date(o.start).getUTCHours(), ok: o.status.startsWith("completed") }));
      return {
        title: `Workouts: ${done} of ${workouts.length} scheduled sessions completed`,
        recommendation: "Move training to the time slot you've actually kept most often, and set accountability to Standard so you get a \"did you start?\" check.",
        evidence: [`${workouts.length - done} skipped or missed in 28 days.`, `${hours.filter((h) => h.ok).length} kept sessions recorded.`],
        basis: "Scheduled workout occurrences with recorded outcomes.",
      };
    }
  }

  // 5. Evening reviews
  const evening = current.domains.find((d) => d.key === "self_awareness")?.metrics.find((m) => m.key === "evening_reviews");
  if (evening && evening.status === "ok" && (evening.value ?? 1) < 0.5) {
    return {
      title: `Evening reviews: ${evening.numerator} of ${evening.denominator} days`,
      recommendation: "Move the evening review 30 minutes earlier, before your energy drops, and keep it to the required questions.",
      evidence: [`${evening.denominator - evening.numerator} days without a review this period.`],
      basis: "Completed evening check-ins per finished day.",
    };
  }
  return null;
}
