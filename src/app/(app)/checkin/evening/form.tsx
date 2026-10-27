"use client";

import { useActionState } from "react";
import { saveEvening, type CheckinState } from "@/app/actions/checkin";
import { EVENING_QUESTIONS } from "@/lib/interview";
import { QuestionField } from "@/components/question-field";

export function EveningForm({ initial, openCommitments }: { initial: Record<string, string>; openCommitments: number }) {
  const [state, action, pending] = useActionState<CheckinState, FormData>(saveEvening, {});
  const v = (k: string) => state?.values?.[k] ?? initial[k] ?? "";
  return (
    <form key={state?.attempt ?? 0} action={action} className="space-y-12">
      {EVENING_QUESTIONS.map((q, i) => (
        <QuestionField key={q.key} q={q} index={i + 2} value={v(q.key)} followUp={state?.followUps?.[q.key]} followUpValue={v(`fu_${q.key}`)} />
      ))}
      {state?.error && <p role="alert" className="text-brass">{state.error}</p>}
      {openCommitments > 0 && !state?.error && (
        <p className="text-sm text-ivory-dim">{openCommitments} commitment{openCommitments > 1 ? "s" : ""} above still need{openCommitments > 1 ? "" : "s"} recording before you can finish.</p>
      )}
      <button className="btn btn-primary w-full" disabled={pending}>{pending ? "Recording…" : "Finish evening review"}</button>
    </form>
  );
}
