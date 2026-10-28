"use client";

import { useEffect, useId, useRef } from "react";

/**
 * Modal sheet on a native <dialog>: focus is trapped while open and returned to
 * the opener on close; Escape and backdrop clicks ask the owner to close
 * (`onRequestClose`), so it can protect unsaved input. Bottom sheet on phones,
 * centred panel on larger screens. Content scrolls inside; the footer stays
 * reachable.
 */
export function Sheet({ open, title, description, onRequestClose, children, footer, size = "md" }: {
  open: boolean; title: string; description?: string; onRequestClose: () => void;
  children: React.ReactNode; footer?: React.ReactNode; size?: "sm" | "md";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement as HTMLElement | null;
      d.showModal();
    } else if (!open && d.open) {
      d.close();
      opener.current?.focus?.();
    }
  }, [open]);
  // Unmounting while open (e.g. the owner removed the sheet after saving): close and return focus.
  useEffect(() => {
    const d = ref.current;
    return () => { if (d?.open) { d.close(); const o = opener.current; setTimeout(() => o?.focus?.(), 0); } };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`sheet ${size === "sm" ? "sheet-sm" : ""}`}
      aria-labelledby={`${id}-t`}
      aria-describedby={description ? `${id}-d` : undefined}
      onCancel={(e) => { e.preventDefault(); onRequestClose(); }}
      // Browsers may close a dialog without a cancelable "cancel" (e.g. a
      // repeated Escape without user activation). Keep it open and let the
      // owner decide, so typed input is never lost.
      onClose={() => { if (open && ref.current && !ref.current.open) { ref.current.showModal(); onRequestClose(); } }}
      onClick={(e) => { if (e.target === e.currentTarget) onRequestClose(); }}
    >
      {open && (
        <div className="flex max-h-[inherit] flex-col">
          <header className="flex items-start justify-between gap-3 px-5 pb-2 pt-5">
            <div className="min-w-0">
              <h2 id={`${id}-t`} className="text-lg font-semibold tracking-tight">{title}</h2>
              {description && <p id={`${id}-d`} className="mt-1 text-sm text-ivory-dim">{description}</p>}
            </div>
            <button type="button" onClick={onRequestClose} className="icon-btn -mr-2 -mt-1" aria-label="Close">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4 pt-2">{children}</div>
          {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
