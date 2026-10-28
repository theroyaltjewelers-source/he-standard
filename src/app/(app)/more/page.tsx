import Link from "next/link";
import { MORE_LINKS } from "@/components/nav-links";
import { IconJournal } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { SignOutButton } from "@/components/service-worker";

export const metadata = { title: "More" };

export default function More() {
  const links = [{ href: "/journal", label: "Reflection", Icon: IconJournal }, ...MORE_LINKS];
  return (
    <>
      <PageHeader title="More" />
      <ul className="divide-y divide-line">
        {links.map(({ href, label, Icon }) => (
          <li key={href}><Link href={href} className="flex items-center gap-4 py-4 text-lg"><Icon className="text-ivory-dim" />{label}</Link></li>
        ))}
      </ul>
      <SignOutButton className="mt-10"><button className="min-h-11 text-ivory-faint hover:text-ivory-dim">Sign out</button></SignOutButton>
    </>
  );
}
