/**
 * Resolving spoken references ("my workout", "the financial review") to records.
 * Deterministic and explainable: token overlap with light stemming and synonyms.
 */

const STOP = new Set(["the", "a", "an", "my", "to", "of", "for", "and", "on", "in", "at", "with", "it", "this", "that", "task", "commitment", "today", "tomorrow"]);
const SYN: Record<string, string> = {
  gym: "workout", exercise: "workout", training: "workout", run: "workout", lift: "workout",
  finances: "finance", financial: "finance", money: "finance", budget: "finance",
  call: "call", phone: "call", ring: "call",
  meeting: "meeting", meet: "meeting", appointment: "meeting",
  email: "email", mail: "email",
};

export function normalize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
    .map((w) => w.replace(/(ing|ed|es|s)$/, (m) => (w.length > 4 ? "" : m)))
    .map((w) => SYN[w] ?? w);
}

export interface Candidate<T> { item: T; score: number }

export function rank<T>(query: string, items: T[], text: (t: T) => string): Candidate<T>[] {
  const q = normalize(query);
  if (!q.length) return [];
  return items
    .map((item) => {
      const words = new Set(normalize(text(item)));
      const hits = q.filter((w) => words.has(w) || [...words].some((x) => x.startsWith(w) || w.startsWith(x))).length;
      return { item, score: hits / q.length };
    })
    .filter((c) => c.score >= 0.5)
    .sort((a, b) => b.score - a.score);
}

/** One clear match, several plausible ones (ask the user), or none. */
export function resolve<T>(query: string, items: T[], text: (t: T) => string):
  | { kind: "one"; item: T }
  | { kind: "many"; items: T[] }
  | { kind: "none" } {
  const r = rank(query, items, text);
  if (!r.length) return { kind: "none" };
  const top = r.filter((c) => c.score === r[0].score);
  if (top.length === 1) return { kind: "one", item: top[0].item };
  return { kind: "many", items: top.map((c) => c.item).slice(0, 5) };
}
