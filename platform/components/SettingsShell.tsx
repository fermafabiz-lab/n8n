import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The frame every Settings section sits in: the way back, the tracked
 * eyebrow that says which section this is, the title, one line of what it
 * is for. A component and not an app/admin/layout.tsx on purpose — the
 * footage library lives under /admin too and carries its own header.
 */
export default function SettingsShell({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <main className="page admin settings">
      <Link href="/admin" className="sback">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 4l-6 6 6 6" />
        </svg>
        Settings
      </Link>
      <div className="sechead">
        <h2>{title}</h2>
        <p>{intro}</p>
      </div>
      {children}
    </main>
  );
}

/** What a section that exists but holds nothing yet says about itself. */
export function NothingHereYet({ what }: { what: string }) {
  return (
    <section className="sempty" aria-label="Nothing here yet">
      <span className="eyebrow">
        <span>Nothing here yet</span>
      </span>
      <p>{what}</p>
    </section>
  );
}
