import { requireUser } from "@/lib/session";
import { formatLocalDate, shiftDate } from "@/lib/time";
import { PageHeader, Empty } from "@/components/page-header";
import { MoneyForm } from "@/components/money-form";
import { deleteEntry, markBillPaid } from "@/app/actions/money";
import type { FinancialEntry } from "@/lib/types";

export const metadata = { title: "Money" };
const fmt = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const KIND = { income: "Earned", expense: "Spent", bill: "Bill", debt_payment: "Debt payment", savings: "Saved" } as const;

export default async function Money() {
  const { supabase, today } = await requireUser();
  const from = shiftDate(today, -29);
  const [{ data: recent }, { data: bills }] = await Promise.all([
    supabase.from("financial_entries").select("*").neq("kind", "bill").gte("entry_date", from).order("entry_date", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("financial_entries").select("*").eq("kind", "bill").order("due_date"),
  ]);
  const es = ((recent ?? []) as FinancialEntry[]).map((e) => ({ ...e, amount: Number(e.amount) }));
  const bs = ((bills ?? []) as FinancialEntry[]).map((e) => ({ ...e, amount: Number(e.amount) }));
  const sum = (xs: typeof es) => xs.reduce((n, e) => n + e.amount, 0);
  const spent = es.filter((e) => e.kind === "expense");
  const by = (scope: "personal" | "business") => ({
    in: sum(es.filter((e) => e.scope === scope && e.kind === "income")),
    out: sum(es.filter((e) => e.scope === scope && (e.kind === "expense" || e.kind === "debt_payment"))),
  });
  const p = by("personal"), b = by("business");
  const disc = spent.filter((e) => e.discretionary);
  const unpaid = bs.filter((x) => !x.paid);
  const daysLogged = new Set(es.map((e) => e.entry_date)).size;

  return (
    <>
      <PageHeader title="Money" subtitle="Manual records only. No bank connections, no credentials." />
      <section className="mb-12"><MoneyForm today={today} /></section>

      <section className="mb-12">
        <h2 className="h-section mb-3">Last 30 days</h2>
        <dl className="grid grid-cols-2 gap-3">
          {[
            { k: "Personal", v: `${fmt(p.in)} in`, sub: `${fmt(p.out)} out` },
            { k: "Business", v: `${fmt(b.in)} in`, sub: `${fmt(b.out)} out` },
            { k: "Discretionary", v: fmt(sum(disc)), sub: `${disc.length} of ${spent.length} purchases` },
            { k: "Saved / debt paid", v: fmt(sum(es.filter((e) => e.kind === "savings"))), sub: `${fmt(sum(es.filter((e) => e.kind === "debt_payment")))} toward debt` },
          ].map((x) => (
            <div key={x.k} className="rounded-[12px] border border-line p-3">
              <dt className="text-xs text-ivory-faint">{x.k}</dt>
              <dd className="serif mt-1 text-xl tabular-nums">{x.v}</dd>
              <dd className="text-xs text-ivory-faint">{x.sub}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-xs text-ivory-faint">Based on {es.length} entries across {daysLogged} days. Totals only include what you recorded.</p>
      </section>

      <section className="mb-12">
        <h2 className="h-section mb-2">Bills</h2>
        {bs.length === 0 ? <Empty>No bills recorded.</Empty> : (
          <ul className="divide-y divide-line">
            {[...unpaid, ...bs.filter((x) => x.paid).slice(0, 5)].map((x) => {
              const overdue = !x.paid && !!x.due_date && x.due_date < today;
              return (
                <li key={x.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className={x.paid ? "text-ivory-dim line-through decoration-ivory-faint" : ""}>{x.description || x.category || "Bill"} <span className="text-ivory-faint">· {fmt(x.amount)}</span></p>
                    <p className={`text-sm ${overdue ? "text-brass" : "text-ivory-faint"}`}>{x.due_date ? `${overdue ? "Was due" : "Due"} ${formatLocalDate(x.due_date, "MMM d")}` : ""}{x.scope === "business" ? " · Business" : ""}</p>
                  </div>
                  <form action={markBillPaid}>
                    <input type="hidden" name="id" value={x.id} />
                    <input type="hidden" name="paid" value={String(!x.paid)} />
                    <button className="chip" data-on={!!x.paid}>{x.paid ? "Paid" : "Mark paid"}</button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="h-section mb-2">Entries</h2>
        {es.length === 0 ? <Empty>Nothing recorded in the last 30 days.</Empty> : (
          <ul className="divide-y divide-line">
            {es.map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p>{e.description || e.category || KIND[e.kind]}</p>
                  <p className="text-sm text-ivory-faint">
                    {formatLocalDate(e.entry_date, "MMM d")} · {KIND[e.kind]} · {e.scope === "business" ? "Business" : "Personal"}
                    {e.discretionary && <span className="text-brass"> · discretionary</span>}
                  </p>
                  {e.reflection && <p className="text-sm text-ivory-dim">{e.reflection}</p>}
                </div>
                <div className="flex shrink-0 flex-col items-end">
                  <span className={`tabular-nums ${e.kind === "income" ? "text-emerald" : ""}`}>{e.kind === "income" ? "+" : ""}{fmt(e.amount)}</span>
                  <form action={deleteEntry}><input type="hidden" name="id" value={e.id} /><button className="text-xs text-ivory-faint hover:text-ivory-dim">Delete</button></form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
