import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";

/**
 * Server-only Claude access. The API key is read from the server environment
 * and is never sent to the browser. Every call site must check the user's
 * `ai_analysis_consent` first; `aiAvailable` is only about configuration.
 */
export function aiAvailable(): boolean {
  return !!env.anthropicKey();
}

let client: Anthropic | null = null;
function getClient() {
  if (!client) client = new Anthropic({ apiKey: env.anthropicKey()!, timeout: 10_000, maxRetries: 1 });
  return client;
}

const COACH_SYSTEM = `You are the accountability coach inside a private app called The Standard.
Your job in this call: the user gave an answer during their daily accountability check-in that is too vague to learn from.
Write ONE short follow-up question (under 30 words) that asks for specifics.
Rules:
- Respectful and direct. Never shame, lecture, moralise, or imply the user is lying.
- Ask about observable specifics: what happened, when, what they did instead, what came right before.
- Do not diagnose, label personality, or speculate about causes.
- No preamble, no quotation marks, no emoji. Output only the question.`;

export async function aiFollowUpQuestion(args: {
  question: string;
  answer: string;
  context?: string;
}): Promise<string | null> {
  if (!aiAvailable()) return null;
  try {
    const res = await getClient().messages.create({
      model: env.anthropicModel(),
      max_tokens: 120,
      system: COACH_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Check-in question: ${args.question}\nUser's answer: ${args.answer}${args.context ? `\nContext: ${args.context}` : ""}`,
        },
      ],
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .trim()
      .replace(/^["“]|["”]$/g, "");
    return text && text.length < 300 ? text : null;
  } catch {
    return null; // fall back to the rule-based follow-up
  }
}
