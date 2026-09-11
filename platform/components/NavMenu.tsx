"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import s from "./NavMenu.module.css";

const LINKS = [
  { href: "/projects", label: "Projects", note: "the floor" },
  { href: "/admin/footage", label: "Footage", note: "archive library" },
  { href: "/admin", label: "Settings", note: "genres, voices" },
];

/**
 * The phone's way into the three sections the bar has no room for at 390px
 * (brand + "New video" already fill it — measured 368 in a 368 box). One
 * button, one panel under the pill, closed by a tap outside, by Escape, or
 * by the navigation it just started. Desktop never renders it: the module
 * hides `.wrap` above 720px and the inline links stay where they were.
 */
export default function NavMenu() {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const ref = useRef<HTMLSpanElement>(null);

  // A route change is the menu having done its job.
  useEffect(() => setOpen(false), [path]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  return (
    <span className={s.wrap} ref={ref}>
      <button
        type="button"
        className={s.btn}
        aria-label="Menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        ) : (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M3.5 6h13M3.5 10h13M3.5 14h13" />
          </svg>
        )}
      </button>
      {open && (
        <span className={s.panel} role="menu">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              role="menuitem"
              className={`${s.link} ${path === l.href || (l.href !== "/admin" && path.startsWith(l.href)) ? s.on : ""}`}
              onClick={() => setOpen(false)}
            >
              {l.label}
              <small>{l.note}</small>
            </Link>
          ))}
        </span>
      )}
    </span>
  );
}
