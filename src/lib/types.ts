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
}

export interface Reminder {
  id: string;
  user_id: string;
  entity_type: "task" | "event" | "commitment" | "checkin" | "custom";
  entity_id: string | null;
  dedupe_key: string | null;
  title: string;
  body: string | null;
  url: string;
  send_at: string;
  respect_quiet_hours: boolean;
  status: "scheduled" | "processing" | "sent" | "partial" | "failed" | "cancelled" | "no_device";
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
  follow_up_question: string | null;
  follow_up_answer: string | null;
  follow_up_source: "rule" | "ai" | null;
}

export interface AiMemory {
  id: string;
  kind: "verified_fact" | "self_report" | "hypothesis";
  content: string;
  source_type: string | null;
  confidence: "low" | "medium" | "high" | null;
  status: "active" | "rejected" | "archived";
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
  { key: "general", label: "General" },
] as const;

export const JOURNAL_TAGS = ["stress", "business", "finances", "faith", "relationships", "habits"] as const;
