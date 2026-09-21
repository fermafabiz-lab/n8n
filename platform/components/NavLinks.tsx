"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SECTIONS, isOn } from "@/lib/nav";

/**
 * The section links in the bar, on a laptop. Under 720px globals.css hides
 * them (`.nav a.navlink { display: none }`) and `NavMenu` folds the same list
 * behind one button.
 *
 * It is a client component for one reason: the bar used to carry
 * `className="navlink on"` on Projects as a LITERAL, so the site said "you are
 * on Projects" while you stood in Settings. Knowing where you are needs the
 * current path, and the path is only knowable in the browser.
 */
export default function NavLinks() {
  const path = usePathname() ?? "";
  return (
    <>
      {SECTIONS.map((section) => (
        <Link
          key={section.href}
          href={section.href}
          className={isOn(section.href, path) ? "navlink on" : "navlink"}
          aria-current={isOn(section.href, path) ? "page" : undefined}
        >
          {section.label}
        </Link>
      ))}
    </>
  );
}
