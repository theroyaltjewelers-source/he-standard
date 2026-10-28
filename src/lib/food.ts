/**
 * Food log rules (pure, shared by the form and the server action).
 *
 * Time-zone policy: a meal is entered as a local date + time in the user's
 * profile time zone. We store the instant (`eaten_at`) AND the local date and
 * zone it was logged in. Days are grouped by the stored `local_date`, never by
 * UTC date and never by re-converting with the current zone, so changing time
 * zones (travel, DST) never moves a past meal to a different day.
 */
import { zonedToUtc, localDateString, localTimeString, shiftDate } from "./time";

export const FOOD_LIMITS = { description: 500, portion: 100, notes: 1000 } as const;
export const MEALS = [
  { key: "breakfast", label: "Breakfast" },
  { key: "lunch", label: "Lunch" },
  { key: "dinner", label: "Dinner" },
  { key: "snack", label: "Snack" },
] as const;
export type MealKey = (typeof MEALS)[number]["key"];
export const MEAL_LABEL: Record<MealKey, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack" };

export interface FoodInput { description: string; date: string; time: string; meal?: string | null; portion?: string | null; notes?: string | null }
export interface FoodValues { description: string; eaten_at: string; local_date: string; meal: MealKey | null; portion: string | null; notes: string | null }
export type FieldErrors = Partial<Record<"description" | "date" | "time" | "meal" | "portion" | "notes", string>>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const validDate = (d: string) => DATE.test(d) && new Date(`${d}T12:00:00Z`).toISOString().slice(0, 10) === d;

/** Validate and normalise a food entry. `now` is injectable for tests. */
export function validateFood(input: FoodInput, timeZone: string, now: Date = new Date()): { ok: true; values: FoodValues } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const description = (input.description ?? "").trim();
  const portion = (input.portion ?? "").trim();
  const notes = (input.notes ?? "").trim();
  const meal = (input.meal ?? "").trim();
  if (!description) errors.description = "Describe what you ate.";
  else if (description.length > FOOD_LIMITS.description) errors.description = `Keep it under ${FOOD_LIMITS.description} characters (now ${description.length}).`;
  if (portion.length > FOOD_LIMITS.portion) errors.portion = `Keep the portion under ${FOOD_LIMITS.portion} characters.`;
  if (notes.length > FOOD_LIMITS.notes) errors.notes = `Keep notes under ${FOOD_LIMITS.notes} characters (now ${notes.length}).`;
  if (meal && !MEALS.some((m) => m.key === meal)) errors.meal = "Choose breakfast, lunch, dinner or snack.";
  if (!validDate(input.date ?? "")) errors.date = "Choose a valid date.";
  if (!TIME.test(input.time ?? "")) errors.time = "Choose a valid time.";
  let eaten: Date | null = null;
  if (!errors.date && !errors.time) {
    eaten = zonedToUtc(input.date, input.time, timeZone);
    if (Number.isNaN(eaten.getTime())) errors.time = "Choose a valid time.";
    // Small allowance for clock drift between device and server.
    else if (eaten.getTime() > now.getTime() + 60_000) errors.time = "That time hasn't happened yet. Log food after you've eaten it.";
  }
  if (Object.keys(errors).length || !eaten) return { ok: false, errors };
  return {
    ok: true,
    values: {
      description, eaten_at: eaten.toISOString(),
      // The date the user chose is the day it belongs to — even if a DST gap
      // shifted the wall-clock time (e.g. 2:30 on a spring-forward night).
      local_date: input.date,
      meal: (meal || null) as MealKey | null, portion: portion || null, notes: notes || null,
    },
  };
}

/** Defaults for a new entry: the chosen day (never a future day) at the current local time. */
export function newEntryDefaults(date: string, timeZone: string, now: Date = new Date()): { date: string; time: string } {
  const today = localDateString(now, timeZone);
  return { date: date > today ? today : date, time: localTimeString(now, timeZone) };
}

/** "Today", "Yesterday", or a short date. */
export function dayLabel(date: string, today: string, long = false): string {
  if (date === today) return "Today";
  if (date === shiftDate(today, -1)) return "Yesterday";
  const d = new Date(`${date}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { timeZone: "UTC", weekday: long ? "long" : "short", month: long ? "long" : "short", day: "numeric", ...(date.slice(0, 4) !== today.slice(0, 4) ? { year: "numeric" } : {}) });
}
