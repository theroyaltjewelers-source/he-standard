"use client";

import { useActionState, useRef, useState } from "react";
import { addEntry, type MoneyState } from "@/app/actions/money";

const KINDS = [
  { k: "expense", l: "Spent" }, { k: "income", l: "Earned" }, { k: "bill", l: "Bill due" },
  { k: "debt_payment", l: "Debt payment" }, { k: "savings", l: "Saved" },
] as const;

export function MoneyForm({ today }: { today: string }) {
  const [kind, setKind] = useState<(typeof KINDS)[number]["k"]>("expense");
  const ref = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<MoneyState, FormData>(async (p, f) => {
    const r = await addEntry(p, f);
    if (r?.ok) ref.current?.reset();
    return r;
  }, undefined);
  return (
    <form ref={ref} action={action} className="space-y-3 rounded-[14px] border border-line p-4">
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Type">
        {KINDS.map((x) => <button type="button" key={x.k} role="radio" aria-checked={kind === x.k} data-on={kind === x.k} className="chip" onClick={() => setKind(x.k)}>{x.l}</button>)}
      </div>
      <input type="hidden" name="kind" value={kind} />
      <div className="grid grid-cols-2 gap-2">
        <label className="text-sm text-ivory-dim">Amount
          <input name="amount" type="number" inputMode="decimal" step="0.01" min="0" className="field mt-1" required />
        </label>
        <label className="text-sm text-ivory-dim">{kind === "bill" ? "Due" : "Date"}
          <input name={kind === "bill" ? "due_date" : "entry_date"} type="date" defaultValue={today} className="field mt-1" />
        </label>
      </div>
      <input name="description" className="field" placeholder="What was it?" maxLength={300} aria-label="Description" />
      <div className="grid grid-cols-2 gap-2">
        <select name="scope" defaultValue="personal" className="field" aria-label="Business or personal"><option value="personal">Personal</option><option value="business">Business</option></select>
        <input name="category" className="field" placeholder="Category" maxLength={60} aria-label="Category" />
      </div>
      {kind === "expense" && (
        <>
          <label className="flex items-center gap-2 text-sm text-ivory-dim"><input type="checkbox" name="discretionary" className="accent-[var(--color-emerald)]" /> Discretionary — I didn&apos;t need it</label>
          <input name="reflection" className="field" placeholder="Was this aligned with your goals? (optional)" maxLength={500} aria-label="Reflection" />
        </>
      )}
      {state?.error && <p role="alert" className="text-sm text-brass">{state.error}</p>}
      <button className="btn btn-primary w-full" disabled={pending}>{pending ? "Saving…" : "Record"}</button>
    </form>
  );
}
