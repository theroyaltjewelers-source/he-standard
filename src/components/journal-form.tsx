"use client";

import { useActionState, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { saveJournal, type JournalState } from "@/app/actions/journal";
import { JOURNAL_MAX_CHARS } from "@/lib/journal-limits";
import { JOURNAL_TAGS, type JournalEntry } from "@/lib/types";
import { GUIDED_MODES, composeGuided, type GuidedMode } from "@/lib/reflection";

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

type Draft = { title: string; body: string; answers: string[]; mode: GuidedMode; savedAt: number };
const draftKey = (id?: string) => `standard:journal-draft:${id ?? "new"}`;
function readDraft(key: string): Draft | null {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as Draft) : null; } catch { return null; }
}

export function JournalForm({ entry, today, initialMode }: { entry?: JournalEntry; today: string; initialMode?: GuidedMode }) {
  const router = useRouter();
  const key = draftKey(entry?.id);
  // Every keystroke is kept on this device until the server confirms the save,
  // so a crash, a lost connection or a closed tab never loses an entry.
  const [state, action, pending] = useActionState<JournalState, FormData>(async (prev, form) => {
    writeDraft();
    try {
      return await saveJournal(prev, form);
    } catch {
      return { error: "Couldn't reach the server. Your text is safe on this device — try Save again." };
    }
  }, undefined);
  const [title, setTitle] = useState(entry?.title ?? "");
  const [body, setBody] = useState(entry?.body ?? "");
  const [mode, setMode] = useState<GuidedMode>((entry?.guided_mode as GuidedMode) ?? initialMode ?? "free");
  const [answers, setAnswers] = useState<string[]>([]);
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const saved = useRef(false);
  const dirty = title !== (entry?.title ?? "") || body !== (entry?.body ?? "") || answers.some((a) => a?.trim());
  const latest = useRef({ title, body, answers, mode, dirty });
  latest.current = { title, body, answers, mode, dirty };

  function writeDraft() {
    const l = latest.current;
    try {
      if (!l.dirty || saved.current) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify({ title: l.title, body: l.body, answers: l.answers, mode: l.mode, savedAt: Date.now() } satisfies Draft));
    } catch { /* storage full or blocked: the server save still works */ }
  }

  // Restore an unsaved draft once, after hydration.
  useEffect(() => {
    const d = readDraft(key);
    if (!d || (d.body === (entry?.body ?? "") && d.title === (entry?.title ?? "") && !d.answers?.some((a) => a?.trim()))) return;
    /* eslint-disable react-hooks/set-state-in-effect -- one-time restore from device storage */
    setTitle(d.title ?? ""); setBody(d.body ?? ""); setAnswers(d.answers ?? []);
    if (!entry && d.mode) setMode(d.mode);
    setRestoredAt(d.savedAt);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [key, entry]);

  // Keep the draft current: shortly after typing stops, and immediately when
  // the app is backgrounded or closed (phones can discard a hidden tab).
  useEffect(() => {
    const t = setTimeout(writeDraft, 400);
    return () => clearTimeout(t);
  });
  useEffect(() => {
    const flush = () => writeDraft();
    const warn = (e: BeforeUnloadEvent) => { writeDraft(); if (latest.current.dirty && !saved.current) e.preventDefault(); };
    const onHide = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", warn);
    return () => { document.removeEventListener("visibilitychange", onHide); window.removeEventListener("pagehide", flush); window.removeEventListener("beforeunload", warn); };
  });

  // Saved on the server: drop the local copy, then open the entry.
  useEffect(() => {
    if (!state?.savedId) return;
    saved.current = true;
    try { localStorage.removeItem(key); } catch { /* ignore */ }
    router.push(`/journal/${state.savedId}`);
  }, [state, key, router]);

  function discardDraft() {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
    setTitle(entry?.title ?? ""); setBody(entry?.body ?? ""); setAnswers([]); setRestoredAt(null);
  }
  const guided = !entry && mode !== "free";
  const modeDef = GUIDED_MODES.find((m) => m.key === mode)!;
  const finalBody = guided ? composeGuided(mode, answers, body) : body;
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
      {restoredAt && (
        <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[14px] border border-emerald/50 bg-surface p-3 text-sm">
          <span>Restored your unsaved writing from {new Date(restoredAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.</span>
          <button type="button" className="text-ivory-faint hover:text-ivory-dim" onClick={discardDraft}>Discard it</button>
        </div>
      )}
      {entry && <input type="hidden" name="id" value={entry.id} />}
      <input type="hidden" name="input_method" value={voiceUsed ? "voice" : "typed"} />
      <input type="hidden" name="guided_mode" value={mode} />
      {!entry && (
        <fieldset>
          <legend className="label">Mode</legend>
          <div className="flex flex-wrap gap-2">
            {GUIDED_MODES.map((m) => <button type="button" key={m.key} className="chip" data-on={mode === m.key} onClick={() => setMode(m.key)}>{m.label}</button>)}
          </div>
          {mode !== "free" && <p className="mt-2 text-sm text-ivory-faint">{modeDef.desc} Answer any you like; skip the rest.</p>}
        </fieldset>
      )}
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <input name="title" value={title} onChange={(e) => setTitle(e.target.value)} className="field serif" placeholder="Title (optional)" maxLength={200} aria-label="Title" />
        <input type="date" name="entry_date" defaultValue={entry?.entry_date ?? today} className="field" aria-label="Date" />
      </div>
      {guided && modeDef.prompts.map((p, i) => (
        <label key={p} className="block">
          <span className="serif mb-2 block text-lg leading-snug">{p}</span>
          <textarea value={answers[i] ?? ""} onChange={(e) => setAnswers((a) => { const n = [...a]; n[i] = e.target.value; return n; })} className="field min-h-24" />
        </label>
      ))}
      {!guided && prompt && <p className="serif border-l-2 border-emerald pl-4 text-lg text-ivory-dim italic">{prompt}</p>}
      {guided && <input type="hidden" name="body" value={finalBody} />}
      <textarea name={guided ? undefined : "body"} value={body} onChange={(e) => setBody(e.target.value)} required={!guided} maxLength={JOURNAL_MAX_CHARS} className={`field reading text-[1.075rem] ${guided ? "min-h-28" : "min-h-72"}`} aria-label={guided ? "Anything else" : "Entry"} placeholder={guided ? "Anything else (optional)" : "Write freely."} />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {supported && (
          <button type="button" onClick={toggleVoice} className={`btn ${listening ? "btn-primary" : "btn-quiet"}`} aria-pressed={listening}>
            {listening ? "Stop dictation" : "Dictate"}
          </button>
        )}
        {!guided && <button type="button" className="text-ivory-dim hover:text-ivory" onClick={() => setPrompt(PROMPTS[(PROMPTS.indexOf(prompt ?? "") + 1) % PROMPTS.length])}>
          {prompt ? "Another prompt" : "Give me a prompt"}
        </button>}
        {voiceError && <span className="text-brass">{voiceError}</span>}
        {listening && <span className="text-emerald">Listening — speech is transcribed by your browser.</span>}
        {finalBody.length > 20000 && (
          <span className="ml-auto tabular-nums text-ivory-faint">{finalBody.length.toLocaleString()} / {JOURNAL_MAX_CHARS.toLocaleString()} characters</span>
        )}
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
      <button className="btn btn-primary w-full" disabled={pending || !!state?.savedId || (guided && !finalBody)} data-state={pending || state?.savedId ? "loading" : undefined}>{pending || state?.savedId ? "Saving…" : "Save entry"}</button>
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
