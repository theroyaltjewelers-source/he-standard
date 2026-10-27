/** Guided reflection modes. Each is a short sequence of questions; answers are saved together as one entry. */
export const GUIDED_MODES = [
  { key: "free", label: "Free writing", desc: "A blank page.", prompts: [] },
  { key: "evening_examination", label: "Evening examination", desc: "A short honest review of the day.", prompts: [
    "What did I do today that I'm glad I did?",
    "Where did I fall short of what I intended — and what came right before?",
    "Who did I affect today, and how?",
    "What will I do differently tomorrow, specifically?",
  ] },
  { key: "gratitude", label: "Gratitude", desc: "Notice what you have.", prompts: [
    "Three things I'm grateful for today, and why each matters.",
    "Someone who helped me recently, and what I could do for them.",
    "Something difficult that taught me something.",
  ] },
  { key: "decision", label: "Decision", desc: "Think a choice through before you make it.", prompts: [
    "What exactly am I deciding?",
    "What are the realistic options, including doing nothing?",
    "What would each one cost me — in money, time, relationships, integrity?",
    "Which option fits my values and long-term goals best? What makes me hesitate?",
    "What is the next small step, and by when?",
  ] },
  { key: "after_slip", label: "After a slip", desc: "Learn from a missed commitment without self-attack.", prompts: [
    "What did I intend to do, and what actually happened?",
    "Where was I, what was I doing, and what was I feeling just before?",
    "What did the alternative give me in that moment?",
    "What would have made the intended action easier to start?",
    "What will I put in place before the next time?",
  ] },
  { key: "conflict", label: "Frustration or conflict", desc: "Slow down a reaction.", prompts: [
    "What happened, described as a camera would see it?",
    "What did I feel, and what story did I tell myself about it?",
    "What might the other person have been thinking or dealing with?",
    "What response would I respect a week from now?",
  ] },
  { key: "spiritual", label: "Spiritual reflection", desc: "Your relationship with Allah and your practice.", prompts: [
    "How were my prayers today — presence, timing, intention?",
    "What am I asking Allah for right now?",
    "Where did I feel close to my values today, and where far?",
    "One act of worship or kindness I will add tomorrow.",
  ] },
] as const;

export type GuidedMode = (typeof GUIDED_MODES)[number]["key"];

export function composeGuided(mode: GuidedMode, answers: string[], extra: string): string {
  const m = GUIDED_MODES.find((x) => x.key === mode);
  const parts = (m?.prompts ?? []).map((p, i) => (answers[i]?.trim() ? `${p}\n${answers[i].trim()}` : "")).filter(Boolean);
  if (extra.trim()) parts.push(extra.trim());
  return parts.join("\n\n");
}
