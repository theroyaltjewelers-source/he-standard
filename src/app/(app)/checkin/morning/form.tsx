"use client";

import { useActionState, useState } from "react";
import { saveMorning, type CheckinState } from "@/app/actions/checkin";
import { MORNING_QUESTIONS } from "@/lib/interview";
import { QuestionField } from "@/components/question-field";

export function MorningForm({ initial }: { initial: Record<string, string> }) {
  const [state, action, pending] = useActionState<CheckinState, FormData>(saveMorning, {});
  const v = (k: string) => state?.values?.[k] ?? initial[k] ?? "";
  const startCount = [2, 3].filter((i) => v(`c${i}_title`)).length + 1;
  const [count, setCount] = useState(startCount);

  return (
    <form key={state?.attempt ?? 0} action={action} className="space-y-12">
      <fieldset className="space-y-4">
        <legend className="serif text-xl leading-snug">
          <span className="mr-2 text-ivory-faint">1.</span>What are your most important priorities today?
        </legend>
        <p className="text-sm text-ivory-faint">Up to three. Specific, finishable today, with the time each will be done. Each gets a reminder before its time.</p>
        {[1, 2, 3].slice(0, Math.max(count, startCount)).map((i) => (
          <div key={i} className="space-y-3 rounded-[14px] border border-line p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-ivory-faint">Priority {i}</p>
            <input name={`c${i}_title`} defaultValue={v(`c${i}_title`)} className="field" placeholder={i === 1 ? "e.g. Send the revised quote to the client" : "What will you do?"} aria-label={`Priority ${i}`} maxLength={200} />
            <label className="block text-sm text-ivory-dim">What outcome shows it&apos;s done?
              <input name={`c${i}_outcome`} defaultValue={v(`c${i}_outcome`)} className="field mt-1" placeholder="e.g. Client has the quote in their inbox" maxLength={300} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm text-ivory-dim">Done by
                <input type="time" name={`c${i}_time`} defaultValue={v(`c${i}_time`)} className="field mt-1" />
              </label>
              <label className="text-sm text-ivory-dim">Effort (minutes)
                <input type="number" inputMode="numeric" min={5} max={600} step={5} name={`c${i}_effort`} defaultValue={v(`c${i}_effort`)} className="field mt-1" placeholder="45" />
              </label>
            </div>
            <label className="block text-sm text-ivory-dim">Likely obstacle
              <input name={`c${i}_obstacle`} defaultValue={v(`c${i}_obstacle`)} className="field mt-1" placeholder="What could get in the way?" maxLength={300} />
            </label>
            <label className="block text-sm text-ivory-dim">First action
              <input name={`c${i}_first`} defaultValue={v(`c${i}_first`)} className="field mt-1" placeholder="Something you could start in two minutes" maxLength={200} />
            </label>
            <label className="block text-sm text-ivory-dim">Promised to
              <input name={`c${i}_to`} defaultValue={v(`c${i}_to`)} className="field mt-1" placeholder="Myself" maxLength={80} />
            </label>
          </div>
        ))}
        {Math.max(count, startCount) < 3 && (
          <button type="button" className="btn btn-quiet w-full" onClick={() => setCount((c) => Math.max(c, startCount) + 1)}>Add another priority</button>
        )}
      </fieldset>

      {state?.conflicts && state.conflicts.length > 0 && (
        <div role="alert" className="space-y-3 rounded-[14px] border border-brass/60 bg-brass-deep/40 p-4">
          <p className="font-medium text-brass">Schedule check</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-ivory">
            {state.conflicts.map((c) => <li key={c}>{c}</li>)}
          </ul>
          <label className="flex items-center gap-2 text-sm text-ivory-dim">
            <input type="checkbox" name="ack_conflicts" className="accent-[var(--color-emerald)]" /> Keep the plan as it is
          </label>
        </div>
      )}
      {!state?.conflicts?.length && v("ack_conflicts") === "on" && <input type="hidden" name="ack_conflicts" value="on" />}

      {MORNING_QUESTIONS.map((q, i) => (
        <QuestionField key={q.key} q={q} index={i + 2} value={v(q.key)} followUp={state?.followUps?.[q.key]} followUpValue={v(`fu_${q.key}`)} skipped={v(`skip_${q.key}`) === "on"} />
      ))}

      <fieldset className="space-y-3">
        <legend className="serif text-xl leading-snug"><span className="mr-2 text-ivory-faint">{MORNING_QUESTIONS.length + 2}.</span>Your intention for today, in one line</legend>
        <input name="intention" defaultValue={v("intention")} className="field serif" maxLength={200} placeholder="Shown at the top of your dashboard" />
      </fieldset>

      {state?.error && <p role="alert" className="text-brass">{state.error}</p>}
      <button className="btn btn-primary w-full" disabled={pending} data-state={pending ? "loading" : undefined}>{pending ? "Recording…" : "Record commitments"}</button>
    </form>
  );
}
