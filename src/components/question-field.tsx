"use client";

import { useState } from "react";
import type { Question } from "@/lib/interview";

/**
 * One interview question, with an inline follow-up when the answer needs more
 * detail, and a Skip option: skipping is recorded honestly as "skipped", never
 * as a fabricated answer.
 */
export function QuestionField({ q, value, followUp, followUpValue, index, skipped: initiallySkipped }: {
  q: Question;
  value: string;
  followUp?: { text: string; source: "rule" | "ai" };
  followUpValue?: string;
  index: number;
  skipped?: boolean;
}) {
  const [skipped, setSkipped] = useState(!!initiallySkipped);
  const showFollowUp = !skipped && followUp && value.trim().length > 0;
  return (
    <fieldset className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <legend className="serif text-xl leading-snug">
          <span className="mr-2 text-ivory-faint tabular-nums">{index}.</span>{q.text}
          {!q.required && <span className="ml-2 text-sm text-ivory-faint">optional</span>}
        </legend>
        <label className="mt-1 flex shrink-0 cursor-pointer items-center gap-1.5 text-sm text-ivory-faint">
          <input type="checkbox" name={`skip_${q.key}`} checked={skipped} onChange={(e) => setSkipped(e.target.checked)} className="accent-[var(--color-emerald)]" />
          Skip
        </label>
      </div>
      {skipped ? (
        <p className="text-sm text-ivory-faint">Skipped. It will be recorded as skipped, not as an answer.</p>
      ) : (
        <>
          {q.hint && <p className="text-sm text-ivory-faint">{q.hint}</p>}
          <textarea name={q.key} defaultValue={value} className="field" aria-invalid={!!followUp && !showFollowUp} rows={3} aria-label={q.text} />
          {followUp && !showFollowUp && <p role="alert" className="text-sm text-brass">{followUp.text}</p>}
          {showFollowUp && (
            <div className="space-y-2 border-l-2 border-brass pl-4">
              <p className="serif text-[1.05rem] text-ivory">{followUp.text}</p>
              {followUp.source === "ai" && <p className="text-xs text-ivory-faint">Follow-up written by Claude</p>}
              <input type="hidden" name={`fuq_${q.key}`} value={followUp.text} />
              <input type="hidden" name={`fus_${q.key}`} value={followUp.source} />
              <textarea name={`fu_${q.key}`} defaultValue={followUpValue ?? ""} className="field" rows={2} autoFocus aria-label={followUp.text} />
            </div>
          )}
        </>
      )}
    </fieldset>
  );
}
