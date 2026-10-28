/**
 * Reminder policy: notification categories, per-category settings, reminder
 * intensity, follow-ups for unfinished items, and escalation.
 *
 * Escalation is deliberately the opposite of nagging: once several reminders
 * for the same item have gone unanswered, the system stops sending more and
 * sends a single message offering to adjust the plan instead.
 */

export const CATEGORIES = [
  { key: "prayer", label: "Prayer", desc: "Prayer times and follow-ups until you confirm" },
  { key: "appointments", label: "Appointments", desc: "Preparation, departure and start times" },
  { key: "fitness", label: "Workouts", desc: "Start reminders and \"did you train?\" check-ins" },
  { key: "commitments", label: "Commitments & tasks", desc: "Promised times and deadlines" },
  { key: "accountability", label: "Daily check-ins", desc: "Morning, midday and evening" },
  { key: "habits", label: "Habits", desc: "Habit prompts you schedule" },
  { key: "goals", label: "Goals", desc: "Milestone and progress prompts" },
  { key: "finance", label: "Financial reviews", desc: "Bills due and money reviews" },
  { key: "weekly_review", label: "Weekly review", desc: "When your weekly report is ready" },
  { key: "quran", label: "Quranic reflections", desc: "A verse at a chosen time of day" },
  { key: "coaching", label: "Coaching", desc: "Pattern-based suggestions from your records" },
] as const;
export type Category = (typeof CATEGORIES)[number]["key"];

export interface CategorySetting {
  enabled: boolean;
  /** Deliver even during quiet hours (explicit opt-in). */
  quiet_override: boolean;
}

export const DEFAULT_CATEGORY: Record<Category, CategorySetting> = {
  prayer: { enabled: true, quiet_override: true },
  appointments: { enabled: true, quiet_override: true },
  fitness: { enabled: true, quiet_override: false },
  commitments: { enabled: true, quiet_override: false },
  accountability: { enabled: true, quiet_override: false },
  habits: { enabled: true, quiet_override: false },
  goals: { enabled: true, quiet_override: false },
  finance: { enabled: true, quiet_override: false },
  weekly_review: { enabled: true, quiet_override: false },
  quran: { enabled: true, quiet_override: false },
  coaching: { enabled: true, quiet_override: false },
};

/** Default priority per category: 1 = critical (bypasses the daily budget), 2 = normal, 3 = low. */
export const CATEGORY_PRIORITY: Record<string, 1 | 2 | 3> = {
  prayer: 1, appointments: 2, fitness: 2, commitments: 2, accountability: 2, finance: 2,
  habits: 3, goals: 3, weekly_review: 3, quran: 3, coaching: 3, system: 1,
};
export const PRIORITY_LABEL: Record<number, string> = { 1: "Critical", 2: "Normal", 3: "Low" };

/**
 * Daily budget: critical reminders always go out; normal and low ones stop
 * once the budget is used (they stay visible in notification history).
 */
export function budgetDecision(priority: number, sentToday: number, budget: number | null | undefined): "send" | "hold" {
  if (!budget || priority <= 1) return "send";
  return sentToday >= budget ? "hold" : "send";
}

/** Temporary pause: everything waits except prayer (when the user keeps prayer on). */
export function pauseDecision(category: string, pausedUntil: string | null | undefined, keepsPrayer: boolean, now: Date): "send" | "hold" {
  if (!pausedUntil || Date.parse(pausedUntil) <= now.getTime()) return "send";
  if (category === "prayer" && keepsPrayer) return "send";
  if (category === "system") return "send";
  return "hold";
}

export function categorySetting(prefs: Record<string, Partial<CategorySetting>> | null | undefined, c: Category): CategorySetting {
  // Unknown/internal categories (e.g. "system" notices) are always on.
  return { ...(DEFAULT_CATEGORY[c] ?? { enabled: true, quiet_override: false }), ...(prefs?.[c] ?? {}) };
}

export type Intensity = "gentle" | "balanced" | "firm" | "custom";

export const INTENSITY_LABEL: Record<Intensity, { label: string; desc: string }> = {
  gentle: { label: "Gentle", desc: "One reminder. One follow-up an hour later if it's still open." },
  balanced: { label: "Balanced", desc: "Follow-ups at 30 minutes and 2 hours if it's still open." },
  firm: { label: "Firm", desc: "Follow-ups at 15, 45 and 120 minutes if it's still open." },
  custom: { label: "Custom", desc: "Your own follow-up schedule." },
};

/** Minutes after the original reminder at which follow-ups are sent, while the item stays open. */
export function followUpSchedule(intensity: Intensity, custom: number[] = []): number[] {
  switch (intensity) {
    case "gentle": return [60];
    case "balanced": return [30, 120];
    case "firm": return [15, 45, 120];
    case "custom": return custom.filter((m) => m > 0 && m <= 24 * 60).sort((a, b) => a - b).slice(0, 5);
  }
}

/** After this many unanswered reminders for one item, stop and offer to adjust the plan. */
export const ESCALATE_AFTER_IGNORED = 3;

export interface FollowUpDecision {
  kind: "follow_up" | "offer_adjustment" | "stop";
  /** Minutes after the ORIGINAL reminder. */
  atMinutes?: number;
}

/**
 * Decide what happens after reminder #index (0 = original) for an item that is
 * still open. `ignoredCount` counts reminders for this item that were delivered
 * but not opened or acted on.
 */
export function nextFollowUp(intensity: Intensity, index: number, ignoredCount: number, custom: number[] = []): FollowUpDecision {
  if (ignoredCount >= ESCALATE_AFTER_IGNORED) return { kind: "offer_adjustment" };
  const sched = followUpSchedule(intensity, custom);
  if (index < sched.length) return { kind: "follow_up", atMinutes: sched[index] };
  return { kind: "stop" };
}

export const SNOOZE_MINUTES = 15;

/** Notification action buttons per entity type (shown where the platform supports them). */
export function actionsFor(entityType: string, stage?: string): { action: string; title: string }[] {
  if (entityType === "event" && stage) {
    switch (stage) {
      case "life-start": return [{ action: "start", title: "Start now" }, { action: "late", title: "Running late" }];
      case "life-started": return [{ action: "start", title: "Started" }, { action: "skip", title: "Skip…" }];
      case "life-done": case "life-done-2": return [{ action: "completed", title: "Completed" }, { action: "remind", title: "Remind me" }];
    }
  }
  switch (entityType) {
    case "prayer": return [{ action: "prayed", title: "Prayed" }, { action: "snooze", title: "Remind me" }];
    case "task":
    case "commitment": return [{ action: "done", title: "Done" }, { action: "snooze", title: "Snooze 15 min" }];
    case "event": return [{ action: "open", title: "Open schedule" }];
    default: return [];
  }
}
