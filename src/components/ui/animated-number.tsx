"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Animates between real values when the value changes. The first render shows
 * the true value immediately (no count-up through invented intermediate
 * history). Respects reduced motion and exposes the exact value to assistive
 * technology.
 */
export function AnimatedNumber({ value, decimals = 0, suffix = "", prefix = "", duration = 600, className = "" }: {
  value: number; decimals?: number; suffix?: string; prefix?: string; duration?: number; className?: string;
}) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const t0 = performance.now();
    const dur = reduce ? 0 : duration;
    const tick = (t: number) => {
      const p = dur === 0 ? 1 : Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(start + (value - start) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); from.current = value; };
  }, [value, duration]);
  const text = `${prefix}${value.toFixed(decimals)}${suffix}`;
  return (
    <span className={`tabular ${className}`}>
      <span aria-hidden>{prefix}{shown.toFixed(decimals)}{suffix}</span>
      <span className="sr-only">{text}</span>
    </span>
  );
}
