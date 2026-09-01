"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * Cinema mode: dim everything around the monitor while footage is judged.
 *
 * The middle step of the dark-mode ladder deliberately not taken further: the
 * problem worth solving is that Dark/Horror/Documentary footage is judged
 * badly next to a bright ground (every edit suite is dark for this reason),
 * and that problem lives around the PLAYER, not around the whole site. So a
 * button drops a near-black backdrop over the page and lifts the monitor
 * above it — the UI stays Daylight, the footage gets a dark room.
 *
 * Mechanics worth knowing before touching:
 * - The wrapped container is LIFTED (position + z-index) rather than the page
 *   being filtered: CSS cannot exempt a subtree from an ancestor's filter,
 *   and the lift needs no portal. The backdrop is fixed, full-viewport, and
 *   sits INSIDE the lifted stacking context at z-index -1 — behind the
 *   monitor, above everything else on the page.
 * - The state is backed by sessionStorage because the project page remounts
 *   itself every 10 seconds (AutoRefresh): a plain useState would switch the
 *   lights back on mid-viewing, over and over. Read after mount, never in
 *   the initializer, or the server render and the hydration disagree.
 * - Toasts (z 80) stay above the backdrop on purpose — a "S7 finished"
 *   landing during a screening is still worth seeing.
 *
 * Exit: the button again, Esc, or clicking the dark.
 */
const KEY = "vf-cinema";

export default function CinemaMode({
  className,
  children,
}: {
  /** Extra classes for the wrapper — SceneBoard passes its `monitor` classes
   *  so the wrapper IS the monitor card and no selector loses its target. */
  className?: string;
  children: ReactNode;
}) {
  const [on, setOn] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(KEY) === "1") setOn(true);
    } catch {}
  }, []);

  const set = (v: boolean) => {
    setOn(v);
    try {
      if (v) sessionStorage.setItem(KEY, "1");
      else sessionStorage.removeItem(KEY);
    } catch {}
  };

  useEffect(() => {
    if (!on) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && set(false);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);

  return (
    <div className={`${className ?? ""} cine${on ? " cine-on" : ""}`}>
      {on && <div className="cine-backdrop" aria-hidden onClick={() => set(false)} />}
      <button
        type="button"
        className="cine-btn"
        onClick={() => set(!on)}
        title={on ? "Exit cinema mode (Esc)" : "Cinema mode — dim everything around the picture"}
      >
        {on ? "✕ Exit cinema" : "🎬 Cinema"}
      </button>
      {children}
    </div>
  );
}
