import Link from "next/link";
import { MORE_LINKS } from "@/components/nav-links";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "More" };

export default function More() {
  return (
    <>
      <PageHeader title="More" />
      <ul className="divide-y divide-line">
        {MORE_LINKS.map(({ href, label, Icon }) => (
          <li key={href}>
            <Link href={href} className="flex items-center gap-4 py-4 text-lg"><Icon className="text-ivory-dim" />{label}</Link>
          </li>
        ))}
      </ul>
      <form action="/auth/signout" method="post" className="mt-10">
        <button className="text-ivory-faint hover:text-ivory-dim">Sign out</button>
      </form>
    </>
  );
}
