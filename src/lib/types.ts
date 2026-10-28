import type { Verification } from "./integrity";

export type { Verification };

export interface Profile {
  id: string;
  display_name: string | null;
  timezone: string;
  morning_checkin_time: string;
  evening_checkin_time: string;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  focus_areas: string[];
  challenges: string[];
  hijri_adjustment_days: number;
  location_label: string | null;
  latitude: number | null;
  longitude: number | null;
  prayer_calc_method: string | null;
  ai_analysis_consent: boolean;
  ai_consent_updated_at: string | null;
  onboarding_completed_at: string | null;
  created_at: string;
}

export interface Goal {
  id: string;
  user_id: string;
  parent_goal_id: string | null;
  horizon: "long_term" | "monthly" | "weekly";
  area: string;
  title: string;
  desired_outcome: string;
  success_criteria: string;
  target_date: string | null;
  obstacles: string | null;
  recovery_plan: string | null;
  status: "active" | "paused" | "achieved" | "abandoned";
  created_at: string;
}

export interface GoalProgress {
  id: string;
  goal_id: string;
  progress_pct: number | null;
  note: string;
  evidence: string | null;
  created_at: string;
}

export interface Habit {
  id: string;
  goal_id: string | null;
  title: string;
  area: string;
  target_per_week: number;
  rest_days: number[];
  active: boolean;
}

export interface HabitLog {
  id: string;
  habit_id: string;
  log_date: string;
  status: "done" | "skipped" | "rest";
  note: string | null;
}

export interface Task {
  id: string;
  goal_id: string | null;
  title: string;
  notes: string | null;
  scheduled_for: string | null;
  due_at: string | null;
  priority: number;
  is_top_priority: boolean;
  status: "pending" | "done" | "missed" | "cancelled";
  completed_at: string | null;
  verification: Verification;
  evidence: string | null;
  miss_reason: string | null;
  postponed_count: number;
  original_due_at?: string | null;
  original_scheduled_for?: string | null;
  created_at: string;
}

export interface Commitment {
  id: string;
  task_id: string | null;
  commitment_date: string;
  title: string;
  made_to: string;
  promised_by: string | null;
  obstacles: string | null;
  contingency: string | null;
  source: "manual" | "morning_interview";
  status: "open" | "kept" | "kept_late" | "broken" | "released";
  resolved_at: string | null;
  verification: Verification;
  evidence: string | null;
  failure_context: string | null;
  expected_outcome?: string | null;
  effort_minutes?: number | null;
  first_action?: string | null;
  original_promised_by?: string | null;
  reschedule_count?: number;
}

export interface CalendarEvent {
  id: string;
  title: string;
  location: string | null;
  notes: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  importance: "normal" | "high";
  prep_minutes: number;
  travel_minutes: number;
  reminder_offsets: number[];
  recurrence: "none" | "daily" | "weekly" | "monthly";
  recurrence_until: string | null;
  plan_confirmed_at: string | null;
  external_source?: string | null;
  external_id?: string | null;
  external_etag?: string | null;
  external_updated_at?: string | null;
  sync_status?: "local" | "synced" | "pending_push" | "conflict" | "error";
  sync_error?: string | null;
  updated_at?: string;
  kind?: ActivityKind;
  accountability?: AccountabilityLevel;
  rescheduled_from?: string | null;
}

export type ActivityKind = "appointment" | "workout" | "call" | "deadline" | "routine" | "obligation" | "focus_block";
export type AccountabilityLevel = "off" | "light" | "standard" | "strict";
export const ACTIVITY_KINDS: { key: ActivityKind; label: string; defaultAccountability: AccountabilityLevel }[] = [
  { key: "appointment", label: "Appointment", defaultAccountability: "light" },
  { key: "workout", label: "Workout", defaultAccountability: "standard" },
  { key: "call", label: "Important call", defaultAccountability: "light" },
  { key: "deadline", label: "Deadline", defaultAccountability: "standard" },
  { key: "routine", label: "Personal routine", defaultAccountability: "light" },
  { key: "obligation", label: "Personal obligation", defaultAccountability: "light" },
  { key: "focus_block", label: "Focus block", defaultAccountability: "light" },
];
export const ACCOUNTABILITY_LEVELS: { key: AccountabilityLevel; label: string; desc: string }[] = [
  { key: "off", label: "Off", desc: "Reminders only. No check-in afterwards." },
  { key: "light", label: "Light", desc: "A start reminder and one question afterwards: did it happen?" },
  { key: "standard", label: "Standard", desc: "Prepare → start → \"did you start?\" → \"did you finish?\" with duration." },
  { key: "strict", label: "Strict", desc: "Standard, plus one more follow-up if you haven't answered." },
];

export type OccurrenceStatus = "scheduled" | "started" | "completed" | "completed_late" | "skipped" | "rescheduled" | "excused" | "awaiting_confirmation" | "missed";
export interface ActivityOccurrence {
  id: string;
  event_id: string;
  occurrence_start: string;
  occurrence_end: string | null;
  title: string;
  kind: ActivityKind;
  status: OccurrenceStatus;
  started_at: string | null;
  completed_at: string | null;
  duration_minutes: number | null;
  delay_minutes: number | null;
  skip_reason: string | null;
  notes: string | null;
  rescheduled_to: string | null;
  evidence: "confirmed" | "self_reported" | "imported" | "unverified";
  source: string;
  updated_at: string;
}

export interface WorkoutLog {
  id: string;
  occurrence_id: string | null;
  performed_on: string;
  started_at: string | null;
  duration_minutes: number | null;
  workout_type: "strength" | "cardio" | "mobility" | "sport" | "recovery" | "other";
  intensity: number | null;
  notes: string | null;
  source: string;
}

export interface Reminder {
  id: string;
  user_id: string;
  entity_type: "task" | "event" | "commitment" | "checkin" | "custom" | "prayer" | "habit" | "goal" | "finance" | "weekly_report" | "reflection" | "focus";
  category: string;
  follow_up_of: string | null;
  follow_up_index: number;
  actions: { action: string; title: string }[];
  entity_id: string | null;
  dedupe_key: string | null;
  title: string;
  body: string | null;
  url: string;
  send_at: string;
  respect_quiet_hours: boolean;
  status: "scheduled" | "processing" | "sent" | "partial" | "failed" | "cancelled" | "no_device";
  priority?: number;
  attempts: number;
  last_error: string | null;
  processed_at: string | null;
}

export interface JournalEntry {
  id: string;
  entry_date: string;
  title: string | null;
  body: string;
  mood: number | null;
  energy: number | null;
  tags: string[];
  input_method: "typed" | "voice";
  ai_analysis_allowed: boolean;
  guided_mode?: string;
  created_at: string;
  updated_at: string;
}

export interface DailyPlan {
  id: string;
  plan_date: string;
  intention: string | null;
  avoid_behavior: string | null;
  character_plan: string | null;
  spiritual_intention: string | null;
}

export interface AccountabilitySession {
  id: string;
  session_date: string;
  kind: "morning" | "evening";
  status: "in_progress" | "completed";
  completed_at: string | null;
}

export interface AccountabilityAnswer {
  id: string;
  session_id: string;
  question_key: string;
  question: string;
  answer: string;
  skipped?: boolean;
  follow_up_question: string | null;
  follow_up_answer: string | null;
  follow_up_source: "rule" | "ai" | null;
}

export interface AiMemory {
  id: string;
  category: "preference" | "long_term_goal" | "commitment" | "routine" | "observation" | "difficulty" | "accomplishment" | "reflection" | "hypothesis" | "context";
  evidence_status: "verified" | "self_reported" | "unverified";
  sensitive: boolean;
  kind: "verified_fact" | "self_report" | "hypothesis";
  content: string;
  source_type: string | null;
  confidence: "low" | "medium" | "high" | null;
  status: "proposed" | "active" | "rejected" | "archived";
  user_edited: boolean;
  created_at: string;
  updated_at: string;
}

export const FOCUS_AREAS = [
  { key: "honesty", label: "Radical honesty & integrity" },
  { key: "composure", label: "Emotional regulation & composure" },
  { key: "reasoning", label: "Logical reasoning" },
  { key: "accountability", label: "Personal & professional accountability" },
  { key: "finance", label: "Financial management & impulse control" },
  { key: "attention", label: "Attention & digital discipline" },
  { key: "compulsions", label: "Control over distracting behaviors" },
  { key: "communication", label: "Intentional speech & listening" },
  { key: "reliability", label: "Reliability & punctuality" },
  { key: "spiritual", label: "Spiritual development" },
  { key: "leadership", label: "Leadership & business execution" },
  { key: "self_awareness", label: "Self-awareness & reflection" },
] as const;

export const CHALLENGES = [
  "Forgetfulness", "Distraction", "Overwhelm", "Avoidance", "Inconsistent motivation",
  "Impulsive decisions", "Excessive social media", "Financial disorganization", "Following through",
] as const;

export const GOAL_AREAS = [
  { key: "business", label: "Business execution" },
  { key: "finance", label: "Financial discipline" },
  { key: "wellness", label: "Physical wellness" },
  { key: "communication", label: "Communication" },
  { key: "spiritual", label: "Spiritual practice" },
  { key: "attention", label: "Attention control" },
  { key: "character", label: "Character & integrity" },
  { key: "learning", label: "Learning & reasoning" },
  { key: "fitness", label: "Fitness" },
  { key: "general", label: "General" },
] as const;

export const JOURNAL_TAGS = ["stress", "business", "finances", "faith", "relationships", "habits"] as const;

export interface UserPreferences {
  user_id: string;
  theme: "dark" | "light" | "system";
  reminder_intensity: "gentle" | "balanced" | "firm" | "custom";
  custom_follow_up_minutes: number[];
  categories: Record<string, { enabled?: boolean; quiet_override?: boolean }>;
  voice_replies: boolean;
  haptics: boolean;
  sounds: boolean;
  midday_checkin_time: string | null;
  weekly_report_day: number;
  daily_notification_budget?: number | null;
  paused_until?: string | null;
  pause_keeps_prayer?: boolean;
  workout_target_per_week?: number | null;
}

export interface FocusSession {
  id: string;
  task_id: string | null;
  intention: string | null;
  planned_minutes: number;
  started_at: string;
  ends_at: string;
  ended_at: string | null;
  status: "active" | "completed" | "abandoned";
  distractions: { at: string; note: string }[];
  note: string | null;
}

export interface ImpulseLog {
  id: string;
  kind: "procrastination" | "social_media" | "spending" | "eating" | "romantic_preoccupation" | "anger" | "other";
  feeling: string | null;
  trigger_note: string | null;
  seeking: string | null;
  consequence: string | null;
  alternative: string | null;
  intervention: string | null;
  outcome: "resisted" | "acted" | "partly" | "unsure" | null;
  created_at: string;
}

export interface FinancialEntry {
  id: string;
  entry_date: string;
  kind: "income" | "expense" | "bill" | "debt_payment" | "savings";
  scope: "personal" | "business";
  amount: number;
  category: string | null;
  description: string | null;
  discretionary: boolean;
  due_date: string | null;
  paid: boolean | null;
  reflection: string | null;
}

export interface QuranVerse {
  id: string;
  surah: number;
  ayah: number;
  surah_name: string | null;
  arabic: string;
  translation: string;
  translator: string;
  edition: string;
  topics: string[];
  source_url: string;
}

export interface ToolExecution {
  id: string;
  conversation_id: string | null;
  tool: string;
  input: Record<string, unknown>;
  status: "awaiting_confirmation" | "executed" | "failed" | "rejected" | "undone" | "expired";
  requires_confirmation: boolean;
  confirmation_reason: string | null;
  summary: string | null;
  result: unknown;
  error: string | null;
  undo: unknown;
  created_at: string;
  executed_at: string | null;
}

export const IMPULSE_KINDS = [
  { key: "procrastination", label: "Procrastinate" },
  { key: "social_media", label: "Scroll social media" },
  { key: "spending", label: "Spend money" },
  { key: "eating", label: "Eat impulsively" },
  { key: "romantic_preoccupation", label: "Romantic or sexual preoccupation" },
  { key: "anger", label: "React in anger" },
  { key: "other", label: "Something else" },
] as const;
