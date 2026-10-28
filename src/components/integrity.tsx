import type { IntegrityResult } from "@/lib/integrity";
import { INTEGRITY_RULES } from "@/lib/integrity";
import { formatLocalDate } from "@/lib/time";

/** The day's score with its seven-day record. The number is the one loud element on the dashboard. */
export function IntegrityPanel({ today, series }: { today: IntegrityResult; series: { date: string; result: IntegrityResult }[] }) {
  const c = today.counts;
  return (
    <section aria-labelledby="integrity-h" className="py-2">
      <div className="flex items-end justify-between gap-6">
        <div>
          <h2 id="integrity-h" className="text-sm text-ivory-dim">Daily integrity</h2>
          <p className="metric mt-1" style={{ fontSize: "clamp(4rem, 16vw, 5.5rem)" }}>
            {today.score === null ? <span className="text-ivory-faint">—</span> : today.score}
          </p>
        </div>
        <SevenDay series={series} />
      </div>
      <p className="mt-3 max-w-prose text-sm text-ivory-dim">
        {today.score === null
          ? today.explanation
          : <>
              {c.commitmentsKept} of {c.commitments} commitments kept, {c.tasksDone} of {c.tasks} tasks done
              ({c.withEvidence} with evidence, {c.selfReported} self-reported).{" "}
              <span className={today.provisional ? "text-brass" : ""}>{today.explanation}</span>
            </>}
      </p>
      <details className="group mt-3 text-sm">
        <summary className="cursor-pointer text-ivory-faint hover:text-ivory-dim">How this is calculated</summary>
        <ul className="mt-3 space-y-2 border-l border-line pl-4 text-ivory-dim">
          {INTEGRITY_RULES.map((r) => <li key={r}>{r}</li>)}
          <li>This measures recorded behaviour, not your worth.</li>
        </ul>
        {today.components.some((x) => x.score !== null) && (
          <dl className="mt-4 grid grid-cols-3 gap-3">
            {today.components.map((x) => (
              <div key={x.key} className="rounded-[10px] bg-surface p-3">
                <dt className="text-xs text-ivory-faint">{x.label}</dt>
                <dd className="serif text-xl">{x.score ?? "—"}</dd>
              </div>
            ))}
          </dl>
        )}
      </details>
    </section>
  );
}

function SevenDay({ series }: { series: { date: string; result: IntegrityResult }[] }) {
  return (
    <figure aria-label="Last seven days" className="shrink-0">
      <div className="flex h-20 items-end gap-1.5">
        {series.map(({ date, result }) => {
          const v = result.score;
          return (
            <div key={date} className="flex h-full w-3 flex-col justify-end" title={`${formatLocalDate(date, "EEE MMM d")}: ${v ?? "no record"}`}>
              {v === null ? (
                <div className="h-px w-full bg-line" />
              ) : (
                <div
                  className={`w-full rounded-[2px] ${result.provisional ? "bg-ivory-faint" : v >= 70 ? "bg-emerald" : "bg-brass"}`}
                  style={{ height: `${Math.max(4, v)}%` }}
                />
              )}
            </div>
          );
        })}
      </div>
      <figcaption className="mt-1.5 flex justify-between text-[10px] text-ivory-faint">
        <span>{formatLocalDate(series[0].date, "EEE")}</span>
        <span>today</span>
      </figcaption>
      <span className="sr-only">
        {series.map((s) => `${formatLocalDate(s.date, "EEEE")}: ${s.result.score ?? "no record"}`).join("; ")}
      </span>
    </figure>
  );
}

/** Four-week record as bars; days with nothing scheduled are shown as gaps, not zeros. */
export function IntegritySeries({ data }: { data: { date: string; result: IntegrityResult }[] }) {
  const scored = data.filter((d) => d.result.score !== null);
  const avg = scored.length ? Math.round(scored.reduce((n, d) => n + (d.result.score ?? 0), 0) / scored.length) : null;
  return (
    <div>
      <div className="flex h-24 items-end gap-[3px]" role="img" aria-label={`Integrity over ${data.length} days${avg != null ? `, average ${avg}` : ""}`}>
        {data.map((d) => (
          <div key={d.date} className="flex h-full flex-1 items-end" title={`${formatLocalDate(d.date, "MMM d")}: ${d.result.score ?? "nothing scheduled"}`}>
            {d.result.score === null
              ? <div className="h-[2px] w-full rounded-full bg-line" />
              : <div className={`w-full rounded-t-[2px] ${d.result.score >= 70 ? "bg-emerald" : "bg-brass"} ${d.result.provisional ? "opacity-50" : ""}`} style={{ height: `${Math.max(4, d.result.score)}%` }} />}
          </div>
        ))}
      </div>
      <p className="mt-2 text-sm text-ivory-faint">
        {avg != null ? `Average ${avg} across ${scored.length} scored days.` : "No scored days yet."} Grey dashes are days with nothing scheduled.
      </p>
    </div>
  );
}
