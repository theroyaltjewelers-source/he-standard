"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { IconMic, IconSpeaker, IconStop } from "./icons";

export interface ChatMessage { role: "user" | "assistant"; text: string; voice?: boolean }
export interface ActionCard {
  key: string;
  tool: string;
  status: "awaiting_confirmation" | "executed" | "failed" | "invalid" | "rejected" | "undone";
  execution_id?: string | null;
  summary?: string;
  reason?: string;
  error?: string;
  ok?: boolean;
  can_undo?: boolean;
  kind?: "read" | "write";
}

type SR = {
  start(): void; stop(): void; abort(): void; continuous: boolean; interimResults: boolean; lang: string;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null;
};

const SUGGESTIONS = [
  "What commitments have I not completed today?",
  "Remind me to call my client in 45 minutes",
  "Help me plan tomorrow",
  "I feel like procrastinating right now",
  "Ask me my evening accountability questions",
  "Show me where I have been inconsistent",
];

const noop = () => () => {};
const getSR = () => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
};

function haptic(on: boolean) {
  if (on && typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(12);
}

export function CoachChat({ initialConversationId, initialMessages, initialActions, aiReady, voiceRepliesDefault, haptics }: {
  initialConversationId: string | null; initialMessages: ChatMessage[]; initialActions: ActionCard[]; aiReady: boolean; voiceRepliesDefault: boolean; haptics: boolean;
}) {
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [actions, setActions] = useState<Record<number, ActionCard[]>>(initialActions.length ? { [Math.max(0, initialMessages.length - 1)]: initialActions } : {});
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [speak, setSpeak] = useState(voiceRepliesDefault);
  const recRef = useRef<SR | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const voiceUsed = useRef(false);
  const srSupported = useSyncExternalStore(noop, () => !!getSR(), () => false);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, busy, interim]);

  const say = useCallback((text: string) => {
    if (!speak || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[*_#`]/g, ""));
    u.rate = 0.98;
    window.speechSynthesis.speak(u);
  }, [speak]);

  const send = useCallback(async (text: string, method: "typed" | "voice") => {
    const t = text.trim();
    if (!t || busy) return;
    setError(null);
    setBusy(true);
    setInput("");
    setInterim("");
    setMessages((m) => [...m, { role: "user", text: t, voice: method === "voice" }]);
    try {
      const res = await fetch("/api/coach", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: t, conversation_id: conversationId, input_method: method, voice_reply: speak }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setConversationId(j.conversation_id);
      setMessages((m) => {
        const next = [...m, { role: "assistant" as const, text: j.reply || "(no reply)" }];
        const cards = (j.actions as Omit<ActionCard, "key">[]).filter((a) => a.kind !== "read" || a.status !== "executed").map((a, i) => ({ ...a, key: `${Date.now()}-${i}` }));
        if (cards.length) setActions((prev) => ({ ...prev, [next.length - 1]: cards }));
        return next;
      });
      say(j.reply ?? "");
    } catch (e) {
      setError(`The Coach couldn't respond: ${(e as Error).message}. Nothing was changed by this message unless a card below says so.`);
    } finally {
      setBusy(false);
    }
  }, [busy, conversationId, speak, say]);

  function toggleMic() {
    const Ctor = getSR();
    if (!Ctor) return;
    if (listening) { recRef.current?.stop(); return; }
    haptic(haptics);
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    const r = new Ctor();
    r.continuous = false;
    r.interimResults = true;
    r.lang = navigator.language || "en-US";
    let finalText = "";
    r.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const seg = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += seg; else live += seg;
      }
      setInterim((finalText + " " + live).trim());
    };
    r.onerror = (e) => setError(e.error === "not-allowed" ? "Microphone access is blocked. Allow it in your browser settings, or type instead." : e.error === "no-speech" ? "I didn't catch anything. Tap the mic and try again." : `Voice input stopped (${e.error}).`);
    r.onend = () => {
      setListening(false);
      const text = finalText.trim();
      if (text) { voiceUsed.current = true; void send(text, "voice"); } else setInterim("");
    };
    recRef.current = r;
    setError(null);
    setInterim("");
    r.start();
    setListening(true);
  }

  async function decide(msgIndex: number, card: ActionCard, decision: "confirm" | "reject") {
    haptic(haptics);
    update(msgIndex, card.key, { status: decision === "confirm" ? card.status : "rejected", summary: card.summary });
    const res = await fetch("/api/coach/decide", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ execution_id: card.execution_id, decision }) });
    const j = await res.json();
    if (!res.ok) { update(msgIndex, card.key, { status: "failed", error: j.error }); return; }
    update(msgIndex, card.key, decision === "reject" ? { status: "rejected", summary: card.summary } : { status: j.ok ? "executed" : "failed", summary: j.summary, can_undo: j.can_undo, error: j.ok ? undefined : j.summary });
    if (decision === "confirm") say(j.summary ?? "");
  }

  async function undoCard(msgIndex: number, card: ActionCard) {
    const res = await fetch("/api/coach/undo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ execution_id: card.execution_id }) });
    const j = await res.json();
    update(msgIndex, card.key, res.ok && j.ok ? { status: "undone", summary: j.summary, can_undo: false } : { error: j.error ?? j.summary ?? "Undo failed" });
  }

  function update(msgIndex: number, key: string, patch: Partial<ActionCard>) {
    setActions((prev) => ({ ...prev, [msgIndex]: (prev[msgIndex] ?? []).map((c) => (c.key === key ? { ...c, ...patch } : c)) }));
  }

  function newConversation() {
    setConversationId(null);
    setMessages([]);
    setActions({});
    setError(null);
  }

  if (!aiReady) {
    return (
      <div className="rounded-[14px] border border-brass-deep p-5 text-ivory-dim">
        <p className="text-ivory">The Coach isn&apos;t connected to Claude yet.</p>
        <p className="mt-2 text-sm">Add an Anthropic API key as <code className="text-ivory">ANTHROPIC_API_KEY</code> in Vercel → Settings → Environment Variables, then redeploy. Until then, everything else in the app works without AI.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-[60dvh] flex-col">
      <div className="mb-4 flex items-center justify-between gap-3 text-sm">
        <button onClick={() => setSpeak((s) => !s)} aria-pressed={speak} className={`chip gap-2 ${speak ? "" : ""}`} data-on={speak}>
          <IconSpeaker width={16} height={16} /> {speak ? "Speaking replies" : "Silent replies"}
        </button>
        {messages.length > 0 && <button onClick={newConversation} className="text-ivory-faint hover:text-ivory-dim">New conversation</button>}
      </div>

      <div className="flex-1 space-y-6" aria-live="polite">
        {messages.length === 0 && !busy && (
          <div className="settle">
            <p className="serif text-2xl leading-snug">Speak naturally. I&apos;ll do the work and tell you exactly what changed.</p>
            <div className="mt-6 flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => <button key={s} onClick={() => send(s, "typed")} className="chip text-left">{s}</button>)}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i}>
            {m.role === "user" ? (
              <p className="ml-auto max-w-[85%] text-right text-ivory-dim"><span className="sr-only">You said: </span>{m.text}</p>
            ) : (
              <div className="serif max-w-prose text-[1.1rem] leading-relaxed whitespace-pre-wrap">{m.text}</div>
            )}
            {(actions[i] ?? []).map((a) => <Card key={a.key} a={a} onDecide={(d) => decide(i, a, d)} onUndo={() => undoCard(i, a)} />)}
          </div>
        ))}
        {interim && <p className="ml-auto max-w-[85%] text-right text-ivory-faint italic">{interim}</p>}
        {busy && <p className="text-sm text-ivory-faint">Working…</p>}
        {error && <p role="alert" className="text-sm text-brass">{error}</p>}
        <div ref={endRef} />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); void send(input, "typed"); }}
        className="sticky bottom-[calc(76px+env(safe-area-inset-bottom))] mt-6 flex items-end gap-2 bg-ground/95 py-3 backdrop-blur lg:bottom-0">
        <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input, "typed"); } }}
          className="field max-h-40 min-h-[48px] resize-none font-sans text-base" placeholder={listening ? "Listening…" : "Type, or tap the microphone"} aria-label="Message the Coach" disabled={busy} />
        {srSupported && (
          <button type="button" onClick={toggleMic} disabled={busy} aria-pressed={listening} aria-label={listening ? "Stop listening" : "Speak to the Coach"}
            className={`grid size-12 shrink-0 place-items-center rounded-full border transition-colors ${listening ? "border-emerald bg-emerald text-[var(--on-emerald)]" : "border-line bg-surface"}`}>
            {listening ? <IconStop /> : <IconMic />}
          </button>
        )}
        <button className="btn btn-primary h-12 shrink-0" disabled={busy || !input.trim()}>Send</button>
      </form>
      {!srSupported && <p className="text-xs text-ivory-faint">Voice input isn&apos;t available in this browser. On iPhone it works in Safari; elsewhere use Chrome or Edge.</p>}
    </div>
  );
}

function Card({ a, onDecide, onUndo }: { a: ActionCard; onDecide: (d: "confirm" | "reject") => void; onUndo: () => void }) {
  const tone =
    a.status === "awaiting_confirmation" ? "border-emerald" :
    a.status === "executed" ? "border-line" :
    a.status === "undone" || a.status === "rejected" ? "border-line opacity-70" : "border-brass-deep";
  const label =
    a.status === "awaiting_confirmation" ? "Needs your confirmation" :
    a.status === "executed" ? "Done" : a.status === "undone" ? "Undone" : a.status === "rejected" ? "Cancelled" : "Didn't happen";
  return (
    <div className={`mt-3 max-w-prose rounded-[12px] border ${tone} bg-surface p-3.5 text-sm`}>
      <p className={`text-xs ${a.status === "executed" ? "text-emerald" : a.status === "awaiting_confirmation" ? "text-ivory" : "text-ivory-faint"}`}>{label}</p>
      <p className="mt-1">{a.summary ?? a.error ?? a.tool}</p>
      {a.reason && a.status === "awaiting_confirmation" && <p className="mt-1 text-ivory-faint">{a.reason}</p>}
      {a.error && a.status !== "awaiting_confirmation" && a.summary && <p className="mt-1 text-brass">{a.error}</p>}
      {a.status === "awaiting_confirmation" && (
        <div className="mt-3 flex gap-2">
          <button onClick={() => onDecide("confirm")} className="btn btn-primary">Confirm</button>
          <button onClick={() => onDecide("reject")} className="btn btn-quiet">Cancel</button>
        </div>
      )}
      {a.status === "executed" && a.can_undo && <button onClick={onUndo} className="mt-2 text-xs text-ivory-faint underline-offset-4 hover:text-ivory-dim hover:underline">Undo</button>}
    </div>
  );
}
