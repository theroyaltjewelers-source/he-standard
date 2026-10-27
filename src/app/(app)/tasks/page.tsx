import { redirect } from "next/navigation";

export default async function Tasks({ searchParams }: PageProps<"/tasks">) {
  const sp = await searchParams;
  redirect(sp.show === "done" ? "/word?show=done" : "/word");
}
