import { requireUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { GoalForm } from "@/components/goal-forms";

export const metadata = { title: "New goal" };

export default async function NewGoal() {
  const { supabase } = await requireUser();
  const { data } = await supabase.from("goals").select("id,title").eq("status", "active").eq("horizon", "long_term");
  return (
    <>
      <PageHeader back="/goals" title="New goal" />
      <GoalForm parents={data ?? []} />
    </>
  );
}
