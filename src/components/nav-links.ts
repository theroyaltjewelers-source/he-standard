import { IconBell, IconFaith, IconJournal, IconMic, IconMoney, IconPlan, IconProgress, IconRhythm, IconSettings, IconToday, IconWord } from "./icons";

/** Mobile tab bar (Coach sits in the middle). */
export const PRIMARY = [
  { href: "/today", label: "Today", Icon: IconToday },
  { href: "/word", label: "My Word", Icon: IconWord },
  { href: "/coach", label: "Coach", Icon: IconMic },
  { href: "/faith", label: "Faith", Icon: IconFaith },
  { href: "/journal", label: "Reflection", Icon: IconJournal },
];
export const SECONDARY = [
  { href: "/rhythm", label: "Rhythm", Icon: IconRhythm },
  { href: "/progress", label: "Progress", Icon: IconProgress },
  { href: "/plan", label: "Calendar", Icon: IconPlan },
  { href: "/money", label: "Money", Icon: IconMoney },
  { href: "/reminders", label: "Reminders", Icon: IconBell },
  { href: "/settings", label: "Settings & data", Icon: IconSettings },
];
export const MORE_LINKS = SECONDARY;
