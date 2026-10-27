"use client";

/** Submit button that asks for confirmation before an irreversible action. */
export function ConfirmButton({ message, children, className = "btn btn-danger" }: { message: string; children: React.ReactNode; className?: string }) {
  return (
    <button className={className} onClick={(e) => { if (!window.confirm(message)) e.preventDefault(); }}>
      {children}
    </button>
  );
}
