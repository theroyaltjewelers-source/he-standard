import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { GoalForm } from "@/components/goal-forms";
import type { Goal } from "@/lib/types";

export const metadata = { title: "Edit goal" };

export default async function EditGoal({ params }: PageProps<"/goals/[id]/edit">) {
  const { id } = await params;
  const { supabase } = await requireUser();
  const { data: goal } = await supabase.from("goals").select("*").eq("id", id).maybeSingle<Goal>();
  if (!goal) notFound();
  const { data } = await supabase.from("goals").select("id,title").eq("status", "active").eq("horizon", "long_term");
  return (
    <>
      <PageHeader back={`/goals/${id}`} title="Edit goal" />
      <GoalForm goal={goal} parents={data ?? []} />
    </>
  );
}
