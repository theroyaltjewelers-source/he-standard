import Link from "next/link";

/* ------------------------------- Sparkline ------------------------------- */

/** Tiny trend line; nulls are gaps. */
export function Sparkline({ values, color, width = 96, height = 28, label }: { values: (number | null)[]; color: string; width?: number; height?: number; label: string }) {
  const n = values.length;
  const pts = values.map((v, i) => (v === null ? null : [n <= 1 ? width / 2 : (i / (n - 1)) * (width - 4) + 2, 2 + (1 - v / 100) * (height - 4)] as const));
  let d = "";
  pts.forEach((p, i) => { if (!p) return; d += `${i === 0 || !pts[i - 1] ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`; });
  const last = [...pts].reverse().find(Boolean);
  if (!d) return <span className="text-xs text-ivory-faint">no trend yet</span>;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <path d={d} fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      {last && <circle cx={last[0]} cy={last[1]} r="2.5" fill={color} />}
    </svg>
  );
}

/* ------------------------------ Radial gauge ------------------------------ */

export interface GaugeSegment { key: string; label: string; weight: number; score: number | null; color: string }

/**
 * Segmented radial gauge. Each arc's length is the domain's weight; the filled
 * part is its score. Domains without enough evidence are drawn as dashed
 * outlines so the gauge never implies equal evidence coverage.
 */
export function RadialGauge({ segments, center, sub, size = 220 }: { segments: GaugeSegment[]; center: string; sub: string; size?: number }) {
  const r = size / 2 - 14, cx = size / 2, cy = size / 2, sw = 12;
  const start = -210, sweep = 240; // degrees, open at the bottom
  const total = segments.reduce((n, s) => n + s.weight, 0) || 1;
  const gap = 2.2; // degrees (surface gap between segments)
  const pt = (deg: number) => { const a = (deg * Math.PI) / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
  const arc = (a0: number, a1: number) => {
    if (a1 - a0 <= 0.05) return "";
    const [x0, y0] = pt(a0), [x1, y1] = pt(a1);
    return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
  };
  const offsets = segments.map((_, i) => segments.slice(0, i).reduce((n, x) => n + (x.weight / total) * sweep, 0));
  const arcs = segments.map((s, i) => {
    const len = (s.weight / total) * sweep;
    const a0 = start + offsets[i] + gap / 2, a1 = start + offsets[i] + len - gap / 2;
    const fillEnd = s.score === null ? a0 : a0 + ((a1 - a0) * s.score) / 100;
    return { s, track: arc(a0, a1), fill: s.score === null ? "" : arc(a0, fillEnd) };
  });
  const summary = segments.map((s) => `${s.label} ${s.score === null ? "insufficient data" : s.score}`).join(", ");
  return (
    <figure className="relative mx-auto" style={{ width: size, maxWidth: "100%" }}>
      <svg viewBox={`0 0 ${size} ${size * 0.86}`} className="block h-auto w-full" role="img" aria-label={`Development balance: ${summary}`}>
        {arcs.map(({ s, track, fill }) => (
          <g key={s.key}>
            <path d={track} fill="none" stroke={s.score === null ? "var(--color-line-strong)" : "var(--color-surface-3)"} strokeWidth={sw} strokeLinecap="butt" strokeDasharray={s.score === null ? "3 4" : undefined} />
            {fill && <path d={fill} fill="none" stroke={s.color} strokeWidth={sw} strokeLinecap="butt" />}
          </g>
        ))}
      </svg>
      <div className="pointer-events-none absolute inset-x-0 top-[34%] text-center">
        <p className="metric text-5xl">{center}</p>
        <p className="mt-1 text-xs text-ivory-faint">{sub}</p>
      </div>
    </figure>
  );
}

/* ------------------------------- Segment bar ------------------------------ */

export interface Segment { key: string; label: string; value: number; color: string; pattern?: boolean }

/** Stacked bar with 2px surface gaps and a legend that carries the numbers. */
export function SegmentBar({ segments, total }: { segments: Segment[]; total?: number }) {
  const sum = total ?? segments.reduce((n, s) => n + s.value, 0);
  const shown = segments.filter((s) => s.value > 0);
  return (
    <div>
      <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full bg-surface-3" role="img" aria-label={segments.map((s) => `${s.label} ${s.value}`).join(", ")}>
        {sum > 0 && shown.map((s) => (
          <span key={s.key} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(s.value / sum) * 100}%`, background: s.pattern ? `repeating-linear-gradient(45deg, ${s.color} 0 3px, transparent 3px 6px)` : s.color }} />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
        {segments.map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-ivory-dim"><span aria-hidden className="inline-block size-2 rounded-full" style={{ background: s.pattern ? `repeating-linear-gradient(45deg, ${s.color} 0 2px, transparent 2px 4px)` : s.color, border: s.pattern ? `1px solid ${s.color}` : undefined }} />{s.label}</span>
            <span className="tabular text-ivory">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------- Week bars ------------------------------- */

export interface DayBar { date: string; label: string; planned: number; done: number; isToday: boolean }

/** Seven-day completion columns; each day opens its record. */
export function WeekBars({ days }: { days: DayBar[] }) {
  return (
    <ol className="grid grid-cols-7 gap-1.5">
      {days.map((d) => {
        const pct = d.planned ? d.done / d.planned : null;
        return (
          <li key={d.date}>
            <Link href={`/today?date=${d.date}`} className="group block rounded-[12px] p-1 text-center transition-colors hover:bg-surface-2" aria-label={`${d.label}: ${d.planned ? `${d.done} of ${d.planned} done` : "nothing scheduled"}`}>
              <div className="relative mx-auto h-24 w-full max-w-9 overflow-hidden rounded-[8px] bg-surface-3">
                {pct !== null && <span className="absolute inset-x-0 bottom-0 rounded-t-[4px] bg-lime transition-[height] duration-500" style={{ height: `${Math.max(pct * 100, pct > 0 ? 6 : 0)}%` }} />}
                {pct === null && <span className="absolute inset-x-2 bottom-2 h-px bg-line-strong" />}
              </div>
              <p className={`mt-1.5 text-[0.7rem] ${d.isToday ? "font-semibold text-ivory" : "text-ivory-faint"}`}>{d.label}</p>
              <p className="text-[0.7rem] tabular text-ivory-dim">{d.planned ? `${d.done}/${d.planned}` : "—"}</p>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
