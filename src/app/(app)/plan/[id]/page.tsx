import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { formatInZone, localDateString } from "@/lib/time";
import { ConfirmButton } from "@/components/confirm-button";
import { PageHeader } from "@/components/page-header";
import { EventForm } from "@/components/event-form";
import { deleteEvent } from "@/app/actions/events";
import type { CalendarEvent, Reminder } from "@/lib/types";

export const metadata = { title: "Appointment" };

export default async function EditEvent({ params }: PageProps<"/plan/[id]">) {
  const { id } = await params;
  const { supabase, profile } = await requireUser();
  const { data: ev } = await supabase.from("events").select("*").eq("id", id).maybeSingle<CalendarEvent>();
  if (!ev) notFound();
  const { data: rem } = await supabase.from("reminders").select("*").eq("entity_type", "event").eq("entity_id", id)
    .order("send_at", { ascending: false }).limit(12);
  const tz = profile.timezone;
  const start = new Date(ev.starts_at);
  const date = localDateString(start, tz);

  return (
    <>
      <PageHeader back={`/plan?date=${date}`} title={ev.title} />
      <EventForm initial={{
        id: ev.id, title: ev.title, date, time: ev.all_day ? "" : formatInZone(start, tz, "HH:mm"),
        duration: ev.ends_at ? Math.round((Date.parse(ev.ends_at) - start.getTime()) / 60000) : 60,
        all_day: ev.all_day, location: ev.location ?? "", notes: ev.notes ?? "", importance: ev.importance,
        prep_minutes: ev.prep_minutes, travel_minutes: ev.travel_minutes, offsets: ev.reminder_offsets,
        recurrence: ev.recurrence, recurrence_until: ev.recurrence_until ?? "", confirmed: !!ev.plan_confirmed_at,
        kind: ev.kind ?? "appointment", accountability: ev.accountability ?? "light",
      }} />

      <section className="mt-12">
        <h2 className="h-section mb-2">Reminders for this appointment</h2>
        {(rem ?? []).length ? (
          <ul className="divide-y divide-line text-sm">
            {(rem as Reminder[]).map((r) => (
              <li key={r.id} className="flex justify-between gap-3 py-2">
                <span>{formatInZone(r.send_at, tz, "EEE MMM d, h:mm a")} <span className="text-ivory-dim">{r.title}</span></span>
                <span className="text-ivory-faint">{r.status === "sent" ? "accepted by push service" : r.status.replace("_", " ")}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-ivory-dim">No reminders — every reminder time is already in the past.</p>}
      </section>

      <form action={deleteEvent} className="mt-12">
        <input type="hidden" name="id" value={ev.id} />
        <ConfirmButton message="Delete this appointment and its reminders?">Delete appointment</ConfirmButton>
      </form>
    </>
  );
}
