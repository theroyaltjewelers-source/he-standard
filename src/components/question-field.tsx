import type { Question } from "@/lib/interview";

/** One interview question, with an inline follow-up when the answer needs more detail. */
export function QuestionField({ q, value, followUp, followUpValue, index }: {
  q: Question;
  value: string;
  followUp?: { text: string; source: "rule" | "ai" };
  followUpValue?: string;
  index: number;
}) {
  const showFollowUp = followUp && value.trim().length > 0;
  return (
    <fieldset className="space-y-3">
      <legend className="serif text-xl leading-snug">
        <span className="mr-2 text-ivory-faint tabular-nums">{index}.</span>{q.text}
        {!q.required && <span className="ml-2 text-sm text-ivory-faint">optional</span>}
      </legend>
      {q.hint && <p className="text-sm text-ivory-faint">{q.hint}</p>}
      <textarea name={q.key} defaultValue={value} className="field" aria-invalid={!!followUp && !showFollowUp} rows={3} />
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
    </fieldset>
  );
}
