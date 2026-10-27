import { Nav } from "@/components/nav";
import { ServiceWorker } from "@/components/service-worker";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Nav />
      <ServiceWorker />
      <div className="lg:pl-60">
        <main className="mx-auto max-w-2xl px-5 pt-[calc(env(safe-area-inset-top)+2rem)] pb-32 lg:px-10 lg:pt-12 lg:pb-16">
          {children}
        </main>
      </div>
    </>
  );
}
