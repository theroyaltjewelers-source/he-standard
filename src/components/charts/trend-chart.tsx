"use client";

import { useId, useMemo, useRef, useState } from "react";

export interface Series { key: string; label: string; color: string; values: (number | null)[]; dashed?: boolean; area?: boolean }

/**
 * Line/area chart over measured points. Nulls are gaps — never interpolated.
 * Crosshair tooltip on pointer and keyboard (arrow keys), a screen-reader
 * summary, and a table view.
 */
export function TrendChart({ labels, series, height = 220, yMax = 100, yLabel = "", summary, decimals = 0 }: {
  labels: string[]; series: Series[]; height?: number; yMax?: number; yLabel?: string; summary: string; decimals?: number;
}) {
  const format = (v: number) => v.toFixed(decimals);
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = height, padL = 32, padR = 12, padT = 12, padB = 26;
  const n = labels.length;
  const x = (i: number) => padL + (n <= 1 ? (W - padL - padR) / 2 : (i / (n - 1)) * (W - padL - padR));
  const y = (v: number) => padT + (1 - Math.min(v, yMax) / yMax) * (H - padT - padB);

  const paths = useMemo(() => series.map((s) => {
    const segs: string[] = [];
    let cur = "";
    s.values.forEach((v, i) => {
      if (v === null || v === undefined) { if (cur) segs.push(cur); cur = ""; return; }
      cur += `${cur ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    });
    if (cur) segs.push(cur);
    const areas = s.area ? segs.map((d) => {
      const pts = d.slice(1).split("L").map((p) => p.split(",").map(Number));
      return `${d}L${pts[pts.length - 1][0]},${y(0)}L${pts[0][0]},${y(0)}Z`;
    }) : [];
    // Isolated points (a measured value with null neighbours) still need a visible mark.
    const dots = s.values.map((v, i) => (v !== null && (i === 0 || s.values[i - 1] === null) && (i === n - 1 || s.values[i + 1] === null) ? i : -1)).filter((i) => i >= 0);
    return { s, segs, areas, dots };
  }), [series, n]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasData = series.some((s) => s.values.some((v) => v !== null));
  const pick = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || n === 0) return;
    const px = ((clientX - r.left) / r.width) * W;
    const i = Math.round(((px - padL) / (W - padL - padR)) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };
  const tickIdx = n <= 1 ? [0] : [0, Math.floor((n - 1) / 2), n - 1];

  return (
    <figure className="relative" aria-labelledby={`${id}-sum`}>
      <p id={`${id}-sum`} className="sr-only">{summary}</p>
      {!hasData ? (
        <div className="grid place-items-center rounded-[16px] border border-dashed border-line text-center text-sm text-ivory-faint" style={{ height: H * 0.75 }}>
          Not enough recorded data yet for this period.<br />Points appear once a window has enough evidence.
        </div>
      ) : (
        <div
          ref={ref}
          className="relative touch-pan-y outline-none"
          tabIndex={0}
          role="img"
          aria-label={summary}
          onPointerMove={(e) => pick(e.clientX)}
          onPointerDown={(e) => pick(e.clientX)}
          onPointerLeave={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") setHover((h) => Math.min(n - 1, (h ?? -1) + 1));
            if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? n) - 1));
            if (e.key === "Escape") setHover(null);
          }}
          onBlur={() => setHover(null)}
        >
          <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full overflow-visible" aria-hidden>
            <defs>
              {series.filter((s) => s.area).map((s) => (
                <linearGradient key={s.key} id={`${id}-g-${s.key}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity="0.32" />
                  <stop offset="100%" stopColor={s.color} stopOpacity="0" />
                </linearGradient>
              ))}
            </defs>
            {(yMax === 100 ? [0, 50, 100] : [0, Math.round(yMax / 2), yMax]).map((t) => (
              <g key={t}>
                <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth="1" strokeDasharray={t === 0 ? undefined : "2 4"} />
                <text x={padL - 8} y={y(t) + 4} textAnchor="end" className="fill-[var(--color-ivory-faint)] text-[11px] tabular">{t}</text>
              </g>
            ))}
            {tickIdx.map((i) => (
              <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} className="fill-[var(--color-ivory-faint)] text-[11px]">{labels[i]}</text>
            ))}
            {paths.map(({ s, areas }) => areas.map((d, k) => <path key={`${s.key}-a${k}`} d={d} fill={`url(#${id}-g-${s.key})`} />))}
            {paths.map(({ s, segs, dots }) => (
              <g key={s.key}>
                {segs.map((d, k) => <path key={k} d={d} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? "4 4" : undefined} />)}
                {dots.map((i) => <circle key={i} cx={x(i)} cy={y(s.values[i]!)} r="4" fill={s.color} stroke="var(--color-surface)" strokeWidth="2" />)}
              </g>
            ))}
            {hover !== null && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} stroke="var(--color-ivory-faint)" strokeWidth="1" />
                {series.map((s) => s.values[hover] !== null && s.values[hover] !== undefined ? (
                  <circle key={s.key} cx={x(hover)} cy={y(s.values[hover]!)} r="5" fill={s.color} stroke="var(--color-surface)" strokeWidth="2" />
                ) : null)}
              </g>
            )}
          </svg>
          {hover !== null && (
            <div className="pointer-events-none absolute top-0 z-10 min-w-36 -translate-x-1/2 rounded-[12px] border border-line-strong bg-surface-2/95 px-3 py-2 text-xs shadow-xl backdrop-blur"
              style={{ left: `${(x(hover) / W) * 100}%` }}>
              <p className="mb-1 text-ivory-dim">{labels[hover]}</p>
              {series.map((s) => (
                <p key={s.key} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-3 rounded" style={{ background: s.color }} />{s.label}</span>
                  <span className="tabular text-ivory">{s.values[hover] === null || s.values[hover] === undefined ? "no data" : `${format(s.values[hover]!)}${yLabel}`}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      )}
      {series.length > 1 && (
        <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ivory-dim">
          {series.map((s) => <span key={s.key} className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 rounded" style={{ background: s.color, borderTop: s.dashed ? `2px dashed ${s.color}` : undefined }} />{s.label}</span>)}
        </figcaption>
      )}
      {hasData && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-ivory-faint hover:text-ivory-dim">View as table</summary>
          <div className="mt-2 max-h-56 overflow-auto rounded-[10px] border border-line">
            <table className="w-full text-left tabular">
              <thead className="sticky top-0 bg-surface-2"><tr><th className="px-2 py-1 font-medium">Date</th>{series.map((s) => <th key={s.key} className="px-2 py-1 font-medium">{s.label}</th>)}</tr></thead>
              <tbody>{labels.map((l, i) => <tr key={i} className="border-t border-line"><td className="px-2 py-1 text-ivory-dim">{l}</td>{series.map((s) => <td key={s.key} className="px-2 py-1">{s.values[i] === null || s.values[i] === undefined ? "—" : format(s.values[i]!)}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </details>
      )}
    </figure>
  );
}
