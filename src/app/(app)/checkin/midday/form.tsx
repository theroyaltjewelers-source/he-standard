"use client";

import { useActionState } from "react";
import { saveMidday, type CheckinState } from "@/app/actions/checkin";
import { MIDDAY_QUESTIONS } from "@/lib/interview";
import { QuestionField } from "@/components/question-field";

export function MiddayForm({ initial }: { initial: Record<string, string> }) {
  const [state, action, pending] = useActionState<CheckinState, FormData>(saveMidday, {});
  const v = (k: string) => state?.values?.[k] ?? initial[k] ?? "";
  return (
    <form key={state?.attempt ?? 0} action={action} className="space-y-10">
      {MIDDAY_QUESTIONS.map((q, i) => (
        <QuestionField key={q.key} q={q} index={i + 1} value={v(q.key)} followUp={state?.followUps?.[q.key]} followUpValue={v(`fu_${q.key}`)} skipped={v(`skip_${q.key}`) === "on"} />
      ))}
      {state?.error && <p role="alert" className="text-brass">{state.error}</p>}
      <button className="btn btn-primary w-full" disabled={pending} data-state={pending ? "loading" : undefined}>{pending ? "Recording…" : "Record midday check-in"}</button>
    </form>
  );
}
