import Link from "next/link";

/**
 * Settings is a hub of sections, not a form. Three of the four are reserved
 * on purpose — the buttons exist so the shape of the panel is settled now,
 * and each opens a page that says as much. Customize is the one with
 * something in it.
 *
 * The three tables that used to live here (genre profiles, the script
 * library, the script examples) left the site on 2026-09-15 at the
 * producer's call; the rows are still read by Claude Scripting out of
 * Postgres and are edited there. The screens are in git history under
 * `components/AdminRow.tsx` should they ever come back.
 */
const SECTIONS = [
  {
    href: "/admin/account",
    label: "Account",
    note: "Who you are on this site.",
    icon: (
      <>
        <circle cx="10" cy="7" r="3.3" />
        <path d="M3.8 17c.6-3.2 3.1-5 6.2-5s5.6 1.8 6.2 5" />
      </>
    ),
  },
  {
    href: "/admin/billing",
    label: "Billing",
    note: "Plan, usage and what each film costs.",
    icon: (
      <>
        <rect x="2.5" y="5" width="15" height="10.5" rx="2" />
        <path d="M2.5 8.5h15M6 12.5h3" />
      </>
    ),
  },
  {
    href: "/admin/notifications",
    label: "Notifications",
    note: "When the factory should call you.",
    icon: (
      <>
        <path d="M5 13.5V9a5 5 0 0 1 10 0v4.5l1.3 1.5H3.7L5 13.5z" />
        <path d="M8.3 17.2a1.9 1.9 0 0 0 3.4 0" />
      </>
    ),
  },
  {
    href: "/admin/customize",
    label: "Customize",
    note: "Appearance — light, dark, or follow the device.",
    icon: (
      <>
        <circle cx="10" cy="10" r="7" />
        <path d="M10 3a7 7 0 0 1 0 14z" fill="currentColor" stroke="none" />
      </>
    ),
  },
] as const;

export default function SettingsPage() {
  return (
    <main className="page admin settings">
      <div className="sechead">
        <h2>Settings</h2>
        <p>Everything about the site that is not a film.</p>
      </div>
      <nav className="sgrid" aria-label="Settings sections">
        {SECTIONS.map((s) => (
          <Link key={s.href} href={s.href} className="scard">
            <span className="sicon" aria-hidden="true">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                {s.icon}
              </svg>
            </span>
            <span className="stext">
              <span className="slabel">{s.label}</span>
              <span className="snote">{s.note}</span>
            </span>
            <svg className="schev" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M8 4l6 6-6 6" />
            </svg>
          </Link>
        ))}
      </nav>
    </main>
  );
}
