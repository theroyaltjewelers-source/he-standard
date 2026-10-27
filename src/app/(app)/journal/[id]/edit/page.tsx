import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { JournalForm } from "@/components/journal-form";
import type { JournalEntry } from "@/lib/types";

export const metadata = { title: "Edit entry" };

export default async function EditEntry({ params }: PageProps<"/journal/[id]/edit">) {
  const { id } = await params;
  const { supabase, today } = await requireUser();
  const { data } = await supabase.from("journal_entries").select("*").eq("id", id).maybeSingle<JournalEntry>();
  if (!data) notFound();
  return (
    <>
      <PageHeader back={`/journal/${id}`} title="Edit entry" />
      <JournalForm entry={data} today={today} />
    </>
  );
}
