/**
 * Daily accountability interview definitions and answer-quality checks.
 */

export interface Question {
  key: string;
  text: string;
  hint?: string;
  /** Important questions require a substantive written answer. */
  required: boolean;
  minWords: number;
}

export const MORNING_QUESTIONS: Question[] = [
  // The three commitments + times are collected as structured fields, not free text.
  { key: "obstacles", text: "What obstacles could prevent you from succeeding today?", hint: "Name them specifically — a person, a time of day, a feeling, a device.", required: true, minWords: 5 },
  { key: "contingency", text: "What will you do if those obstacles appear?", hint: "If ___ happens, I will ___.", required: true, minWords: 6 },
  { key: "avoid_behavior", text: "What behavior must you intentionally avoid today?", required: true, minWords: 3 },
  { key: "character_plan", text: "How will you demonstrate honesty, patience, and discipline today?", hint: "One concrete action for each is enough.", required: true, minWords: 8 },
  { key: "spiritual_intention", text: "What is your spiritual intention today?", required: false, minWords: 0 },
];

export const EVENING_QUESTIONS: Question[] = [
  // "What did you promise?" and "What did you actually accomplish?" are answered
  // per commitment/task in the review step. The questions below follow it.
  { key: "evidence", text: "What specific evidence supports what you completed today?", hint: "Something that exists now that did not exist this morning: a sent message, a file, a receipt, a conversation.", required: true, minWords: 6 },
  { key: "failure_trigger", text: "For anything you did not honor: what happened immediately before?", hint: "Where were you, what were you doing, what did you feel? If you honored everything, say so.", required: true, minWords: 6 },
  { key: "discomfort", text: "Did you avoid discomfort or choose immediate gratification today? Where?", required: true, minWords: 4 },
  { key: "honest_communication", text: "Did you communicate honestly with others today?", hint: "Any promise, excuse, or answer you would rephrase?", required: true, minWords: 4 },
  { key: "emotions", text: "How did you handle your emotions?", required: true, minWords: 5 },
  { key: "money", text: "Where did you spend money unnecessarily?", hint: "Amounts if you know them. \"Nowhere\" is a valid answer.", required: true, minWords: 1 },
  { key: "distraction_minutes", text: "How much time did you lose to distractions?", hint: "An estimate in minutes, and what took it.", required: true, minWords: 2 },
  { key: "change_tomorrow", text: "What will you change tomorrow?", hint: "One specific change, not a resolution.", required: true, minWords: 6 },
];

const VAGUE_PATTERNS: { re: RegExp; followUp: string }[] = [
  { re: /\b(i\s+was\s+)?(just\s+)?(busy|swamped|slammed|hectic)\b/i, followUp: "What specifically occupied your time? Walk through the main blocks of the day." },
  { re: /\b(stuff|things)\s+came\s+up\b|\bsomething\s+came\s+up\b/i, followUp: "What exactly came up, and when? What did you choose to do instead?" },
  { re: /\b(didn'?t|did\s+not)\s+have\s+(the\s+)?time\b|\bno\s+time\b|\bran\s+out\s+of\s+time\b/i, followUp: "Where did the time go instead? Name the activities and roughly how long each took." },
  { re: /\bforgot\b/i, followUp: "When did you last think about it, and what were you doing when it slipped? What reminder would have caught it?" },
  { re: /\b(tired|exhausted|not\s+feeling\s+it|wasn'?t\s+motivated|no\s+motivation|lazy)\b/i, followUp: "What did you do instead, and at what time? What made starting feel harder than the alternative?" },
  { re: /^(i\s+don'?t\s+know|idk|not\s+sure|n\/?a|nothing|fine|ok(ay)?|good|same|whatever)\.?$/i, followUp: "Take one more moment: what is one specific example from today?" },
];

const ACCEPTABLE_SHORT = /^(nowhere|none|no(thing)?|zero|0( ?min(utes)?)?|yes)\.?$/i;

export function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

export interface AnswerCheck {
  ok: boolean;
  reason?: "empty" | "too_short" | "vague";
  followUp?: string;
}

/**
 * Deterministic check for whether an answer is specific enough. This runs
 * without AI. When AI coaching is enabled, a vague answer can additionally be
 * given a more tailored follow-up question by Claude.
 */
export function checkAnswer(q: Question, raw: string): AnswerCheck {
  const answer = raw.trim();
  if (!q.required) return { ok: true };
  if (!answer) return { ok: false, reason: "empty", followUp: "This question needs a written answer." };

  // Short honest answers are fine for some questions ("Nowhere", "0").
  if ((q.key === "money" || q.key === "distraction_minutes" || q.key === "honest_communication") && ACCEPTABLE_SHORT.test(answer)) {
    return { ok: true };
  }

  const words = wordCount(answer);
  for (const p of VAGUE_PATTERNS) {
    if (p.re.test(answer) && words < 8) {
      return { ok: false, reason: "vague", followUp: p.followUp };
    }
  }
  if (words < q.minWords) {
    return { ok: false, reason: "too_short", followUp: "Could you be more specific? A sentence or two with a concrete example." };
  }
  return { ok: true };
}
