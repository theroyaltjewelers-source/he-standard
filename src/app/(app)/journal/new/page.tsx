import { requireUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { JournalForm } from "@/components/journal-form";

export const metadata = { title: "New entry" };

export default async function NewEntry() {
  const { today } = await requireUser();
  return (
    <>
      <PageHeader back="/journal" title="New entry" />
      <JournalForm today={today} />
    </>
  );
}
