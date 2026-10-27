import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { OnboardingForm } from "./form";

export const metadata = { title: "Set up" };

export default async function Onboarding() {
  const { profile } = await requireUser({ allowIncomplete: true });
  if (profile.onboarding_completed_at) redirect("/today");
  return (
    <main className="mx-auto max-w-xl px-5 py-12">
      <div className="mb-6 h-px w-16 bg-emerald" aria-hidden />
      <h1 className="h-page">Set your standard</h1>
      <p className="serif mt-3 mb-10 text-lg text-ivory-dim">
        A few settings so reminders arrive at the right times and questions fit what you&apos;re working on. Everything here can be changed later.
      </p>
      <OnboardingForm profile={profile} />
    </main>
  );
}
