import type { SVGProps } from "react";

const base = (p: SVGProps<SVGSVGElement>) => ({
  width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, ...p,
});

export const IconToday = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><rect x="4" y="4" width="16" height="16" /><path d="M4 11h16" /></svg>);
export const IconPlan = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><rect x="3.5" y="5" width="17" height="15" rx="1.5" /><path d="M3.5 9.5h17M8 3v4M16 3v4" /></svg>);
export const IconCheckin = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M5 12.5l4 4 10-10" /></svg>);
export const IconJournal = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M6 3.5h11a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6z" /><path d="M9 8h6M9 11.5h6" /></svg>);
export const IconMore = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M4 7h16M4 12h16M4 17h10" /></svg>);
export const IconGoal = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.5" /></svg>);
export const IconTasks = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M9 6.5h11M9 12h11M9 17.5h11" /><path d="M4 6.5l1 1 2-2M4 12l1 1 2-2M4 17.5l1 1 2-2" /></svg>);
export const IconSettings = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></svg>);
export const IconBell = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5h4" /></svg>);
export const IconPlus = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>);
export const IconArrowLeft = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M15 5l-7 7 7 7" /></svg>);
export const IconMic = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><rect x="9" y="3.5" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" /></svg>);
export const IconWord = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M5 4.5h14v11H9l-4 4z" /><path d="M9 9h6M9 12h4" /></svg>);
export const IconFaith = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M6 20.5V11a6 6 0 0 1 12 0v9.5" /><path d="M4 20.5h16M12 3v2" /></svg>);
export const IconRhythm = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M3 12h4l2-5 4 10 2-5h6" /></svg>);
export const IconProgress = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M4 19.5h16" /><path d="M5 16l5-5 3 3 6-7" /></svg>);
export const IconMoney = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><rect x="3" y="6.5" width="18" height="11" rx="1.5" /><circle cx="12" cy="12" r="2.5" /></svg>);
export const IconStop = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><rect x="7" y="7" width="10" height="10" rx="1" /></svg>);
export const IconSpeaker = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M4 9.5h3l5-4v13l-5-4H4z" /><path d="M16 9a4 4 0 0 1 0 6" /></svg>);
