import { requireUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { PasswordForm } from "./form";

export const metadata = { title: "Password" };

export default async function Password() {
  await requireUser({ allowIncomplete: true });
  return (
    <>
      <PageHeader back="/settings" title="Change password" />
      <PasswordForm />
    </>
  );
}
