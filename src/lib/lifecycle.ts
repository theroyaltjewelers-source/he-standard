/**
 * Accountability lifecycle for scheduled activities (pure, testable).
 *
 * Example: gym at 7:00 AM, 60 minutes, standard accountability
 *   6:30  Start preparing          (from the event's prep time, if set)
 *   7:00  "Time to train: Gym"      → Start now · Running late
 *   7:10  "Did you start Gym?"      → Started · Skip…          (only if no answer yet)
 *   8:05  "Did you complete Gym?"   → Completed · Remind me    (only if not completed)
 *   9:05  one more check (strict only)
 * After that, no more reminders: an unanswered occurrence is recorded as
 * "awaiting confirmation" — never as completed, never as missed.
 */
import type { AccountabilityLevel, ActivityKind, OccurrenceStatus } from "./types";
import { localTimeString } from "./time";

export interface LifecycleReminder {
  stage: "life-start" | "life-started" | "life-done" | "life-done-2";
  sendAt: Date;
  title: string;
  body: string;
  respectQuietHours: boolean;
}

const VERB: Record<string, { start: string; did: string; done: string }> = {
  workout: { start: "Time to train", did: "Did you start", done: "Did you complete" },
  call: { start: "Call now", did: "Did you make the call:", done: "How did it go —" },
  deadline: { start: "Deadline now", did: "Did you start", done: "Did you deliver" },
  routine: { start: "Time for", did: "Did you start", done: "Did you finish" },
  focus_block: { start: "Focus block:", did: "Did you start", done: "Did you finish" },
  appointment: { start: "Starting now:", did: "Did you make it to", done: "Did it happen —" },
  obligation: { start: "Now:", did: "Did you start", done: "Did you finish" },
};

export function lifecycleReminders(args: {
  title: string; kind: ActivityKind; level: AccountabilityLevel; start: Date; end: Date | null; timeZone: string; now?: Date;
}): LifecycleReminder[] {
  const now = args.now ?? new Date();
  if (args.level === "off") return [];
  const v = VERB[args.kind] ?? VERB.appointment;
  const end = args.end ?? new Date(args.start.getTime() + 60 * 60_000);
  const at = localTimeString(args.start, args.timeZone);
  const out: LifecycleReminder[] = [];
  out.push({ stage: "life-start", sendAt: args.start, title: `${v.start} ${args.title}`.replace(/\s+/g, " "), body: `Scheduled for ${at}. Tap Start now when you begin.`, respectQuietHours: false });
  if (args.level === "standard" || args.level === "strict") {
    out.push({ stage: "life-started", sendAt: new Date(args.start.getTime() + 10 * 60_000), title: `${v.did} ${args.title}?`, body: "Start now, or tell me it's not happening — no answer is recorded as awaiting confirmation, not missed.", respectQuietHours: false });
  }
  out.push({ stage: "life-done", sendAt: new Date(end.getTime() + 5 * 60_000), title: `${v.done} ${args.title}?`, body: "Tap Completed, or open it to record what happened.", respectQuietHours: true });
  if (args.level === "strict") {
    out.push({ stage: "life-done-2", sendAt: new Date(end.getTime() + 65 * 60_000), title: `Still open: ${args.title}`, body: "Record the outcome so your record stays accurate. This is the last reminder.", respectQuietHours: true });
  }
  return out.filter((r) => r.sendAt.getTime() > now.getTime());
}

/** Whether a lifecycle reminder still makes sense given what the user already recorded. */
export function lifecycleRelevant(stage: string, status: OccurrenceStatus | null | undefined): boolean {
  if (!status || status === "scheduled" || status === "awaiting_confirmation") return true;
  if (status === "started") return stage.startsWith("life-done");
  return false; // completed, completed_late, skipped, rescheduled, excused, missed
}

/** How a completion is classified: late when the start slipped more than 15 minutes. */
export function completionStatus(args: { scheduledStart: Date; startedAt: Date | null; delayMinutes: number | null }): "completed" | "completed_late" {
  const delay = args.startedAt ? (args.startedAt.getTime() - args.scheduledStart.getTime()) / 60_000 : args.delayMinutes ?? 0;
  return delay > 15 ? "completed_late" : "completed";
}

/** Parse a lifecycle reminder dedupe key: event:<eventId>:<occurrenceISO>:<stage>[...] */
export function parseLifecycleKey(key: string | null | undefined): { eventId: string; occurrence: string; stage: string } | null {
  if (!key || !key.startsWith("event:")) return null;
  const m = key.match(/^event:([0-9a-f-]{36}):(\d{4}-\d{2}-\d{2}T[\d:.]+Z):(life-[a-z0-9-]+)/);
  return m ? { eventId: m[1], occurrence: m[2], stage: m[3] } : null;
}
