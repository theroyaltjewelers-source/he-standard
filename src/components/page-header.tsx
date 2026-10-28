import Link from "next/link";
import { IconArrowLeft } from "./icons";

export function PageHeader({ title, subtitle, back, action, eyebrow }: {
  title: string; subtitle?: React.ReactNode; back?: string; action?: React.ReactNode; eyebrow?: string;
}) {
  return (
    <header className="mb-8">
      {back && (
        <Link href={back} className="-ml-1 mb-3 inline-flex min-h-11 items-center gap-1 text-sm text-ivory-dim hover:text-ivory">
          <IconArrowLeft width={18} height={18} /> Back
        </Link>
      )}
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
          <h1 className="h-page">{title}</h1>
          {subtitle && <p className="mt-1.5 text-ivory-dim">{subtitle}</p>}
        </div>
        {action}
      </div>
    </header>
  );
}

export function Empty({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-[14px] border border-dashed border-line px-5 py-8 text-center text-ivory-dim">
      <p>{children}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
