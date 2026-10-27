import { requireUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { JournalForm } from "@/components/journal-form";
import { GUIDED_MODES, type GuidedMode } from "@/lib/reflection";

export const metadata = { title: "New entry" };

export default async function NewEntry({ searchParams }: PageProps<"/journal/new">) {
  const sp = await searchParams;
  const { today } = await requireUser();
  const mode = GUIDED_MODES.some((m) => m.key === sp.mode) ? (sp.mode as GuidedMode) : undefined;
  return (
    <>
      <PageHeader back="/journal" title="New entry" />
      <JournalForm today={today} initialMode={mode} />
    </>
  );
}
