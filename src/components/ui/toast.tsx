"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * Minimal toast system: confirmations appear only after the server has
 * confirmed the change, and can carry an Undo action.
 */
export interface ToastItem { id: number; text: string; tone?: "ok" | "error"; action?: { label: string; run: () => void | Promise<void> } }

let items: ToastItem[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let seq = 0;

export function toast(t: Omit<ToastItem, "id">, ms = 5000) {
  const id = ++seq;
  items = [...items.slice(-2), { ...t, id }];
  emit();
  setTimeout(() => dismiss(id), ms);
  return id;
}
export function dismiss(id: number) {
  items = items.filter((x) => x.id !== id);
  emit();
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => items;
const empty: ToastItem[] = [];

export function Toaster() {
  const list = useSyncExternalStore(subscribe, snapshot, () => empty);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-50 flex flex-col items-center gap-2 px-4 lg:bottom-6">
      {list.map((t) => <ToastView key={t.id} t={t} />)}
    </div>
  );
}

function ToastView({ t }: { t: ToastItem }) {
  const [busy, setBusy] = useState(false);
  useEffect(() => () => setBusy(false), []);
  return (
    <div role="status" className={`toast-in pointer-events-auto flex min-h-11 max-w-md items-center gap-3 rounded-full border px-4 py-2 text-sm shadow-[0_12px_40px_-12px_rgb(0_0_0/0.6)] ${t.tone === "error" ? "border-brass/60 bg-brass-deep text-ivory" : "border-line-strong bg-surface-2 text-ivory"}`}>
      {t.tone !== "error" && (
        <svg className="check-draw shrink-0 text-emerald" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden><path d="M5 12.5l4 4 10-10" /></svg>
      )}
      <span>{t.text}</span>
      {t.action && (
        <button disabled={busy} className="font-semibold text-accent disabled:opacity-50" onClick={async () => { setBusy(true); await t.action!.run(); dismiss(t.id); }}>
          {t.action.label}
        </button>
      )}
    </div>
  );
}
