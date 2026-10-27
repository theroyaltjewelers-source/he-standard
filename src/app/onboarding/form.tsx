"use client";

import { useActionState } from "react";
import { completeOnboarding, type FormState } from "@/app/actions/profile";
import { ProfileFields } from "@/components/profile-fields";
import type { Profile } from "@/lib/types";

export function OnboardingForm({ profile }: { profile: Profile }) {
  const [state, action, pending] = useActionState<FormState, FormData>(completeOnboarding, undefined);
  return (
    <form action={action} className="space-y-10">
      <ProfileFields profile={profile} />
      {state?.error && <p role="alert" className="text-brass">{state.error}</p>}
      <button className="btn btn-primary w-full" disabled={pending}>{pending ? "Saving…" : "Begin"}</button>
    </form>
  );
}
