"use client";

import { useActionState } from "react";
import { saveMorning, type CheckinState } from "@/app/actions/checkin";
import { MORNING_QUESTIONS } from "@/lib/interview";
import { QuestionField } from "@/components/question-field";

export function MorningForm({ initial }: { initial: Record<string, string> }) {
  const [state, action, pending] = useActionState<CheckinState, FormData>(saveMorning, {});
  const v = (k: string) => state?.values?.[k] ?? initial[k] ?? "";

  return (
    <form key={state?.attempt ?? 0} action={action} className="space-y-12">
      <fieldset className="space-y-4">
        <legend className="serif text-xl leading-snug">
          <span className="mr-2 text-ivory-faint">1.</span>What are your three most important commitments today, and what time will you complete each one?
        </legend>
        <p className="text-sm text-ivory-faint">Specific and finishable today. Each one gets a reminder an hour before its time.</p>
        {[1, 2, 3].map((i) => (
          <div key={i} className="space-y-2 rounded-[14px] border border-line p-4">
            <input name={`c${i}_title`} defaultValue={v(`c${i}_title`)} className="field" placeholder={i === 1 ? "e.g. Send the revised quote to the client" : `Commitment ${i}`} aria-label={`Commitment ${i}`} maxLength={200} />
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm text-ivory-dim">Done by
                <input type="time" name={`c${i}_time`} defaultValue={v(`c${i}_time`)} className="field mt-1" />
              </label>
              <label className="text-sm text-ivory-dim">Promised to
                <input name={`c${i}_to`} defaultValue={v(`c${i}_to`)} className="field mt-1" placeholder="Myself" maxLength={80} />
              </label>
            </div>
          </div>
        ))}
      </fieldset>

      {MORNING_QUESTIONS.map((q, i) => (
        <QuestionField key={q.key} q={q} index={i + 2} value={v(q.key)} followUp={state?.followUps?.[q.key]} followUpValue={v(`fu_${q.key}`)} />
      ))}

      <fieldset className="space-y-3">
        <legend className="serif text-xl leading-snug"><span className="mr-2 text-ivory-faint">{MORNING_QUESTIONS.length + 2}.</span>Your intention for today, in one line</legend>
        <input name="intention" defaultValue={v("intention")} className="field serif" maxLength={200} placeholder="Shown at the top of your dashboard" />
      </fieldset>

      {state?.error && <p role="alert" className="text-brass">{state.error}</p>}
      <button className="btn btn-primary w-full" disabled={pending}>{pending ? "Recording…" : "Record commitments"}</button>
    </form>
  );
}
