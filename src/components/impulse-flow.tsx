"use client";

import { useActionState, useEffect, useState } from "react";
import { logImpulse, type ImpulseState } from "@/app/actions/rhythm";
import { haptic } from "@/lib/haptics";
import { IMPULSE_KINDS } from "@/lib/types";

type Step = "closed" | "kind" | "pause" | "breathe" | "ask" | "logged";
const PHASES = [{ label: "Breathe in", s: 4 }, { label: "Hold", s: 4 }, { label: "Breathe out", s: 6 }];

/**
 * Impulse interruption: name the urge, put time between urge and action
 * (a 60-second pause or three slow breaths), look at it clearly, choose an
 * aligned alternative. The outcome is recorded later, honestly.
 */
export function ImpulseFlow() {
  const [step, setStep] = useState<Step>("closed");
  const [kind, setKind] = useState<string>("");
  const [intervention, setIntervention] = useState<"pause" | "breathing">("pause");
  const [count, setCount] = useState(60);
  const [phase, setPhase] = useState(0);
  const [breaths, setBreaths] = useState(0);
  const [state, action, pending] = useActionState<ImpulseState, FormData>(async (p, f) => {
    const r = await logImpulse(p, f);
    if (r?.id) { setStep("logged"); haptic(); }
    return r;
  }, undefined);

  useEffect(() => {
    if (step !== "pause") return;
    const id = setInterval(() => setCount((c) => (c <= 1 ? 0 : c - 1)), 1000);
    return () => clearInterval(id);
  }, [step]);
  useEffect(() => {
    if (step !== "breathe") return;
    const id = setTimeout(() => {
      haptic(8);
      if (phase === PHASES.length - 1) { setBreaths((b) => b + 1); setPhase(0); } else setPhase(phase + 1);
    }, PHASES[phase].s * 1000);
    return () => clearTimeout(id);
  }, [step, phase]);

  if (step === "closed") {
    return <button className="btn btn-quiet w-full border-brass/60" onClick={() => { haptic(); setStep("kind"); }}>I feel an urge right now</button>;
  }

  const close = () => { setStep("closed"); setKind(""); setCount(60); setPhase(0); setBreaths(0); };

  return (
    <div className="space-y-5 rounded-[14px] border border-line bg-surface p-5">
      {step === "kind" && (
        <>
          <p className="serif text-xl">What is the urge?</p>
          <div className="flex flex-wrap gap-2">
            {IMPULSE_KINDS.map((k) => <button key={k.key} className="chip" data-on={kind === k.key} onClick={() => setKind(k.key)}>{k.label}</button>)}
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" disabled={!kind} onClick={() => { setIntervention("pause"); setStep("pause"); }}>Pause 60 seconds</button>
            <button className="btn btn-quiet" disabled={!kind} onClick={() => { setIntervention("breathing"); setStep("breathe"); }}>Three slow breaths</button>
            <button className="btn btn-quiet" onClick={close}>Cancel</button>
          </div>
        </>
      )}
      {step === "pause" && (
        <div className="text-center">
          <p className="text-ivory-dim">Do nothing. Let the urge rise and fall.</p>
          <p className="serif my-4 text-display tabular-nums">{count}</p>
          <button className="btn btn-primary" onClick={() => setStep("ask")}>{count === 0 ? "Continue" : "I'm ready now"}</button>
        </div>
      )}
      {step === "breathe" && (
        <div className="text-center">
          <div className="mx-auto my-4 grid size-40 place-items-center">
            <div
              className="grid size-full place-items-center rounded-full border border-emerald/60 bg-emerald-deep/40 transition-transform ease-in-out motion-reduce:transition-none"
              style={{ transform: `scale(${phase === 0 ? 1 : phase === 1 ? 1 : 0.6})`, transitionDuration: `${PHASES[phase].s}s` }}
            >
              <span className="serif text-lg">{PHASES[phase].label}</span>
            </div>
          </div>
          <p className="text-sm text-ivory-faint">{breaths} of 3 breaths</p>
          <button className="btn btn-primary mt-4" onClick={() => setStep("ask")}>{breaths >= 3 ? "Continue" : "Continue now"}</button>
        </div>
      )}
      {step === "ask" && (
        <form action={action} className="space-y-4">
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="intervention" value={intervention} />
          <label className="block text-sm text-ivory-dim">What am I feeling?<input name="feeling" className="field mt-1" maxLength={300} /></label>
          <label className="block text-sm text-ivory-dim">What triggered it?<input name="trigger_note" className="field mt-1" maxLength={500} /></label>
          <label className="block text-sm text-ivory-dim">What am I trying to escape or get?<input name="seeking" className="field mt-1" maxLength={500} /></label>
          <label className="block text-sm text-ivory-dim">What happens if I act on it?<input name="consequence" className="field mt-1" maxLength={500} /></label>
          <label className="block text-sm text-ivory-dim">What will I do instead, right now?<input name="alternative" className="field mt-1" maxLength={500} placeholder="One action that serves your goals" /></label>
          {state?.error && <p role="alert" className="text-sm text-brass">{state.error}</p>}
          <div className="flex gap-2"><button className="btn btn-primary flex-1" disabled={pending} data-state={pending ? "loading" : undefined}>Record and do the alternative</button><button type="button" className="btn btn-quiet" onClick={close}>Close</button></div>
        </form>
      )}
      {step === "logged" && (
        <div className="space-y-3">
          <p className="serif text-xl">Recorded. Go do the alternative.</p>
          <p className="text-sm text-ivory-dim">Come back and record how it went — below, under recent urges. Either answer is useful; only an honest one is.</p>
          <button className="btn btn-quiet" onClick={close}>Done</button>
        </div>
      )}
    </div>
  );
}
