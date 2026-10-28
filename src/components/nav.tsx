"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconMore } from "./icons";
import { PRIMARY, SECONDARY } from "./nav-links";

function isActive(path: string, href: string) {
  if (href === "/journal") return path.startsWith("/journal") || path.startsWith("/reflection");
  if (href === "/word") return path.startsWith("/word") || path.startsWith("/tasks") || path.startsWith("/checkin");
  return path === href || path.startsWith(href + "/");
}

/** Desktop side rail. */
export function Nav() {
  const path = usePathname();
  return (
    <>
      <nav aria-label="Main" className="fixed inset-y-0 left-0 hidden w-60 flex-col overflow-y-auto border-r border-line px-5 py-8 lg:flex">
        <Link href="/today" className="serif mb-10 px-3 text-2xl font-light">The Standard</Link>
        <ul className="space-y-1">
          {PRIMARY.map(({ href, label, Icon }) => (
            <li key={href}>
              <Link href={href} aria-current={isActive(path, href) ? "page" : undefined}
                className="flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-ivory-dim hover:text-ivory aria-[current=page]:bg-surface aria-[current=page]:text-ivory">
                <Icon width={20} height={20} />{label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="my-5 h-px bg-line" />
        <ul className="space-y-1">
          {SECONDARY.map(({ href, label, Icon }) => (
            <li key={href}>
              <Link href={href} aria-current={isActive(path, href) ? "page" : undefined}
                className="flex items-center gap-3 rounded-[10px] px-3 py-2 text-[0.95rem] text-ivory-faint hover:text-ivory aria-[current=page]:bg-surface aria-[current=page]:text-ivory">
                <Icon width={18} height={18} />{label}
              </Link>
            </li>
          ))}
        </ul>
        <form action="/auth/signout" method="post" className="mt-auto px-3 pt-6">
          <button className="text-sm text-ivory-faint hover:text-ivory-dim">Sign out</button>
        </form>
      </nav>

    </>
  );
}

/**
 * Phone tab bar. It is the last element of the page and sticks to the bottom
 * (position: sticky, not fixed): iOS Safari mis-places fixed bottom bars while
 * its toolbar collapses during scrolling, leaving the bar floating mid-screen.
 */
export function MobileNav() {
  const path = usePathname();
  const moreActive = SECONDARY.some((s) => isActive(path, s.href)) || path === "/more" || path.startsWith("/goals");
  const mobile = [...PRIMARY.slice(0, 2), PRIMARY[2], PRIMARY[3], { href: "/more", label: "More", Icon: IconMore }];
  return (
    <nav aria-label="Main" className="sticky bottom-0 z-40 border-t border-line bg-ground pb-[env(safe-area-inset-bottom)] lg:hidden">
        <ul className="mx-auto grid max-w-xl grid-cols-5 items-end">
          {mobile.map(({ href, label, Icon }) => {
            const active = href === "/more" ? moreActive || path.startsWith("/journal") : isActive(path, href);
            const center = href === "/coach";
            return (
              <li key={href}>
                <Link href={href} aria-current={active ? "page" : undefined}
                  className="flex min-h-[60px] flex-col items-center justify-center gap-1 text-[11px] text-ivory-faint aria-[current=page]:text-ivory">
                  {center ? (
                    <span className={`-mt-5 grid size-12 place-items-center rounded-full border ${active ? "border-lime bg-lime text-[var(--on-lime)]" : "border-line bg-surface text-ivory"}`}>
                      <Icon />
                    </span>
                  ) : (
                    <Icon className={active ? "text-emerald" : ""} />
                  )}
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
    </nav>
  );
}
