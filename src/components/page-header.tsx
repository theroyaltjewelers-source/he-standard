import Link from "next/link";
import { IconArrowLeft } from "./icons";

export function PageHeader({ title, subtitle, back, action }: {
  title: string; subtitle?: React.ReactNode; back?: string; action?: React.ReactNode;
}) {
  return (
    <header className="mb-8">
      {back && (
        <Link href={back} className="-ml-1 mb-4 inline-flex items-center gap-1 text-sm text-ivory-dim hover:text-ivory">
          <IconArrowLeft width={18} height={18} /> Back
        </Link>
      )}
      <div className="flex items-end justify-between gap-4">
        <div>
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
