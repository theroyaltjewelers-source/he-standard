"use client";

import { useActionState, useRef, useState, useSyncExternalStore } from "react";
import { saveJournal, type JournalState } from "@/app/actions/journal";
import { JOURNAL_TAGS, type JournalEntry } from "@/lib/types";

const PROMPTS = [
  "What did you avoid today, and what did avoiding it cost?",
  "Where did your actions match your intention today? Where didn't they?",
  "What were you feeling right before the hardest moment of the day?",
  "What is one thing you said today that you would say differently?",
  "What are you grateful for that you didn't earn?",
  "What would the version of you who keeps every commitment do tomorrow morning?",
];

const noop = () => () => {};

type SR = { start(): void; stop(): void; continuous: boolean; interimResults: boolean; lang: string;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };

export function JournalForm({ entry, today }: { entry?: JournalEntry; today: string }) {
  const [state, action, pending] = useActionState<JournalState, FormData>(saveJournal, undefined);
  const [body, setBody] = useState(entry?.body ?? "");
  const [voiceUsed, setVoiceUsed] = useState(entry?.input_method === "voice");
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const supported = useSyncExternalStore(
    noop,
    () => { const w = window as unknown as Record<string, unknown>; return !!(w.SpeechRecognition || w.webkitSpeechRecognition); },
    () => false,
  );
  const [prompt, setPrompt] = useState<string | null>(null);
  const rec = useRef<SR | null>(null);

  function toggleVoice() {
    if (listening) { rec.current?.stop(); return; }
    const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;
    const r = new Ctor();
    r.continuous = true; r.interimResults = false; r.lang = navigator.language || "en-US";
    r.onresult = (e) => {
      let text = "";
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) text += e.results[i][0].transcript;
      if (text) { setBody((b) => (b ? b.replace(/\s*$/, " ") : "") + text.trim()); setVoiceUsed(true); }
    };
    r.onerror = (e) => setVoiceError(e.error === "not-allowed" ? "Microphone access was blocked." : `Dictation stopped (${e.error}).`);
    r.onend = () => setListening(false);
    rec.current = r;
    setVoiceError(null);
    r.start();
    setListening(true);
  }

  return (
    <form action={action} className="space-y-6">
      {entry && <input type="hidden" name="id" value={entry.id} />}
      <input type="hidden" name="input_method" value={voiceUsed ? "voice" : "typed"} />
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <input name="title" defaultValue={entry?.title ?? ""} className="field serif" placeholder="Title (optional)" maxLength={200} aria-label="Title" />
        <input type="date" name="entry_date" defaultValue={entry?.entry_date ?? today} className="field" aria-label="Date" />
      </div>
      {prompt && <p className="serif border-l-2 border-emerald pl-4 text-lg text-ivory-dim italic">{prompt}</p>}
      <textarea name="body" value={body} onChange={(e) => setBody(e.target.value)} required className="field min-h-72" aria-label="Entry" placeholder="Write freely." />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {supported && (
          <button type="button" onClick={toggleVoice} className={`btn ${listening ? "btn-primary" : "btn-quiet"}`} aria-pressed={listening}>
            {listening ? "Stop dictation" : "Dictate"}
          </button>
        )}
        <button type="button" className="text-ivory-dim hover:text-ivory" onClick={() => setPrompt(PROMPTS[(PROMPTS.indexOf(prompt ?? "") + 1) % PROMPTS.length])}>
          {prompt ? "Another prompt" : "Give me a prompt"}
        </button>
        {voiceError && <span className="text-brass">{voiceError}</span>}
        {listening && <span className="text-emerald">Listening — speech is transcribed by your browser.</span>}
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <Scale name="mood" label="Mood" low="Low" high="Good" value={entry?.mood ?? null} />
        <Scale name="energy" label="Energy" low="Drained" high="Strong" value={entry?.energy ?? null} />
      </div>

      <fieldset>
        <legend className="label">Tags</legend>
        <div className="flex flex-wrap gap-2">
          {JOURNAL_TAGS.map((t) => (
            <label key={t} className="chip cursor-pointer capitalize has-checked:border-emerald has-checked:bg-emerald-deep has-checked:text-ivory">
              <input type="checkbox" name="tags" value={t} defaultChecked={entry?.tags.includes(t)} className="sr-only" />{t}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex items-start gap-3 text-sm text-ivory-dim">
        <input type="checkbox" name="ai_excluded" defaultChecked={entry ? !entry.ai_analysis_allowed : false} className="mt-0.5 size-5 accent-emerald" />
        Keep this entry out of AI analysis, even when AI analysis is on.
      </label>

      {state?.error && <p role="alert" className="text-brass">{state.error}</p>}
      <button className="btn btn-primary w-full" disabled={pending}>{pending ? "Saving…" : "Save entry"}</button>
    </form>
  );
}

function Scale({ name, label, low, high, value }: { name: string; label: string; low: string; high: string; value: number | null }) {
  return (
    <fieldset>
      <legend className="label">{label}</legend>
      <div className="flex items-center gap-2">
        <span className="w-14 text-xs text-ivory-faint">{low}</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="grid size-10 cursor-pointer place-items-center rounded-full border border-line text-sm text-ivory-dim has-checked:border-emerald has-checked:bg-emerald-deep has-checked:text-ivory">
            <input type="radio" name={name} value={n} defaultChecked={value === n} className="sr-only" />{n}
          </label>
        ))}
        <span className="w-14 text-right text-xs text-ivory-faint">{high}</span>
      </div>
    </fieldset>
  );
}
