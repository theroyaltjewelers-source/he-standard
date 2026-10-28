"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Sheet } from "@/components/ui/sheet";
import { saveFoodEntry, type FoodEntryRow, type FoodResult } from "@/app/actions/food";
import { FOOD_LIMITS, MEALS, newEntryDefaults, validateFood, type FieldErrors } from "@/lib/food";
import { localTimeString } from "@/lib/time";

export type FormMode =
  | { kind: "new"; date: string }
  | { kind: "edit"; entry: FoodEntryRow }
  | { kind: "again"; entry: FoodEntryRow };

type Values = { description: string; date: string; time: string; meal: string; portion: string; notes: string };

function initialValues(mode: FormMode, tz: string): Values {
  if (mode.kind === "edit") {
    const e = mode.entry;
    return { description: e.description, date: e.local_date, time: localTimeString(new Date(e.eaten_at), e.timezone), meal: e.meal ?? "", portion: e.portion ?? "", notes: e.notes ?? "" };
  }
  const d = newEntryDefaults(mode.kind === "new" ? mode.date : "9999-12-31", tz);
  if (mode.kind === "again") return { ...d, description: mode.entry.description, meal: mode.entry.meal ?? "", portion: mode.entry.portion ?? "", notes: "" };
  return { ...d, description: "", meal: "", portion: "", notes: "" };
}

/**
 * "Log food" / "Edit food entry" sheet. Required fields are visible at once;
 * meal, portion and notes sit behind "Add details". Success is shown only
 * after the server confirms the save; on failure every typed value stays.
 */
export function FoodForm({ mode, tz, today, onClose, onSaved }: {
  mode: FormMode | null; tz: string; today: string;
  onClose: () => void; onSaved: (r: Extract<FoodResult, { ok: true }>, mode: FormMode) => void;
}) {
  return mode ? <FormInner key={JSON.stringify(mode)} mode={mode} tz={tz} today={today} onClose={onClose} onSaved={onSaved} /> : <Sheet open={false} title="" onRequestClose={onClose}>{null}</Sheet>;
}

function FormInner({ mode, tz, today, onClose, onSaved }: { mode: FormMode; tz: string; today: string; onClose: () => void; onSaved: (r: Extract<FoodResult, { ok: true }>, mode: FormMode) => void }) {
  const id = useId();
  const [initial] = useState(() => initialValues(mode, tz));
  const [v, setV] = useState<Values>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [details, setDetails] = useState(() => !!(initial.meal || initial.portion || initial.notes));
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [pending, start] = useTransition();
  // One idempotency key per opened form: repeated taps or a retry can't create a second entry.
  const [requestId] = useState(() => crypto.randomUUID());
  const descRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { const t = setTimeout(() => descRef.current?.focus(), 30); return () => clearTimeout(t); }, []);

  const dirty = (Object.keys(v) as (keyof Values)[]).some((k) => v[k].trim() !== initial[k].trim());
  const set = (k: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setV((x) => ({ ...x, [k]: e.target.value }));
    if (errors[k as keyof FieldErrors]) setErrors((x) => ({ ...x, [k]: undefined }));
  };
  const requestClose = () => { if (pending) return; if (dirty) setConfirmDiscard(true); else onClose(); };

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (pending) return;
    setFormError(null);
    const local = validateFood(v, tz);
    if (!local.ok) {
      setErrors(local.errors);
      if (local.errors.meal || local.errors.portion || local.errors.notes) setDetails(true);
      document.getElementById(`${id}-${Object.keys(local.errors)[0]}`)?.focus();
      return;
    }
    start(async () => {
      let r: FoodResult;
      try {
        r = await saveFoodEntry({ ...v, id: mode.kind === "edit" ? mode.entry.id : null, requestId: mode.kind === "edit" ? null : requestId });
      } catch {
        r = { ok: false, error: "Couldn't save your entry. Your details are still here—try again." };
      }
      if (!r.ok) { setErrors(r.fieldErrors ?? {}); setFormError(r.error); return; }
      onSaved(r, mode);
    });
  }

  const title = mode.kind === "edit" ? "Edit food entry" : "Log food";
  const err = (k: keyof FieldErrors) => errors[k] ? <p id={`${id}-${k}-err`} className="field-error" role="alert">{errors[k]}</p> : null;
  const aria = (k: keyof FieldErrors) => ({ id: `${id}-${k}`, "aria-invalid": errors[k] ? true : undefined, "aria-describedby": errors[k] ? `${id}-${k}-err` : undefined });
  const count = v.description.trim().length;

  return (
    <Sheet
      open
      title={confirmDiscard ? "Discard this entry?" : title}
      description={confirmDiscard ? "What you typed hasn't been saved." : undefined}
      onRequestClose={confirmDiscard ? () => setConfirmDiscard(false) : requestClose}
      footer={confirmDiscard ? (
        <>
          <button type="button" className="btn btn-quiet" onClick={() => setConfirmDiscard(false)}>Keep editing</button>
          <button type="button" className="btn btn-danger" onClick={onClose}>Discard</button>
        </>
      ) : (
        <>
          <button type="button" className="btn btn-quiet" onClick={requestClose} disabled={pending}>Cancel</button>
          <button type="submit" form={`${id}-form`} className="btn btn-primary" disabled={pending} data-state={pending ? "loading" : undefined} aria-live="polite">
            {pending ? "Saving…" : mode.kind === "edit" ? "Save changes" : "Save entry"}
          </button>
        </>
      )}
    >
      <form id={`${id}-form`} onSubmit={submit} noValidate className={`space-y-4 ${confirmDiscard ? "hidden" : ""}`}>
        <div>
          <label htmlFor={`${id}-description`} className="text-sm font-medium">What did you eat?</label>
          <textarea ref={descRef} {...aria("description")} value={v.description} onChange={set("description")} rows={3} required
            placeholder="For example, eggs, toast, and fruit" className="field mt-1.5 min-h-24"
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }} />
          {err("description") ?? (count > FOOD_LIMITS.description - 60 && <p className={`mt-1 text-xs ${count > FOOD_LIMITS.description ? "text-brass" : "text-ivory-faint"}`}>{count}/{FOOD_LIMITS.description}</p>)}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${id}-date`} className="text-sm font-medium">Date</label>
            <input type="date" {...aria("date")} value={v.date} max={today} onChange={set("date")} required className="field mt-1.5" />
            {err("date")}
          </div>
          <div>
            <label htmlFor={`${id}-time`} className="text-sm font-medium">Time eaten</label>
            <input type="time" {...aria("time")} value={v.time} onChange={set("time")} required className="field mt-1.5" />
            {err("time")}
          </div>
        </div>

        <div>
          <button type="button" className="flex min-h-11 items-center gap-2 text-sm text-ivory-dim hover:text-ivory" aria-expanded={details} aria-controls={`${id}-details`} onClick={() => setDetails((d) => !d)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden className={`transition-transform duration-150 ${details ? "rotate-90" : ""}`}><path d="M9 6l6 6-6 6" /></svg>
            Add details <span className="text-ivory-faint">— meal, portion, notes (optional)</span>
          </button>
          <div id={`${id}-details`} hidden={!details} className={details ? "details-in mt-2 space-y-4" : ""}>
            <fieldset>
              <legend className="text-sm font-medium">Meal</legend>
              <div className="mt-1.5 flex flex-wrap gap-2" role="radiogroup" aria-label="Meal">
                {MEALS.map((m) => (
                  <button key={m.key} type="button" role="radio" aria-checked={v.meal === m.key} className="chip min-h-11"
                    onClick={() => setV((x) => ({ ...x, meal: x.meal === m.key ? "" : m.key }))}>{m.label}</button>
                ))}
              </div>
              {err("meal")}
            </fieldset>
            <div>
              <label htmlFor={`${id}-portion`} className="text-sm font-medium">Portion</label>
              <input {...aria("portion")} value={v.portion} onChange={set("portion")} placeholder="For example, 1 bowl or 2 slices" className="field mt-1.5" />
              {err("portion")}
            </div>
            <div>
              <label htmlFor={`${id}-notes`} className="text-sm font-medium text-ivory-dim">Notes</label>
              <textarea {...aria("notes")} value={v.notes} onChange={set("notes")} rows={2} className="field mt-1.5 min-h-16 text-sm" />
              {err("notes")}
            </div>
          </div>
        </div>
        {formError && <p role="alert" className="rounded-[12px] border border-brass/50 bg-brass-deep/40 px-3 py-2 text-sm">{formError}</p>}
      </form>
    </Sheet>
  );
}
