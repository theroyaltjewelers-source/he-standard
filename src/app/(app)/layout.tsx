import { Nav } from "@/components/nav";
import { ServiceWorker } from "@/components/service-worker";
import { Toaster } from "@/components/ui/toast";
import { DayWatcher } from "@/components/day-watcher";
import { requireUser } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile, today } = await requireUser({ allowIncomplete: true });
  return (
    <>
      <Nav />
      <ServiceWorker />
      <Toaster />
      <div className="lg:pl-60">
        <main className="mx-auto max-w-6xl px-4 sm:px-5 pt-[calc(env(safe-area-inset-top)+2rem)] pb-32 lg:px-10 lg:pt-12 lg:pb-16">
          <DayWatcher timeZone={profile.timezone} today={today} />
          {children}
        </main>
      </div>
    </>
  );
}
