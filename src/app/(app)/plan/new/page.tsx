import { requireUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { EventForm } from "@/components/event-form";

export const metadata = { title: "New appointment" };

export default async function NewEvent({ searchParams }: PageProps<"/plan/new">) {
  const sp = await searchParams;
  const { today } = await requireUser();
  const date = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  return (
    <>
      <PageHeader back={`/plan?date=${date}`} title="New appointment" />
      <EventForm initial={{
        title: "", date, time: "", duration: 60, all_day: false, location: "", notes: "", importance: "normal",
        prep_minutes: 15, travel_minutes: 0, offsets: [60], recurrence: "none", recurrence_until: "", confirmed: false,
      }} />
    </>
  );
}
