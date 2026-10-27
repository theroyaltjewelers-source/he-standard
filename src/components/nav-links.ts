import { IconBell, IconCheckin, IconGoal, IconJournal, IconPlan, IconSettings, IconTasks, IconToday } from "./icons";

export const PRIMARY = [
  { href: "/today", label: "Today", Icon: IconToday },
  { href: "/plan", label: "Plan", Icon: IconPlan },
  { href: "/checkin", label: "Check-in", Icon: IconCheckin },
  { href: "/journal", label: "Journal", Icon: IconJournal },
];
export const SECONDARY = [
  { href: "/tasks", label: "Tasks", Icon: IconTasks },
  { href: "/goals", label: "Goals & habits", Icon: IconGoal },
  { href: "/reminders", label: "Reminders", Icon: IconBell },
  { href: "/settings", label: "Settings & data", Icon: IconSettings },
];

export const MORE_LINKS = SECONDARY;
